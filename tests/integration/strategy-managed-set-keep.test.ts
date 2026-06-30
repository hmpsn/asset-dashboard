/**
 * strategy-managed-set-keep.test.ts
 *
 * REGRESSION GUARD: POST /api/outcomes/:ws/actions with actionType values
 * 'content_gap_keep' and 'topic_cluster_keep' must return 200 (not 400) and
 * write a tracked_actions row.
 *
 * The bug class being guarded: the Zod actionTypeEnum in server/schemas/outcome-schemas.ts
 * drifted from the shared ActionType union in shared/types/outcome-tracking.ts. When a new
 * ActionType value is added to the TS union but not to the Zod enum, the POST route returns
 * 400 ("Invalid enum value") even though the frontend sends a valid value. This was caught
 * during the P3 cumulative review for 'content_gap_keep' and 'topic_cluster_keep'.
 *
 * Three-layer guard:
 *   1. Unit: actionTypeEnum.safeParse('content_gap_keep').success === true (and topic_cluster_keep)
 *   2. Integration: POST /api/outcomes/:ws/actions with those actionTypes → 200 + row in DB
 *   3. Idempotency: a second POST with the same sourceId → 200 (deduplicated, no 409)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { getActionsByWorkspaceAndType } from '../../server/outcome-tracking.js';
import type { ActionType } from '../../shared/types/outcome-tracking.js';

const ctx = createEphemeralTestContext(import.meta.url, { contextName: 'keep-guard' });
const { postJson } = ctx;

let wsId = '';
const RUN_ID = Date.now().toString(36);

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace(`Keep Guard WS ${RUN_ID}`).id;
}, 60_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ── Layer 1: unit — Zod enum includes both keep action types ─────────────────

describe('actionTypeEnum unit — keep action types are in the enum', () => {
  it('actionTypeEnum.safeParse("content_gap_keep").success === true', async () => {
    const { actionTypeEnum } = await import('../../server/schemas/outcome-schemas.js');
    const result = actionTypeEnum.safeParse('content_gap_keep');
    expect(result.success).toBe(true);
  });

  it('actionTypeEnum.safeParse("topic_cluster_keep").success === true', async () => {
    const { actionTypeEnum } = await import('../../server/schemas/outcome-schemas.js');
    const result = actionTypeEnum.safeParse('topic_cluster_keep');
    expect(result.success).toBe(true);
  });

  it('actionTypeEnum rejects an unknown value (regression guard for enum integrity)', () => {
    // This confirms the enum validates and does not silently accept anything.
    import('../../server/schemas/outcome-schemas.js').then(({ actionTypeEnum }) => {
      const result = actionTypeEnum.safeParse('not_a_real_action_type_xyz');
      expect(result.success).toBe(false);
    });
  });
});

// ── Layer 2: integration — POST returns 200 and writes a row ─────────────────

describe('POST /api/outcomes/:ws/actions — content_gap_keep returns 200', () => {
  it('returns 200 and creates a tracked_actions row for content_gap_keep', async () => {
    const sourceId = `gap-keep-${RUN_ID}`;
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'content_gap_keep',
      sourceType: 'content_gap',
      sourceId,
      targetKeyword: 'best seo tools for agencies',
      baselineSnapshot: { position: 8.2 },
      attribution: 'platform_executed',
    });

    expect(res.status, `Expected 200 but got ${res.status} — actionTypeEnum likely missing 'content_gap_keep'`).toBe(200);
    const body = await res.json() as { success: boolean; action: { id: string; actionType: string } };
    expect(body.success).toBe(true);
    expect(body.action.actionType).toBe('content_gap_keep');

    // Verify the row was actually written to the DB.
    const rows = getActionsByWorkspaceAndType(wsId, 'content_gap_keep' as ActionType);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some(r => r.id === body.action.id)).toBe(true);
  });

  it('returns 200 and creates a tracked_actions row for topic_cluster_keep', async () => {
    const sourceId = `cluster-keep-${RUN_ID}`;
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'topic_cluster_keep',
      sourceType: 'topic_cluster',
      sourceId,
      targetKeyword: 'local seo services',
      baselineSnapshot: { impressions: 1200, clicks: 42 },
      attribution: 'platform_executed',
    });

    expect(res.status, `Expected 200 but got ${res.status} — actionTypeEnum likely missing 'topic_cluster_keep'`).toBe(200);
    const body = await res.json() as { success: boolean; action: { id: string; actionType: string } };
    expect(body.success).toBe(true);
    expect(body.action.actionType).toBe('topic_cluster_keep');

    // Verify the row was actually written.
    const rows = getActionsByWorkspaceAndType(wsId, 'topic_cluster_keep' as ActionType);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some(r => r.id === body.action.id)).toBe(true);
  });
});

// ── Layer 3: idempotency — duplicate sourceId is deduplicated (not 4xx) ──────

describe('POST idempotency — duplicate sourceId returns 200 (deduplicated)', () => {
  it('second POST with same sourceId returns 200 with deduplicated flag', async () => {
    const sourceId = `gap-keep-dedup-${RUN_ID}`;
    const body = {
      actionType: 'content_gap_keep',
      sourceType: 'content_gap',
      sourceId,
      baselineSnapshot: { position: 3.0 },
    };

    const first = await postJson(`/api/outcomes/${wsId}/actions`, body);
    expect(first.status).toBe(200);

    // Second POST with same sourceId — should be deduplicated, not error.
    const second = await postJson(`/api/outcomes/${wsId}/actions`, body);
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { success: boolean; deduplicated?: boolean };
    expect(secondBody.success).toBe(true);
    expect(secondBody.deduplicated).toBe(true);
  });
});

// ── FM-2: invalid actionType still returns 400 ───────────────────────────────

describe('FM-2 — invalid actionType returns 400 (not silently accepted)', () => {
  it('returns 400 for unknown actionType "invalid_keep_xyz"', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'invalid_keep_xyz',
      sourceType: 'content_gap',
      baselineSnapshot: { position: 5.0 },
    });
    expect(res.status).toBe(400);
  });
});
