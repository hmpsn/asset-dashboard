/**
 * Integration tests for the Outcome Intelligence Engine — full lifecycle.
 *
 * Uses the in-process Express server pattern (vi.hoisted broadcast capture,
 * no createTestContext subprocess) so broadcast calls are observable in-process.
 *
 * Covers:
 * - GET endpoints return 200 with correct shape (array or object)
 * - Fresh workspace returns empty arrays/zeroes, not errors
 * - POST action creates and returns the action with correct broadcast
 * - GET single action returns action + empty outcomes array
 * - Workspace isolation: workspace A's actions not accessible via workspace B
 * - Public endpoints (summary + wins) accessible without auth on passwordless workspace
 * - Public endpoints require auth when workspace has a clientPassword set
 * - Idempotent POST (sourceId dedup): second identical sourceId returns same action
 * - Learnings returns null for fresh workspace
 * - Scorecard shape and zero values for fresh workspace
 * - Timeline is empty and then reflects created actions
 * - Type filter on /actions list
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ─── Broadcast mock ───────────────────────────────────────────────────────────
const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({ sendEmail: vi.fn() }));

// ─── Imports (after mock registration) ───────────────────────────────────────
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { withPublicTestAuth } from './public-auth-test-helpers.js';

// ─── Server bootstrap ─────────────────────────────────────────────────────────
let server: http.Server | null = null;
let baseUrl = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = null;
}

function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, withPublicTestAuth(path, opts));
}

function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

/** Minimal valid POST body for recording an action */
function actionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actionType: 'meta_updated',
    sourceType: 'lifecycle-test',
    baselineSnapshot: { position: 5, clicks: 10, impressions: 100 },
    // B14: attribution defaults to 'platform_executed' here because these lifecycle tests
    // seed actions that represent genuinely platform-executed work (they exercise win
    // surfaces, dedup, filtering, broadcasts). Since B14 the HTTP route defaults a MISSING
    // attribution to the honest 'not_acted_on', which is correctly EXCLUDED from win
    // surfaces — so a win-surface test must seed an executed action explicitly. Individual
    // tests can override via `overrides`.
    attribution: 'platform_executed',
    ...overrides,
  };
}

