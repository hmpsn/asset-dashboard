/**
 * Lane 1E — Cannibalization keeper-override integration test.
 *
 * Verifies:
 * 1. PATCH /api/recommendations/:ws/cannibalization/:urlSetKey/keeper stores the override.
 * 2. GET after PATCH reflects the stored keeper.
 * 3. The override SURVIVES a generateRecommendations regen (delete-reinsert clobber of
 *    cannibalization_issues). The key contract: the override is keyed on the
 *    order-independent cannibalizationUrlSetKey (NOT the cannibalization_issues row id),
 *    so regen cannot destroy it.
 * 4. clearKeeperOverride removes the stored keeper.
 *
 * Pattern: createEphemeralTestContext (child-process server, ephemeral port).
 * Direct DB writes use server modules imported into the test process (same DATA_DIR).
 * No git writes — controller commits per lane.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createEphemeralTestContext } from './helpers.js';
import {
  getKeeperOverride,
  setKeeperOverride,
  clearKeeperOverride,
} from '../../server/cannibalization-keeper-override.js';
import { cannibalizationUrlSetKey } from '../../server/recommendations.js';
import {
  replaceAllCannibalizationIssues,
  listCannibalizationIssues,
} from '../../server/cannibalization-issues.js';
import type { CannibalizationItem } from '../../shared/types/workspace.js';

const ctx = createEphemeralTestContext(import.meta.url);

let workspaceId = '';
let cleanupWorkspace: (() => void) | undefined;

// A fixed URL set for the test cannibalization issue.
const TEST_PAGES = ['/page-a', '/page-b'];
const TEST_URL_SET_KEY = cannibalizationUrlSetKey(TEST_PAGES);

// Build a minimal valid CannibalizationItem that satisfies normalizeCannibalizationIssue().
function makeIssue(pages: { path: string }[]): CannibalizationItem {
  return {
    keyword: 'test keyword',
    pages: pages.map(p => ({ path: p.path, source: 'keyword_map' as const })),
    severity: 'medium',
    recommendation: 'Consolidate competing pages.',
  };
}

beforeAll(async () => {
  await ctx.startServer();
  const seeded = seedWorkspace({ clientPassword: '' });
  workspaceId = seeded.workspaceId;
  cleanupWorkspace = seeded.cleanup;

  // Seed an initial cannibalization issue so the regen-survival test has something to rebuild.
  replaceAllCannibalizationIssues(workspaceId, [makeIssue(TEST_PAGES.map(p => ({ path: p })))]);
}, 30_000);

afterAll(async () => {
  // Clean up keeper-override rows created by store-level tests.
  db.prepare('DELETE FROM cannibalization_keeper_override WHERE workspace_id = ?').run(workspaceId);
  await ctx.stopServer();
  cleanupWorkspace?.();
});

// ── Store-level unit tests (in-process, no HTTP) ──────────────────────────────

describe('cannibalization-keeper-override store', () => {
  it('getKeeperOverride returns null when no override exists', () => {
    const result = getKeeperOverride(workspaceId, TEST_URL_SET_KEY);
    expect(result).toBeNull();
  });

  it('setKeeperOverride stores and getKeeperOverride retrieves the keeper', () => {
    setKeeperOverride(workspaceId, TEST_URL_SET_KEY, '/page-a');
    const result = getKeeperOverride(workspaceId, TEST_URL_SET_KEY);
    expect(result).toBe('/page-a');
  });

  it('setKeeperOverride is idempotent (upsert semantics)', () => {
    setKeeperOverride(workspaceId, TEST_URL_SET_KEY, '/page-b');
    const result = getKeeperOverride(workspaceId, TEST_URL_SET_KEY);
    expect(result).toBe('/page-b');
  });

  it('clearKeeperOverride removes the stored keeper', () => {
    setKeeperOverride(workspaceId, TEST_URL_SET_KEY, '/page-a');
    clearKeeperOverride(workspaceId, TEST_URL_SET_KEY);
    const result = getKeeperOverride(workspaceId, TEST_URL_SET_KEY);
    expect(result).toBeNull();
  });

  it('is scoped to workspace_id — another workspace cannot read the override', () => {
    const otherWsId = 'other-workspace-keeper-test';
    setKeeperOverride(workspaceId, TEST_URL_SET_KEY, '/page-a');
    const result = getKeeperOverride(otherWsId, TEST_URL_SET_KEY);
    expect(result).toBeNull();
  });
});

// ── HTTP route tests ──────────────────────────────────────────────────────────

describe('PATCH /api/recommendations/:ws/cannibalization/:urlSetKey/keeper', () => {
  it('sets the keeper override and returns 200 with the stored path', async () => {
    const res = await ctx.authPatchJson(
      `/api/recommendations/${workspaceId}/cannibalization/${encodeURIComponent(TEST_URL_SET_KEY)}/keeper`,
      { keeperPath: '/page-a' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { keeperPath: string };
    expect(body.keeperPath).toBe('/page-a');

    // Verify the DB was updated.
    expect(getKeeperOverride(workspaceId, TEST_URL_SET_KEY)).toBe('/page-a');
  });

  it('rejects missing keeperPath with 400', async () => {
    const res = await ctx.authPatchJson(
      `/api/recommendations/${workspaceId}/cannibalization/${encodeURIComponent(TEST_URL_SET_KEY)}/keeper`,
      {},
    );
    expect(res.status).toBe(400);
  });

  it('rejects empty keeperPath with 400', async () => {
    const res = await ctx.authPatchJson(
      `/api/recommendations/${workspaceId}/cannibalization/${encodeURIComponent(TEST_URL_SET_KEY)}/keeper`,
      { keeperPath: '' },
    );
    expect(res.status).toBe(400);
  });

  it('rejects a keeperPath that is not one of the competing pages with 422', async () => {
    const res = await ctx.authPatchJson(
      `/api/recommendations/${workspaceId}/cannibalization/${encodeURIComponent(TEST_URL_SET_KEY)}/keeper`,
      { keeperPath: '/some-unrelated-page' },
    );
    expect(res.status).toBe(422);
  });

  it('accepts the request via admin token (requireWorkspaceAccess gate)', async () => {
    // requireWorkspaceAccess passes through for HMAC-authenticated admin callers.
    // Auth guard integration tests live in admin-auth-guard.test.ts; this test
    // only verifies the happy-path endpoint contract.
    const res = await ctx.authPatchJson(
      `/api/recommendations/${workspaceId}/cannibalization/${encodeURIComponent(TEST_URL_SET_KEY)}/keeper`,
      { keeperPath: '/page-b' },
    );
    expect(res.status).toBe(200);
  });
});

// ── Read-path override test (the override must CHANGE what readers see) ─────────

describe('keeper override is applied on the cannibalization read path', () => {
  it('listCannibalizationIssues returns the override canonicalPath, overriding the heuristic', () => {
    // Reseed a clean issue with NO heuristic canonicalPath for the test URL set.
    replaceAllCannibalizationIssues(workspaceId, [makeIssue(TEST_PAGES.map((p) => ({ path: p })))]);
    clearKeeperOverride(workspaceId, TEST_URL_SET_KEY);

    // Baseline: no override → no canonicalPath surfaced from the heuristic seed.
    const before = listCannibalizationIssues(workspaceId).find((i) => i.keyword === 'test keyword');
    expect(before).toBeDefined();
    expect(before?.canonicalPath).toBeUndefined();

    // Set the operator override and read again — the read result MUST change.
    setKeeperOverride(workspaceId, TEST_URL_SET_KEY, '/page-b');
    const after = listCannibalizationIssues(workspaceId).find((i) => i.keyword === 'test keyword');
    expect(after?.canonicalPath).toBe('/page-b');

    // Clearing the override reverts the read result.
    clearKeeperOverride(workspaceId, TEST_URL_SET_KEY);
    const reverted = listCannibalizationIssues(workspaceId).find((i) => i.keyword === 'test keyword');
    expect(reverted?.canonicalPath).toBeUndefined();
  });
});

// ── Regen-survival test (the critical contract) ───────────────────────────────

describe('keeper override survives generateRecommendations regen (delete-reinsert clobber)', () => {
  it('override survives replaceAllCannibalizationIssues (the regen clobber operation)', () => {
    // Set an override for the test URL set.
    setKeeperOverride(workspaceId, TEST_URL_SET_KEY, '/page-a');
    expect(getKeeperOverride(workspaceId, TEST_URL_SET_KEY)).toBe('/page-a');

    // Simulate what generateRecommendations does: delete-reinsert cannibalization_issues.
    // This clobbers the cannibalization_issues table rows but must NOT affect the
    // cannibalization_keeper_override table (different table, keyed on urlSetKey).
    replaceAllCannibalizationIssues(workspaceId, [makeIssue(TEST_PAGES.map(p => ({ path: p })))]);

    // The override must still be retrievable after the regen clobber.
    const survived = getKeeperOverride(workspaceId, TEST_URL_SET_KEY);
    expect(survived).toBe('/page-a');
  });

  it('override key is order-independent (same URL set, different path order = same key)', () => {
    const reversedPages = [...TEST_PAGES].reverse();
    const reversedKey = cannibalizationUrlSetKey(reversedPages);
    // The keys must be equal — order-independent normalization.
    expect(reversedKey).toBe(TEST_URL_SET_KEY);

    // Setting via original order and reading via reversed paths produce the same row.
    setKeeperOverride(workspaceId, TEST_URL_SET_KEY, '/page-b');
    expect(getKeeperOverride(workspaceId, reversedKey)).toBe('/page-b');
  });
});
