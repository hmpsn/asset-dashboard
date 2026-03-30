/**
 * Integration tests for the Outcome Intelligence Engine pipeline.
 *
 * Tests the full HTTP request/response cycle for:
 * - POST /api/outcomes/:wsId/actions (record action)
 * - GET /api/outcomes/:wsId/actions (list actions)
 * - GET /api/outcomes/:wsId/actions?type=... (filter by type)
 * - GET /api/outcomes/:wsId/actions/:id (get single action)
 * - PATCH /api/outcomes/:wsId/actions/:id/note (add note)
 * - GET /api/outcomes/:wsId/scorecard (scorecard)
 * - GET /api/outcomes/:wsId/top-wins (top wins)
 * - GET /api/outcomes/:wsId/diagnostics (diagnostics)
 * - Idempotency: same sourceType+sourceId → only one action
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

// Enable outcome tracking feature flag before server starts
process.env.FEATURE_OUTCOME_TRACKING = 'true';

const ctx = createTestContext(13250);
const { api, postJson } = ctx;

let testWsId = '';
const RUN_ID = Date.now().toString(36);

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Outcome Pipeline Test');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

// ── Record and retrieve actions ──

describe('Outcome actions — record and read', () => {
  let actionId = '';

  it('POST /api/outcomes/:wsId/actions records an action', async () => {
    const res = await postJson(`/api/outcomes/${testWsId}/actions`, {
      actionType: 'meta_updated',
      sourceType: 'test',
      sourceId: `test-source-1-${RUN_ID}`,
      pageUrl: 'https://example.com/test-page',
      targetKeyword: 'test keyword',
      baselineSnapshot: { position: 12.5, clicks: 30, impressions: 500, ctr: 6.0 },
      attribution: 'platform_executed',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBeDefined();
    expect(body.action.id).toBeTruthy();
    expect(body.action.actionType).toBe('meta_updated');
    expect(body.action.pageUrl).toBe('https://example.com/test-page');
    expect(body.action.targetKeyword).toBe('test keyword');
    expect(body.action.baselineSnapshot.position).toBe(12.5);
    expect(body.action.baselineSnapshot.clicks).toBe(30);
    actionId = body.action.id;
  });

  it('GET /api/outcomes/:wsId/actions returns recorded actions', async () => {
    const res = await api(`/api/outcomes/${testWsId}/actions`);
    expect(res.status).toBe(200);
    const actions = await res.json();
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeGreaterThan(0);
    const found = actions.find((a: { id: string }) => a.id === actionId);
    expect(found).toBeDefined();
    expect(found.actionType).toBe('meta_updated');
  });

  it('GET /api/outcomes/:wsId/actions?type=meta_updated filters by type', async () => {
    const res = await api(`/api/outcomes/${testWsId}/actions?type=meta_updated`);
    expect(res.status).toBe(200);
    const actions = await res.json();
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a: { actionType: string }) => a.actionType === 'meta_updated')).toBe(true);
  });

  it('GET /api/outcomes/:wsId/actions?type=BOGUS returns all (graceful fallback)', async () => {
    const res = await api(`/api/outcomes/${testWsId}/actions?type=BOGUS`);
    expect(res.status).toBe(200);
    const actions = await res.json();
    // Invalid type param falls back to unfiltered list
    expect(actions.length).toBeGreaterThan(0);
  });

  it('GET /api/outcomes/:wsId/actions/:id returns single action', async () => {
    const res = await api(`/api/outcomes/${testWsId}/actions/${actionId}`);
    expect(res.status).toBe(200);
    const action = await res.json();
    expect(action.id).toBe(actionId);
    expect(action.actionType).toBe('meta_updated');
  });

  it('GET /api/outcomes/:wsId/actions/:id returns 404 for missing action', async () => {
    const res = await api(`/api/outcomes/${testWsId}/actions/nonexistent-id`);
    expect(res.status).toBe(404);
  });
});

// ── Idempotency ──

describe('Outcome actions — idempotency guard', () => {
  it('recording same sourceType+sourceId twice returns existing action', async () => {
    const payload = {
      actionType: 'content_published',
      sourceType: 'idem-test',
      sourceId: `idem-source-1-${RUN_ID}`,
      pageUrl: 'https://example.com/idem-page',
      baselineSnapshot: { position: 5.0, clicks: 100, impressions: 2000 },
    };

    const res1 = await postJson(`/api/outcomes/${testWsId}/actions`, payload);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    const firstId = body1.action.id;

    // Second call with same sourceType+sourceId
    const res2 = await postJson(`/api/outcomes/${testWsId}/actions`, payload);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    // Should return the same action, not create a new one
    expect(body2.action.id).toBe(firstId);

    // Verify exactly one action with firstId exists (no duplicate)
    const listRes = await api(`/api/outcomes/${testWsId}/actions?type=content_published`);
    const actions = await listRes.json();
    const matching = actions.filter((a: { id: string }) => a.id === firstId);
    expect(matching.length).toBe(1);
  });

  it('idempotency guard does not leak actions across workspaces', async () => {
    // Create a second workspace
    const ws2 = createWorkspace('Cross-WS Test');
    const ws2Id = ws2.id;

    try {
      // Record an action in ws2 with a known sourceType+sourceId
      const src = `cross-ws-${RUN_ID}`;
      const res1 = await postJson(`/api/outcomes/${ws2Id}/actions`, {
        actionType: 'meta_updated',
        sourceType: 'cross-test',
        sourceId: src,
        baselineSnapshot: { position: 1.0 },
      });
      expect(res1.status).toBe(200);
      const ws2Action = (await res1.json()).action;
      expect(ws2Action.workspaceId).toBe(ws2Id);

      // Try to record same sourceType+sourceId in testWsId — should create NEW action, not return ws2's
      const res2 = await postJson(`/api/outcomes/${testWsId}/actions`, {
        actionType: 'meta_updated',
        sourceType: 'cross-test',
        sourceId: src,
        baselineSnapshot: { position: 2.0 },
      });
      expect(res2.status).toBe(200);
      const body2 = await res2.json();
      // Must NOT return the ws2 action
      expect(body2.action.workspaceId).toBe(testWsId);
      expect(body2.action.id).not.toBe(ws2Action.id);
    } finally {
      deleteWorkspace(ws2Id);
    }
  });
});

// ── Attribution validation ──

describe('Outcome actions — attribution validation', () => {
  it('rejects invalid attribution values', async () => {
    const res = await postJson(`/api/outcomes/${testWsId}/actions`, {
      actionType: 'meta_updated',
      sourceType: 'attr-test',
      sourceId: `attr-invalid-${RUN_ID}`,
      baselineSnapshot: { position: 3.0 },
      attribution: 'user_reported',  // invalid — not in Attribution type
    });
    expect(res.status).toBe(400);
  });

  it('accepts valid attribution value externally_executed', async () => {
    const res = await postJson(`/api/outcomes/${testWsId}/actions`, {
      actionType: 'meta_updated',
      sourceType: 'attr-test',
      sourceId: `attr-valid-${RUN_ID}`,
      baselineSnapshot: { position: 3.0 },
      attribution: 'externally_executed',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action.attribution).toBe('externally_executed');
  });
});

// ── Notes ──

describe('Outcome actions — add note', () => {
  let noteActionId = '';

  it('create action for note test', async () => {
    const res = await postJson(`/api/outcomes/${testWsId}/actions`, {
      actionType: 'audit_fix_applied',
      sourceType: 'note-test',
      sourceId: `note-src-1-${RUN_ID}`,
      baselineSnapshot: { position: 8.0 },
    });
    expect(res.status).toBe(200);
    noteActionId = (await res.json()).action.id;
  });

  it('POST /api/outcomes/:wsId/actions/:id/note adds a note', async () => {
    const res = await postJson(`/api/outcomes/${testWsId}/actions/${noteActionId}/note`, {
      note: 'Fixed missing H1 tag on landing page',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('note appears in action context', async () => {
    const res = await api(`/api/outcomes/${testWsId}/actions/${noteActionId}`);
    expect(res.status).toBe(200);
    const action = await res.json();
    expect(action.context?.notes).toContain('Fixed missing H1 tag on landing page');
  });
});

// ── Scorecard ──

describe('Outcome scorecard', () => {
  it('GET /api/outcomes/:wsId/scorecard returns valid scorecard', async () => {
    const res = await api(`/api/outcomes/${testWsId}/scorecard`);
    expect(res.status).toBe(200);
    const sc = await res.json();
    expect(sc).toHaveProperty('overallWinRate');
    expect(sc).toHaveProperty('totalTracked');
    expect(sc).toHaveProperty('totalScored');
    expect(sc).toHaveProperty('pendingMeasurement');
    expect(sc).toHaveProperty('byCategory');
    expect(typeof sc.totalTracked).toBe('number');
    expect(typeof sc.overallWinRate).toBe('number');
    expect(sc.totalTracked).toBeGreaterThan(0);
  });
});

// ── Top Wins ──

describe('Outcome top wins', () => {
  it('GET /api/outcomes/:wsId/top-wins returns array', async () => {
    const res = await api(`/api/outcomes/${testWsId}/top-wins`);
    expect(res.status).toBe(200);
    const wins = await res.json();
    expect(Array.isArray(wins)).toBe(true);
    // No scored outcomes yet, so empty is expected
  });
});

// ── Diagnostics ──

describe('Outcome diagnostics', () => {
  it('GET /api/outcomes/:wsId/diagnostics returns pipeline health', async () => {
    const res = await api(`/api/outcomes/${testWsId}/diagnostics`);
    expect(res.status).toBe(200);
    const diag = await res.json();

    expect(diag.workspaceId).toBe(testWsId);
    expect(diag.featureEnabled).toBe(true);

    // Table counts
    expect(diag.tableCounts).toBeDefined();
    expect(diag.tableCounts.trackedActions).toBeGreaterThan(0);
    expect(typeof diag.tableCounts.scored).toBe('number');
    expect(typeof diag.tableCounts.pending).toBe('number');

    // Anomalies structure
    expect(diag.anomalies).toBeDefined();
    expect(Array.isArray(diag.anomalies.emptyBaselines)).toBe(true);
    expect(Array.isArray(diag.anomalies.relativeUrls)).toBe(true);
    expect(Array.isArray(diag.anomalies.overdueScoring)).toBe(true);
    expect(Array.isArray(diag.anomalies.orphanedOutcomes)).toBe(true);

    // Summary counts
    expect(diag.anomalySummary).toBeDefined();
    expect(typeof diag.anomalySummary.emptyBaselines).toBe('number');
  });

  it('diagnostics detects relative URL anomaly', async () => {
    // Record an action with a relative URL (bad practice)
    await postJson(`/api/outcomes/${testWsId}/actions`, {
      actionType: 'internal_link_added',
      sourceType: 'diag-test',
      sourceId: `diag-relative-url-${RUN_ID}`,
      pageUrl: '/blog/some-page',
      baselineSnapshot: { clicks: 10, impressions: 200 },
    });

    const res = await api(`/api/outcomes/${testWsId}/diagnostics`);
    const diag = await res.json();
    expect(diag.anomalySummary.relativeUrls).toBeGreaterThan(0);
    expect(diag.anomalies.relativeUrls.length).toBeGreaterThan(0);
  });
});

// ── Learnings ──

describe('Outcome learnings', () => {
  it('GET /api/outcomes/:wsId/learnings returns learnings or null', async () => {
    const res = await api(`/api/outcomes/${testWsId}/learnings`);
    expect(res.status).toBe(200);
    // Learnings may be null if no scored outcomes exist yet
    const body = await res.json();
    // Response is either null or an object with expected shape
    if (body !== null) {
      expect(body).toHaveProperty('workspaceId');
    }
  });
});

// ── Playbooks ──

describe('Outcome playbooks', () => {
  it('GET /api/outcomes/:wsId/playbooks returns array', async () => {
    const res = await api(`/api/outcomes/${testWsId}/playbooks`);
    expect(res.status).toBe(200);
    const playbooks = await res.json();
    expect(Array.isArray(playbooks)).toBe(true);
  });
});

// ── Feature flag gate ──

describe('Feature flag gate', () => {
  it('endpoints would return 404 when feature disabled (verified by flag presence)', async () => {
    // We can't easily toggle the flag mid-test since it's set at server startup.
    // Instead, verify the diagnostics endpoint confirms the flag is enabled.
    const res = await api(`/api/outcomes/${testWsId}/diagnostics`);
    const diag = await res.json();
    expect(diag.featureEnabled).toBe(true);
  });
});