/** Insert a scored outcome row directly via db (bypasses HTTP scoring pipeline) */
function insertOutcomeRow(opts: {
  actionId: string;
  score: string;
  deltaSummary?: object;
}): void {
  const id = `lc-outcome-${Math.random().toString(36).slice(2)}`;
  const delta = JSON.stringify(opts.deltaSummary ?? {
    primary_metric: 'clicks',
    baseline_value: 10,
    current_value: 20,
    delta_absolute: 10,
    delta_percent: 100,
    direction: 'improved',
  });
  db.prepare(`
    INSERT INTO action_outcomes (id, action_id, checkpoint_days, metrics_snapshot, score, delta_summary, measured_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, opts.actionId, 30, '{}', opts.score, delta);
}

// ─── Workspace IDs ────────────────────────────────────────────────────────────
let wsId = '';
let otherWsId = '';
const RUN = Date.now().toString(36);

// ─── Lifecycle ────────────────────────────────────────────────────────────────
beforeAll(async () => {
  await startTestServer();
  wsId = createWorkspace(`Outcomes Lifecycle WS ${RUN}`).id;
  otherWsId = createWorkspace(`Outcomes Lifecycle Other ${RUN}`).id;
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(otherWsId);
  deleteWorkspace(wsId);
  deleteWorkspace(otherWsId);
  await stopTestServer();
});

beforeEach(() => {
  broadcastState.calls = [];
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/outcomes/:workspaceId/scorecard
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/outcomes/:workspaceId/scorecard', () => {
  it('returns 200 with scorecard object', async () => {
    const res = await api(`/api/outcomes/${wsId}/scorecard`);
    expect(res.status).toBe(200);
    const sc = await res.json() as Record<string, unknown>;
    expect(typeof sc).toBe('object');
    expect(sc).not.toBeNull();
  });

  it('fresh workspace scorecard has all expected shape fields', async () => {
    const freshWs = createWorkspace(`SC Fresh ${RUN}`);
    try {
      const res = await api(`/api/outcomes/${freshWs.id}/scorecard`);
      expect(res.status).toBe(200);
      const sc = await res.json() as Record<string, unknown>;
      expect(typeof sc.overallWinRate).toBe('number');
      expect(typeof sc.strongWinRate).toBe('number');
      expect(typeof sc.totalTracked).toBe('number');
      expect(typeof sc.totalScored).toBe('number');
      expect(typeof sc.pendingMeasurement).toBe('number');
      expect(Array.isArray(sc.byCategory)).toBe(true);
      expect(['improving', 'stable', 'declining']).toContain(sc.trend);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('fresh workspace scorecard has zero counts and stable trend', async () => {
    const freshWs = createWorkspace(`SC Zeros ${RUN}`);
    try {
      const res = await api(`/api/outcomes/${freshWs.id}/scorecard`);
      const sc = await res.json() as Record<string, unknown>;
      expect(sc.overallWinRate).toBe(0);
      expect(sc.strongWinRate).toBe(0);
      expect(sc.totalTracked).toBe(0);
      expect(sc.totalScored).toBe(0);
      expect(sc.pendingMeasurement).toBe(0);
      expect(sc.byCategory).toHaveLength(0);
      expect(sc.trend).toBe('stable');
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/outcomes/:workspaceId/top-wins
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/outcomes/:workspaceId/top-wins', () => {
  it('returns 200 with an array', async () => {
    const res = await api(`/api/outcomes/${wsId}/top-wins`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('fresh workspace returns empty array', async () => {
    const freshWs = createWorkspace(`TopWins Fresh ${RUN}`);
    try {
      const res = await api(`/api/outcomes/${freshWs.id}/top-wins`);
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveLength(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('returns wins after a scored action is seeded', async () => {
    const seedWs = createWorkspace(`TopWins Seeded ${RUN}`);
    try {
      // Record an action via HTTP
      const r = await postJson(`/api/outcomes/${seedWs.id}/actions`, actionBody({
        sourceId: `topwin-seed-${RUN}`,
        pageUrl: 'https://example.com/page',
        targetKeyword: 'best widget',
      }));
      expect(r.status).toBe(200);
      const { action } = await r.json() as { action: { id: string } };

      // Seed a win outcome directly
      insertOutcomeRow({ actionId: action.id, score: 'strong_win' });

      const res = await api(`/api/outcomes/${seedWs.id}/top-wins`);
      expect(res.status).toBe(200);
      const wins = await res.json() as Array<Record<string, unknown>>;
      expect(wins.length).toBeGreaterThan(0);
      // Each win entry must have the TopWin shape
      const w = wins[0];
      expect(w).toHaveProperty('actionId');
      expect(w).toHaveProperty('actionType');
      expect(w).toHaveProperty('score');
      expect(['win', 'strong_win']).toContain(w.score);
    } finally {
      db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(seedWs.id);
      deleteWorkspace(seedWs.id);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/outcomes/:workspaceId/timeline
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/outcomes/:workspaceId/timeline', () => {
  it('returns 200 with an array', async () => {
    const res = await api(`/api/outcomes/${wsId}/timeline`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('fresh workspace timeline is empty', async () => {
    const freshWs = createWorkspace(`Timeline Fresh ${RUN}`);
    try {
      const res = await api(`/api/outcomes/${freshWs.id}/timeline`);
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveLength(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/outcomes/:workspaceId/learnings
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/outcomes/:workspaceId/learnings', () => {
  it('returns 200', async () => {
    const res = await api(`/api/outcomes/${wsId}/learnings`);
    expect(res.status).toBe(200);
  });

  it('fresh workspace learnings returns null', async () => {
    const freshWs = createWorkspace(`Learnings Fresh ${RUN}`);
    try {
      const res = await api(`/api/outcomes/${freshWs.id}/learnings`);
      expect(res.status).toBe(200);
      expect(await res.json()).toBeNull();
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/outcomes/:workspaceId/actions
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/outcomes/:workspaceId/actions', () => {
  it('returns 200 with array', async () => {
    const res = await api(`/api/outcomes/${wsId}/actions`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('fresh workspace actions list is empty', async () => {
    const freshWs = createWorkspace(`Actions Fresh ${RUN}`);
    try {
      const res = await api(`/api/outcomes/${freshWs.id}/actions`);
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveLength(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('filters by ?type= and returns only matching action types', async () => {
    const filterWs = createWorkspace(`Actions Filter ${RUN}`);
    try {
      // Record two different action types
      await postJson(`/api/outcomes/${filterWs.id}/actions`, actionBody({
        actionType: 'meta_updated',
        sourceId: `filter-meta-${RUN}`,
      }));
      await postJson(`/api/outcomes/${filterWs.id}/actions`, actionBody({
        actionType: 'content_published',
        sourceId: `filter-content-${RUN}`,
      }));

      const res = await api(`/api/outcomes/${filterWs.id}/actions?type=meta_updated`);
      expect(res.status).toBe(200);
      const actions = await res.json() as Array<{ actionType: string }>;
      expect(actions.length).toBeGreaterThan(0);
      for (const a of actions) {
        expect(a.actionType).toBe('meta_updated');
      }
    } finally {
      db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(filterWs.id);
      deleteWorkspace(filterWs.id);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/outcomes/:workspaceId/actions/:actionId
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/outcomes/:workspaceId/actions/:actionId', () => {
  it('returns 404 for an unknown actionId', async () => {
    const res = await api(`/api/outcomes/${wsId}/actions/nonexistent-action-xyz`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns action with outcomes array for an existing action', async () => {
    const actionWs = createWorkspace(`SingleAction ${RUN}`);
    try {
      const r = await postJson(`/api/outcomes/${actionWs.id}/actions`, actionBody({
        sourceId: `single-action-${RUN}`,
        pageUrl: 'https://example.com/single',
      }));
      expect(r.status).toBe(200);
      const { action } = await r.json() as { action: { id: string } };

      const res = await api(`/api/outcomes/${actionWs.id}/actions/${action.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.id).toBe(action.id);
      expect(body.workspaceId).toBe(actionWs.id);
      expect(Array.isArray(body.outcomes)).toBe(true);
      // Fresh action has no outcomes yet
      expect(body.outcomes).toHaveLength(0);
    } finally {
      db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(actionWs.id);
      deleteWorkspace(actionWs.id);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/outcomes/:workspaceId/actions
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/outcomes/:workspaceId/actions', () => {
  it('creates action and returns { success: true, action }', async () => {
    const postWs = createWorkspace(`POST Action ${RUN}`);
    try {
      const res = await postJson(`/api/outcomes/${postWs.id}/actions`, actionBody({
        sourceId: `post-action-${RUN}`,
      }));
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; action: Record<string, unknown> };
      expect(body.success).toBe(true);
      expect(typeof body.action.id).toBe('string');
      expect(body.action.workspaceId).toBe(postWs.id);
      expect(body.action.actionType).toBe('meta_updated');
    } finally {
      db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(postWs.id);
      deleteWorkspace(postWs.id);
    }
  });

  it('broadcasts OUTCOME_ACTION_RECORDED with actionId after successful create', async () => {
    const broadcastWs = createWorkspace(`Broadcast Action ${RUN}`);
    broadcastState.calls = [];
    try {
      const res = await postJson(`/api/outcomes/${broadcastWs.id}/actions`, actionBody({
        sourceId: `broadcast-${RUN}`,
      }));
      expect(res.status).toBe(200);
      const { action } = await res.json() as { action: { id: string } };

      const relevant = broadcastState.calls.filter(
        c => c.event === WS_EVENTS.OUTCOME_ACTION_RECORDED,
      );
      expect(relevant.length).toBeGreaterThanOrEqual(1);
      expect(relevant[0]).toMatchObject({
        workspaceId: broadcastWs.id,
        event: WS_EVENTS.OUTCOME_ACTION_RECORDED,
        payload: { actionId: action.id },
      });
    } finally {
      db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(broadcastWs.id);
      deleteWorkspace(broadcastWs.id);
    }
  });

  it('returns 400 when actionType is missing', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      sourceType: 'test',
      baselineSnapshot: { position: 5 },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when sourceType is missing', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'meta_updated',
      baselineSnapshot: { position: 5 },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when baselineSnapshot is missing', async () => {
    const res = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'meta_updated',
      sourceType: 'test',
    });
    expect(res.status).toBe(400);
  });

  it('deduplicates: second POST with same sourceId returns same action (deduplicated: true)', async () => {
    const dedupWs = createWorkspace(`Dedup ${RUN}`);
    try {
      const body = actionBody({ sourceId: `dedup-${RUN}`, sourceType: 'dedup-test' });

      const res1 = await postJson(`/api/outcomes/${dedupWs.id}/actions`, body);
      expect(res1.status).toBe(200);
      const first = await res1.json() as { action: { id: string }; deduplicated?: boolean };

      const res2 = await postJson(`/api/outcomes/${dedupWs.id}/actions`, body);
      expect(res2.status).toBe(200);
      const second = await res2.json() as { action: { id: string }; deduplicated?: boolean };

      // Same action returned, deduplication flag set on the second call
      expect(second.action.id).toBe(first.action.id);
      expect(second.deduplicated).toBe(true);
    } finally {
      db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(dedupWs.id);
      deleteWorkspace(dedupWs.id);
    }
  });

  it('action appears in /actions list and /timeline after creation', async () => {
    const lifecycleWs = createWorkspace(`Lifecycle ${RUN}`);
    try {
      const r = await postJson(`/api/outcomes/${lifecycleWs.id}/actions`, actionBody({
        sourceId: `lifecycle-appears-${RUN}`,
      }));
      expect(r.status).toBe(200);
      const { action } = await r.json() as { action: { id: string } };

      // Check /actions list
      const actionsRes = await api(`/api/outcomes/${lifecycleWs.id}/actions`);
      expect(actionsRes.status).toBe(200);
      const actions = await actionsRes.json() as Array<{ id: string }>;
      expect(actions.some(a => a.id === action.id)).toBe(true);

      // Check /timeline
      const timelineRes = await api(`/api/outcomes/${lifecycleWs.id}/timeline`);
      expect(timelineRes.status).toBe(200);
      const timeline = await timelineRes.json() as Array<{ id: string }>;
      expect(timeline.some(a => a.id === action.id)).toBe(true);
    } finally {
      db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(lifecycleWs.id);
      deleteWorkspace(lifecycleWs.id);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Workspace isolation
// ══════════════════════════════════════════════════════════════════════════════

describe('Workspace isolation', () => {
  let actionIdInWsA = '';
  const isolationWsA = { id: '' };
  const isolationWsB = { id: '' };

  beforeAll(async () => {
    const wsA = createWorkspace(`Isolation A ${RUN}`);
    const wsB = createWorkspace(`Isolation B ${RUN}`);
    isolationWsA.id = wsA.id;
    isolationWsB.id = wsB.id;

    const r = await postJson(`/api/outcomes/${wsA.id}/actions`, actionBody({
      sourceId: `isolation-a-${RUN}`,
    }));
    expect(r.status).toBe(200);
    actionIdInWsA = ((await r.json()) as { action: { id: string } }).action.id;
  });

  afterAll(() => {
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(isolationWsA.id);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(isolationWsB.id);
    deleteWorkspace(isolationWsA.id);
    deleteWorkspace(isolationWsB.id);
  });

  it('GET /actions on workspace B does not include workspace A actions', async () => {
    const res = await api(`/api/outcomes/${isolationWsB.id}/actions`);
    expect(res.status).toBe(200);
    const actions = await res.json() as Array<{ id: string }>;
    expect(actions.map(a => a.id)).not.toContain(actionIdInWsA);
  });

  it('GET /actions/:actionId with workspace B returns 404 for workspace A action', async () => {
    const res = await api(`/api/outcomes/${isolationWsB.id}/actions/${actionIdInWsA}`);
    expect(res.status).toBe(404);
  });

  it('GET /timeline on workspace B does not include workspace A actions', async () => {
    const res = await api(`/api/outcomes/${isolationWsB.id}/timeline`);
    expect(res.status).toBe(200);
    const timeline = await res.json() as Array<{ id: string }>;
    expect(timeline.map(a => a.id)).not.toContain(actionIdInWsA);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Public endpoints — no auth required on passwordless workspaces
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/public/outcomes/:workspaceId/summary — public endpoint', () => {
  it('returns 200 without any auth header (passwordless workspace)', async () => {
    // createWorkspace leaves clientPassword unset → passwordless → requireClientPortalAuth passes
    const pubWs = createWorkspace(`Public Summary ${RUN}`);
    try {
      const res = await api(`/api/public/outcomes/${pubWs.id}/summary`);
      expect(res.status).toBe(200);
    } finally {
      deleteWorkspace(pubWs.id);
    }
  });

  it('returns object with overallWinRate, totalTracked, totalScored, trend, byCategory', async () => {
    const pubWs = createWorkspace(`Public Summary Shape ${RUN}`);
    try {
      const res = await api(`/api/public/outcomes/${pubWs.id}/summary`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(typeof body.overallWinRate).toBe('number');
      expect(typeof body.totalTracked).toBe('number');
      expect(typeof body.totalScored).toBe('number');
      expect(['improving', 'stable', 'declining']).toContain(body.trend);
      expect(Array.isArray(body.byCategory)).toBe(true);
    } finally {
      deleteWorkspace(pubWs.id);
    }
  });

  it('returns 401 when workspace has a clientPassword and no auth is provided', async () => {
    // Set a client password on the workspace so requireClientPortalAuth enforces auth
    const protectedWs = createWorkspace(`Protected Summary ${RUN}`);
    db.prepare(`UPDATE workspaces SET client_password = ? WHERE id = ?`).run(
      'secret-password',
      protectedWs.id,
    );
    try {
      const res = await api(`/api/public/outcomes/${protectedWs.id}/summary`, {
        headers: { 'x-no-auto-public-auth': 'true' },
      });
      expect(res.status).toBe(401);
    } finally {
      deleteWorkspace(protectedWs.id);
    }
  });
});

describe('GET /api/public/outcomes/:workspaceId/wins — public endpoint', () => {
  it('returns 200 without any auth header (passwordless workspace)', async () => {
    const pubWs = createWorkspace(`Public Wins ${RUN}`);
    try {
      const res = await api(`/api/public/outcomes/${pubWs.id}/wins`);
      expect(res.status).toBe(200);
    } finally {
      deleteWorkspace(pubWs.id);
    }
  });

  it('returns empty array for a fresh workspace with no wins', async () => {
    const pubWs = createWorkspace(`Public Wins Empty ${RUN}`);
    try {
      const res = await api(`/api/public/outcomes/${pubWs.id}/wins`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      deleteWorkspace(pubWs.id);
    }
  });

  it('returns OutcomeWinEntry shape when a win is seeded', async () => {
    const winsWs = createWorkspace(`Public Wins Seeded ${RUN}`);
    try {
      // Record an action via HTTP
      const r = await postJson(`/api/outcomes/${winsWs.id}/actions`, actionBody({
        sourceId: `pub-win-seed-${RUN}`,
        actionType: 'content_published',
        pageUrl: 'https://example.com/win-page',
        targetKeyword: 'win keyword',
      }));
      expect(r.status).toBe(200);
      const { action } = await r.json() as { action: { id: string } };

      // Seed a strong_win directly
      insertOutcomeRow({ actionId: action.id, score: 'strong_win' });

      const res = await api(`/api/public/outcomes/${winsWs.id}/wins`);
      expect(res.status).toBe(200);
      const wins = await res.json() as Array<Record<string, unknown>>;
      expect(wins.length).toBeGreaterThan(0);

      const win = wins[0];
      expect(win).toHaveProperty('actionId');
      expect(win).toHaveProperty('actionType');
      expect(win).toHaveProperty('recommendation');
      expect(win).toHaveProperty('delta');
      expect(win).toHaveProperty('score');
      expect(win).toHaveProperty('detectedAt');
      expect(['win', 'strong_win']).toContain(win.score);
    } finally {
      db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(winsWs.id);
      deleteWorkspace(winsWs.id);
    }
  });
});
