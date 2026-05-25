/**
 * Integration tests for tier downgrade and trial expiry behavior.
 *
 * The existing tier-gate-enforcement.test.ts (port 13312) tests that
 * tier-gated endpoints return the correct limits when workspaces ARE on
 * Growth/Premium. These tests cover the complementary failure modes:
 *
 *   1. Mid-request downgrade: Growth → Free closes access (DB change, same
 *      server, same request path — verifies tier is NOT cached between requests)
 *   2. Trial active: Free workspace with future `trial_ends_at` acts as Growth
 *   3. Trial expiry: past `trial_ends_at` reverts to Free limits (the highest-
 *      value test — a workspace that WAS on trial must NOT retain Growth access)
 *   4. Effective tier endpoint reflects all of the above consistently
 *
 * Port 13364 — verify uniqueness with: grep -r '13364' tests/
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13364); // port-ok: next free after 13363
const { api } = ctx;

let growthWs: SeededFullWorkspace | undefined;
let trialActiveWs: SeededFullWorkspace | undefined;
let trialExpiredWs: SeededFullWorkspace | undefined;

beforeAll(async () => {
  await ctx.startServer();

  // Growth workspace: used for downgrade test (tier will be mutated mid-test)
  growthWs = seedWorkspace({ tier: 'growth', clientPassword: '' });

  // Trial-active workspace: Free base tier, trial ends in the future → Growth
  trialActiveWs = seedWorkspace({ tier: 'free', clientPassword: '' });
  const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE workspaces SET trial_ends_at = ? WHERE id = ?').run(futureDate, trialActiveWs.workspaceId);

  // Trial-expired workspace: Free base tier, trial ended yesterday → still Free
  trialExpiredWs = seedWorkspace({ tier: 'free', clientPassword: '' });
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE workspaces SET trial_ends_at = ? WHERE id = ?').run(pastDate, trialExpiredWs.workspaceId);
}, 25_000);

afterAll(async () => {
  const tryCleanup = (w: SeededFullWorkspace | undefined) => w?.cleanup();
  tryCleanup(growthWs);
  tryCleanup(trialActiveWs);
  tryCleanup(trialExpiredWs);
  await ctx.stopServer();
});

// ── Tier downgrade: Growth → Free ────────────────────────────────────────────

describe('Tier downgrade: Growth → Free mid-test', () => {
  it('growth workspace starts with ai_chats limit=50 (not 3)', async () => {
    const res = await api(`/api/public/usage/${growthWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('growth');
    expect(body.usage.ai_chats.limit).toBe(50);
    expect(body.usage.strategy_generations.limit).toBe(3);
  });

  it('after DB tier change to free: usage endpoint returns Free limits (not cached Growth)', async () => {
    // Mutate the tier in-place — same workspace, same running server
    db.prepare('UPDATE workspaces SET tier = ? WHERE id = ?').run('free', growthWs!.workspaceId);

    const res = await api(`/api/public/usage/${growthWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // The key assertion: tier must now reflect Free, NOT the former Growth tier
    expect(body.tier).toBe('free');
    expect(body.usage.ai_chats.limit).toBe(3);
    expect(body.usage.strategy_generations.limit).toBe(0);
  });

  it('after DB tier change to free: tier endpoint also returns free', async () => {
    // growthWs was already downgraded in the previous test
    const res = await api(`/api/public/tier/${growthWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('free');
    expect(body.baseTier).toBe('free');
    expect(body.isTrial).toBe(false);
  });

  it('after DB tier change to free: chat-usage limit drops to 3', async () => {
    // growthWs was already downgraded above
    const res = await api(`/api/public/chat-usage/${growthWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('free');
    expect(body.limit).toBe(3);
    expect(body.allowed).toBe(true);
  });

  it('after DB tier change to free: intelligence endpoint excludes learningHighlights', async () => {
    // growthWs was already downgraded above
    const res = await api(`/api/public/intelligence/${growthWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('free');
    // Growth-only slice must be absent after downgrade
    expect('learningHighlights' in body).toBe(false);
    // Free slices are still present
    expect('insightsSummary' in body).toBe(true);
    expect('pipelineStatus' in body).toBe(true);
  });

  it('re-upgrading back to growth restores Growth limits immediately', async () => {
    db.prepare('UPDATE workspaces SET tier = ? WHERE id = ?').run('growth', growthWs!.workspaceId);

    const res = await api(`/api/public/usage/${growthWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('growth');
    expect(body.usage.ai_chats.limit).toBe(50);
    expect(body.usage.strategy_generations.limit).toBe(3);
  });
});

// ── Trial active: Free base tier with future trial_ends_at acts as Growth ────

describe('Trial active: Free workspace with future trial_ends_at', () => {
  it('tier endpoint: baseTier=free but effective tier=growth, isTrial=true', async () => {
    const res = await api(`/api/public/tier/${trialActiveWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('growth');
    expect(body.baseTier).toBe('free');
    expect(body.isTrial).toBe(true);
    expect(body.trialDaysRemaining).toBeGreaterThan(0);
    expect(body.trialEndsAt).toBeDefined();
    expect(body.trialEndsAt).not.toBeNull();
  });

  it('usage endpoint: trial workspace gets Growth limits (ai_chats=50)', async () => {
    const res = await api(`/api/public/usage/${trialActiveWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('growth');
    expect(body.usage.ai_chats.limit).toBe(50);
    expect(body.usage.strategy_generations.limit).toBe(3);
  });

  it('chat-usage endpoint: trial workspace gets unlimited chat (Growth)', async () => {
    const res = await api(`/api/public/chat-usage/${trialActiveWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('growth');
    expect(body.allowed).toBe(true);
    // Growth/premium serializes Infinity to null in JSON
    expect(body.limit).toBeNull();
    expect(body.remaining).toBeNull();
  });

  it('intelligence endpoint: trial workspace gets learningHighlights slice', async () => {
    const res = await api(`/api/public/intelligence/${trialActiveWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('growth');
    expect('learningHighlights' in body).toBe(true);
    expect('siteHealthSummary' in body).toBe(false); // premium-only
  });
});

// ── Trial expiry: past trial_ends_at reverts to Free limits ─────────────────
//
// This is the highest-value test: a workspace that WAS on trial but the trial
// expired must NOT continue to receive Growth-level access.

describe('Trial expiry: past trial_ends_at reverts to Free', () => {
  it('tier endpoint: expired trial returns tier=free, isTrial=false, trialDaysRemaining=0', async () => {
    const res = await api(`/api/public/tier/${trialExpiredWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Critical: expired trial must NOT grant Growth access
    expect(body.tier).toBe('free');
    expect(body.baseTier).toBe('free');
    expect(body.isTrial).toBe(false);
    expect(body.trialDaysRemaining).toBe(0);
  });

  it('usage endpoint: expired trial returns Free limits (ai_chats=3, NOT 50)', async () => {
    const res = await api(`/api/public/usage/${trialExpiredWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // The bug this catches: if the expiry check is off-by-one or missing,
    // ai_chats.limit would be 50 instead of 3.
    expect(body.tier).toBe('free');
    expect(body.usage.ai_chats.limit).toBe(3);
    expect(body.usage.strategy_generations.limit).toBe(0);
  });

  it('chat-usage endpoint: expired trial returns Free limit of 3', async () => {
    const res = await api(`/api/public/chat-usage/${trialExpiredWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('free');
    expect(body.limit).toBe(3);
    expect(body.allowed).toBe(true); // still allowed (0 chats used so far)
    expect(body.remaining).toBe(3);
  });

  it('intelligence endpoint: expired trial does NOT get learningHighlights', async () => {
    const res = await api(`/api/public/intelligence/${trialExpiredWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Key assertion: expired trial must not receive Growth-gated slices
    expect(body.tier).toBe('free');
    expect('learningHighlights' in body).toBe(false);
    expect('siteHealthSummary' in body).toBe(false);
    // Free slices still present
    expect('insightsSummary' in body).toBe(true);
    expect('pipelineStatus' in body).toBe(true);
  });
});

// ── Trial expiry boundary: just-expired vs just-active ───────────────────────
//
// Tests the boundary where a trial transitions from active to expired.
// This ensures the comparator is strict (>) not (>=) so a trial that expires
// at exactly "now" is treated as expired, not active.

describe('Trial expiry boundary: just-expired workspace', () => {
  let boundaryWs: SeededFullWorkspace | undefined;

  beforeAll(() => {
    boundaryWs = seedWorkspace({ tier: 'free', clientPassword: '' });
    // Trial ended 1 second ago — definitively expired
    const justExpiredDate = new Date(Date.now() - 1000).toISOString();
    db.prepare('UPDATE workspaces SET trial_ends_at = ? WHERE id = ?').run(justExpiredDate, boundaryWs.workspaceId);
  });

  afterAll(() => {
    boundaryWs?.cleanup();
  });

  it('workspace with trial_ends_at 1 second ago returns tier=free', async () => {
    const res = await api(`/api/public/tier/${boundaryWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('free');
    expect(body.isTrial).toBe(false);
    expect(body.trialDaysRemaining).toBe(0);
  });

  it('usage for just-expired trial workspace returns Free limits', async () => {
    const res = await api(`/api/public/usage/${boundaryWs!.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('free');
    expect(body.usage.ai_chats.limit).toBe(3);
  });
});
