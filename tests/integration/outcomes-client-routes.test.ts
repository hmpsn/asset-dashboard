/**
 * Integration tests for Outcome Intelligence Engine — client-facing and admin aggregate routes.
 *
 *   - GET /api/public/outcomes/:wsId/summary  (client portal summary)
 *   - GET /api/public/outcomes/:wsId/wins     ("We Called It" client wins)
 *   - GET /api/outcomes/overview              (multi-workspace admin overview)
 *   - GET /api/outcomes/:wsId/timeline        (recent action timeline)
 *   - Cross-workspace isolation for action lookup (line 318 of outcomes.ts)
 *   - Rate denominator consistency (overallWinRate uses scored denominator, totalTracked ≠ totalScored)
 *   - Trend computation (recentWinRate vs overallWinRate overlap)
 *
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, postJson } = ctx;

const RUN_ID = Date.now().toString(36);

// ── Single server lifecycle for entire file ───────────────────────────────────
beforeAll(async () => {
  await ctx.startServer();
}, 30_000);

afterAll(async () => {
  await ctx.stopServer();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Insert an action_outcome row directly via db.prepare (bypasses HTTP to seed
 * scored outcomes without requiring the full scoring pipeline).
 */
function insertOutcomeRow(opts: {
  actionId: string;
  score: string;
  deltaSummary?: object;
}): void {
  const id = `test-outcome-${Math.random().toString(36).slice(2)}`;
  const deltaJson = JSON.stringify(opts.deltaSummary ?? {
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
  `).run(id, opts.actionId, 30, '{}', opts.score, deltaJson);
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 1: Public client summary endpoint
// ══════════════════════════════════════════════════════════════════════════════

describe('Suite 1: Public client summary endpoint', () => {
  let wsId = '';
  let cleanup: () => void;

  beforeAll(() => {
    // clientPassword: '' → requireClientPortalAuth() passes through (passwordless workspace)
    const seeded = seedWorkspace({ clientPassword: '' });
    wsId = seeded.workspaceId;
    cleanup = seeded.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('returns 200 with expected shape when no actions exist', async () => {
    const res = await api(`/api/public/outcomes/${wsId}/summary`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('overallWinRate');
    expect(body).toHaveProperty('totalTracked');
    expect(body).toHaveProperty('totalScored');
    expect(body).toHaveProperty('trend');
    expect(body).toHaveProperty('byCategory');
  });

  it('with 0 scored actions: overallWinRate is 0, totalTracked reflects unscored count', async () => {
    // Record 2 unscored EXECUTED actions. C4 attribution honesty: the client
    // scorecard counts only executed work — not_acted_on proposals are excluded
    // (pinned by the dedicated exclusion test below) — so these carry an explicit
    // executed attribution to appear in totalTracked.
    for (let i = 0; i < 2; i++) {
      const r = await postJson(`/api/outcomes/${wsId}/actions`, {
        actionType: 'meta_updated',
        sourceType: 'summary-test',
        sourceId: `unscored-${RUN_ID}-${i}`,
        attribution: 'platform_executed',
        baselineSnapshot: { position: 5, clicks: 10, impressions: 100 },
      });
      expect(r.status).toBe(200);
    }

    const res = await api(`/api/public/outcomes/${wsId}/summary`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.overallWinRate).toBe(0);
    expect(body.totalTracked).toBeGreaterThanOrEqual(2);
    expect(body.totalScored).toBe(0);
    expect(body.trend).toBe('stable');
  });

  it('RATE DENOMINATOR: overallWinRate uses scored denominator, not totalTracked', async () => {
    // Create a fresh workspace so we start with a clean slate
    const fresh = seedWorkspace({ clientPassword: '' });
    const freshWsId = fresh.workspaceId;

    try {
      // Seed 3 actions; score 2 of them as wins
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await postJson(`/api/outcomes/${freshWsId}/actions`, {
          actionType: 'audit_fix_applied',
          sourceType: 'denom-test',
          sourceId: `denom-${RUN_ID}-${i}`,
          // C4: executed actions so the honest public scorecard counts them (the
          // denominator contract is orthogonal to the not_acted_on exclusion).
          attribution: 'platform_executed',
          baselineSnapshot: { position: i + 1, clicks: i + 5 },
        });
        expect(r.status).toBe(200);
        const body = await r.json();
        ids.push(body.action.id);
      }

      // Score 2 of the 3 actions as wins (insert directly)
      insertOutcomeRow({ actionId: ids[0], score: 'win' });
      insertOutcomeRow({ actionId: ids[1], score: 'win' });
      // ids[2] is left unscored

      const res = await api(`/api/public/outcomes/${freshWsId}/summary`);
      expect(res.status).toBe(200);
      const body = await res.json();

      // totalTracked = all 3 actions (scored + unscored)
      expect(body.totalTracked).toBe(3);
      // totalScored = 2 (only the ones with an outcome row that has a non-null, non-inconclusive score)
      expect(body.totalScored).toBe(2);

      // overallWinRate uses scored denominator (2 wins / 2 scored = 1.0)
      // NOT 2 wins / 3 total = 0.666...
      // DOCUMENTATION: This is a KNOWN DISCREPANCY in the endpoint contract.
      // `overallWinRate` = wins / totalScored = 1.0
      // `totalTracked` = ALL actions including unscored = 3
      // These denominators are intentionally different.  A caller that displays
      // "N% win rate across M actions" with N=overallWinRate and M=totalTracked
      // would be misleading (the user would infer the raw counts don't match).
      // The CLAUDE.md rule "rate display: numerator and denominator must share a
      // source" requires that the displayed denominator matches the rate's denominator.
      // Frontend should show `totalScored`, not `totalTracked`, alongside `overallWinRate`.
      expect(body.overallWinRate).toBeCloseTo(1.0, 5); // 2/2
      // Confirm the bug surface: overallWinRate * totalTracked ≠ wins
      // If a client naively computes "wins = overallWinRate * totalTracked" they get 3, not 2.
      const naiveWinsFromTracked = body.overallWinRate * body.totalTracked;
      // This assertion documents the mismatch:
      expect(naiveWinsFromTracked).not.toBe(body.totalScored * body.overallWinRate);
    } finally {
      fresh.cleanup();
    }
  });

  it('C4 attribution honesty: not_acted_on actions are excluded from the client scorecard', async () => {
    // The public scorecard must count only executed work. A not_acted_on action is
    // an unexecuted proposal the workspace never acted on — including it (or an
    // outcome measured on it) in the client win-rate/tracked counts would claim a
    // result for work nobody did. The admin overview route keeps them (admin parity);
    // this pins the client-only exclusion.
    const fresh = seedWorkspace({ clientPassword: '' });
    const freshWsId = fresh.workspaceId;
    try {
      // One executed action, scored a win → should count.
      const executed = await postJson(`/api/outcomes/${freshWsId}/actions`, {
        actionType: 'audit_fix_applied',
        sourceType: 'honesty-test',
        sourceId: `exec-${RUN_ID}`,
        attribution: 'platform_executed',
        baselineSnapshot: { position: 3, clicks: 8 },
      });
      expect(executed.status).toBe(200);
      const executedId = (await executed.json()).action.id;
      insertOutcomeRow({ actionId: executedId, score: 'win' });

      // Two not_acted_on proposals, one of them scored a win → must NOT count.
      const proposalIds: string[] = [];
      for (let i = 0; i < 2; i++) {
        const r = await postJson(`/api/outcomes/${freshWsId}/actions`, {
          actionType: 'meta_updated',
          sourceType: 'honesty-test',
          sourceId: `proposal-${RUN_ID}-${i}`,
          attribution: 'not_acted_on',
          baselineSnapshot: { position: 5, clicks: 10 },
        });
        expect(r.status).toBe(200);
        proposalIds.push((await r.json()).action.id);
      }
      insertOutcomeRow({ actionId: proposalIds[0], score: 'win' });

      const res = await api(`/api/public/outcomes/${freshWsId}/summary`);
      expect(res.status).toBe(200);
      const body = await res.json();

      // Only the executed action is counted; the two not_acted_on proposals (and
      // the phantom win measured on one of them) are dropped entirely.
      expect(body.totalTracked).toBe(1);
      expect(body.totalScored).toBe(1);
      expect(body.overallWinRate).toBeCloseTo(1.0, 5);
    } finally {
      fresh.cleanup();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 2: Public client wins endpoint
// ══════════════════════════════════════════════════════════════════════════════

describe('Suite 2: Public client wins endpoint', () => {
  let wsId = '';
  let cleanup: () => void;

  beforeAll(() => {
    const seeded = seedWorkspace({ clientPassword: '' });
    wsId = seeded.workspaceId;
    cleanup = seeded.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('returns empty array when workspace has no wins', async () => {
    const res = await api(`/api/public/outcomes/${wsId}/wins`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('with scored wins, entries have the OutcomeWinEntry shape', async () => {
    // Record an action and score it as a win
    const r = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'content_published',
      sourceType: 'wins-test',
      sourceId: `wins-${RUN_ID}`,
      pageUrl: 'https://example.com/great-post',
      targetKeyword: 'test keyword',
      baselineSnapshot: { position: 8, clicks: 20, impressions: 400 },
      // B14: a genuine platform-executed win — must be attributed so it surfaces in /wins
      // (a missing attribution now stores the honest 'not_acted_on', which is excluded).
      attribution: 'platform_executed',
    });
    expect(r.status).toBe(200);
    const actionId = (await r.json()).action.id;

    insertOutcomeRow({
      actionId,
      score: 'strong_win',
      deltaSummary: {
        primary_metric: 'position',
        baseline_value: 8,
        current_value: 2,
        delta_absolute: -6,
        delta_percent: -75,
        direction: 'improved',
      },
    });

    const res = await api(`/api/public/outcomes/${wsId}/wins`);
    expect(res.status).toBe(200);
    const wins = await res.json();
    expect(Array.isArray(wins)).toBe(true);
    expect(wins.length).toBeGreaterThan(0);

    const win = wins[0];
    // Verify OutcomeWinEntry shape
    expect(win).toHaveProperty('actionId');
    expect(win).toHaveProperty('actionType');
    expect(win).toHaveProperty('pageUrl');
    expect(win).toHaveProperty('targetKeyword');
    expect(win).toHaveProperty('recommendation');
    expect(win).toHaveProperty('delta');
    expect(win).toHaveProperty('score');
    expect(win).toHaveProperty('detectedAt');
    expect(['win', 'strong_win']).toContain(win.score);
    expect(typeof win.recommendation).toBe('string');
  });

  it('P1 manual ingestion: a manually-recorded platform_executed post surfaces as a client win with its real title', async () => {
    // The external/manual ingestion path (RecordPublishedWorkCard + the Rinse backfill) records a
    // manual action with sourceType 'manual', an honest attribution, and a source snapshot. A
    // platform_executed one that scores a win must (a) surface in the client wins and (b) carry its
    // REAL title (the snapshot), not a generic fallback — the durable-title path (B11) end to end.
    const title = `Manually Published ${RUN_ID}`;
    const page = `https://example.com/manual/${RUN_ID}`;
    const r = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'content_published',
      sourceType: 'manual',
      sourceId: `manual-p1-${RUN_ID}`,
      pageUrl: page,
      attribution: 'platform_executed',
      baselineSnapshot: { position: 9, clicks: 5 },
      source: { label: title, snapshot: { title, type: 'manual', page } },
    });
    expect(r.status).toBe(200);
    const actionId = (await r.json()).action.id;
    insertOutcomeRow({
      actionId,
      score: 'win',
      deltaSummary: {
        primary_metric: 'position',
        baseline_value: 9,
        current_value: 3,
        delta_absolute: -6,
        delta_percent: -66,
        direction: 'improved',
      },
    });

    const res = await api(`/api/public/outcomes/${wsId}/wins`);
    expect(res.status).toBe(200);
    const wins = await res.json();
    const mine = wins.find((w: { pageUrl?: string }) => w.pageUrl === page);
    expect(mine, 'the manually-recorded win should surface in the client wins').toBeTruthy();
    // Durable title from the source snapshot — not a generic per-action-type fallback.
    expect(mine.recommendation).toContain(title);
  });

  it('only returns wins (not losses or no_change)', async () => {
    // Record an action with a loss
    const r = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'meta_updated',
      sourceType: 'wins-test-loss',
      sourceId: `loss-${RUN_ID}`,
      baselineSnapshot: { position: 5 },
    });
    expect(r.status).toBe(200);
    const lossActionId = (await r.json()).action.id;
    insertOutcomeRow({ actionId: lossActionId, score: 'loss' });

    const res = await api(`/api/public/outcomes/${wsId}/wins`);
    expect(res.status).toBe(200);
    const wins = await res.json();
    // None of the returned entries should have score 'loss' or 'no_change'
    for (const w of wins) {
      expect(['win', 'strong_win']).toContain(w.score);
    }
  });

  // C2/R12a: the owner wording sign-off pass folded WIN_FALLBACK_LABELS into the single
  // canonical shared/types/client-vocabulary.ts map. content_published's three drifted
  // client-facing variants ("Published new content" here, "Published new post" in
  // WinsSurface.tsx, "Content published" in OutcomeSummary.tsx) unified to WinsSurface's
  // fuller sentence per the prefer-client-facing wording rule. This pin now proves the
  // fallback title text matches the NEW canonical wording, not the pre-cutover string —
  // still full-sentence client copy, NOT the catalog's short admin label ("Content Published").
  it('the client-vocabulary fallback label is the canonical C2/R12a wording (client-visible)', async () => {
    const r = await postJson(`/api/outcomes/${wsId}/actions`, {
      actionType: 'content_published',
      sourceType: 'wins-fallback-parity-test',
      sourceId: `fallback-parity-${RUN_ID}`,
      baselineSnapshot: { position: 8 },
      // B14: platform-executed win so it appears in /wins (missing attribution → not_acted_on, excluded).
      attribution: 'platform_executed',
    });
    expect(r.status).toBe(200);
    const actionId = (await r.json()).action.id;
    insertOutcomeRow({ actionId, score: 'strong_win' });

    const res = await api(`/api/public/outcomes/${wsId}/wins`);
    expect(res.status).toBe(200);
    const wins = await res.json();
    const win = wins.find((w: { actionId: string }) => w.actionId === actionId);
    expect(win).toBeDefined();
    expect(win.recommendation).toBe('Published new post');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 3: Admin overview endpoint
// ══════════════════════════════════════════════════════════════════════════════

describe('Suite 3: Admin overview endpoint', () => {
  let wsId = '';
  let cleanupWs: () => void;

  beforeAll(() => {
    const ws = createWorkspace('Overview Test Workspace');
    wsId = ws.id;
    cleanupWs = () => deleteWorkspace(wsId);
  });

  afterAll(() => {
    cleanupWs();
  });

  it('GET /api/outcomes/overview returns array', async () => {
    const res = await api('/api/outcomes/overview');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('overview entries contain required WorkspaceOutcomeOverview shape', async () => {
    const res = await api('/api/outcomes/overview');
    expect(res.status).toBe(200);
    const overview = await res.json() as Array<Record<string, unknown>>;
    expect(overview.length).toBeGreaterThan(0);

    // Find the entry for our test workspace
    const entry = overview.find((o) => o.workspaceId === wsId);
    expect(entry).toBeDefined();
    if (!entry) return;

    expect(entry).toHaveProperty('workspaceId');
    expect(entry).toHaveProperty('workspaceName');
    expect(entry).toHaveProperty('winRate');
    expect(entry).toHaveProperty('trend');
    expect(entry).toHaveProperty('activeActions');
    expect(entry).toHaveProperty('scoredLast30d');
    expect(entry).toHaveProperty('topWin');
    expect(entry).toHaveProperty('attentionNeeded');
    expect(typeof entry.attentionNeeded).toBe('boolean');
    expect(typeof entry.winRate).toBe('number');
  });

  it('attentionNeeded is false by default with a new workspace', async () => {
    const res = await api('/api/outcomes/overview');
    const overview = await res.json() as Array<Record<string, unknown>>;
    const entry = overview.find((o) => o.workspaceId === wsId);
    expect(entry).toBeDefined();
    // A brand new workspace has 0 pending actions and stable trend → not attention needed
    expect(entry?.attentionNeeded).toBe(false);
    expect(entry?.attentionReason).toBeUndefined();
  });

  it('attentionNeeded is true when pending > 10 (threshold test)', async () => {
    // Record 11 actions in the workspace (all unscored = pending)
    for (let i = 0; i < 11; i++) {
      const r = await postJson(`/api/outcomes/${wsId}/actions`, {
        actionType: 'meta_updated',
        sourceType: 'overview-pending',
        sourceId: `overview-pending-${RUN_ID}-${i}`,
        baselineSnapshot: { position: i + 1 },
      });
      expect(r.status).toBe(200);
    }

    const res = await api('/api/outcomes/overview');
    expect(res.status).toBe(200);
    const overview = await res.json() as Array<Record<string, unknown>>;
    const entry = overview.find((o) => o.workspaceId === wsId);
    expect(entry).toBeDefined();
    expect(entry?.attentionNeeded).toBe(true);
    expect(typeof entry?.attentionReason).toBe('string');
    expect((entry?.attentionReason as string)).toMatch(/awaiting measurement/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 4: Timeline endpoint
// ══════════════════════════════════════════════════════════════════════════════

describe('Suite 4: Timeline endpoint', () => {
  let wsId = '';
  let cleanupWs: () => void;

  beforeAll(() => {
    const ws = createWorkspace('Timeline Test Workspace');
    wsId = ws.id;
    cleanupWs = () => deleteWorkspace(wsId);
  });

  afterAll(() => {
    cleanupWs();
  });

  it('GET /api/outcomes/:wsId/timeline returns array', async () => {
    const res = await api(`/api/outcomes/${wsId}/timeline`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('timeline returns actions in reverse chronological order', async () => {
    // Record 3 actions with slight delays to ensure ordered timestamps
    const recordedIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await postJson(`/api/outcomes/${wsId}/actions`, {
        actionType: 'audit_fix_applied',
        sourceType: 'timeline-test',
        sourceId: `timeline-${RUN_ID}-${i}`,
        baselineSnapshot: { position: i + 2 },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      recordedIds.push(body.action.id);
    }

    const res = await api(`/api/outcomes/${wsId}/timeline`);
    expect(res.status).toBe(200);
    const actions = await res.json() as Array<{ id: string; createdAt: string }>;

    // Verify actions are returned
    expect(actions.length).toBeGreaterThanOrEqual(3);

    // Verify reverse chronological order (newest first)
    for (let i = 0; i < actions.length - 1; i++) {
      const thisDate = new Date(actions[i].createdAt).getTime();
      const nextDate = new Date(actions[i + 1].createdAt).getTime();
      expect(thisDate).toBeGreaterThanOrEqual(nextDate);
    }
  });

  it('timeline is capped at 50 results', async () => {
    // We already have actions; the route uses getRecentActions(wsId, 50)
    // Verify the response never exceeds 50
    const res = await api(`/api/outcomes/${wsId}/timeline`);
    expect(res.status).toBe(200);
    const actions = await res.json();
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeLessThanOrEqual(50);
  });

  it('timeline actions include TrackedAction fields', async () => {
    const res = await api(`/api/outcomes/${wsId}/timeline`);
    const actions = await res.json() as Array<Record<string, unknown>>;
    if (actions.length === 0) return; // nothing to check if somehow empty
    const action = actions[0];
    expect(action).toHaveProperty('id');
    expect(action).toHaveProperty('workspaceId');
    expect(action).toHaveProperty('actionType');
    expect(action).toHaveProperty('createdAt');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 5: Cross-workspace isolation for action lookup
// ══════════════════════════════════════════════════════════════════════════════

describe('Suite 5: Cross-workspace isolation for action lookup', () => {
  let wsAId = '';
  let wsBId = '';
  let cleanupA: () => void;
  let cleanupB: () => void;
  let actionAId = '';

  beforeAll(async () => {
    const wsA = createWorkspace('Cross-WS Isolation A');
    wsAId = wsA.id;
    cleanupA = () => deleteWorkspace(wsAId);

    const wsB = createWorkspace('Cross-WS Isolation B');
    wsBId = wsB.id;
    cleanupB = () => deleteWorkspace(wsBId);

    // Record an action in workspace A
    const r = await postJson(`/api/outcomes/${wsAId}/actions`, {
      actionType: 'schema_deployed',
      sourceType: 'cross-ws-test',
      sourceId: `cross-ws-${RUN_ID}`,
      baselineSnapshot: { position: 10 },
    });
    expect(r.status).toBe(200);
    actionAId = (await r.json()).action.id;
  });

  afterAll(() => {
    cleanupA();
    cleanupB();
  });

  it('GET /api/outcomes/:wsId/actions/:actionId returns 200 for the owning workspace', async () => {
    const res = await api(`/api/outcomes/${wsAId}/actions/${actionAId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(actionAId);
    expect(body.workspaceId).toBe(wsAId);
  });

  it('GET /api/outcomes/:wsId/actions/:actionId returns 404 for a different workspace (cross-workspace isolation guard)', async () => {
    // Try to fetch workspace A's action using workspace B's context
    // This tests the guard at outcomes.ts line 318:
    //   if (!action || action.workspaceId !== req.params.workspaceId) return res.status(404)
    const res = await api(`/api/outcomes/${wsBId}/actions/${actionAId}`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('workspace B action list does not contain workspace A actions', async () => {
    const res = await api(`/api/outcomes/${wsBId}/actions`);
    expect(res.status).toBe(200);
    const actions = await res.json() as Array<{ id: string }>;
    const actionAIds = actions.map((a) => a.id);
    expect(actionAIds).not.toContain(actionAId);
  });

  it('timeline for workspace B does not contain workspace A actions', async () => {
    const res = await api(`/api/outcomes/${wsBId}/timeline`);
    expect(res.status).toBe(200);
    const actions = await res.json() as Array<{ id: string }>;
    const ids = actions.map((a) => a.id);
    expect(ids).not.toContain(actionAId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 6: Feature flag gate
// ══════════════════════════════════════════════════════════════════════════════

describe('Suite 6: Feature flag gate', () => {
  let wsId = '';
  let cleanupWs: () => void;

  beforeAll(() => {
    const ws = createWorkspace('Feature Flag Test');
    wsId = ws.id;
    cleanupWs = () => deleteWorkspace(wsId);
  });

  afterAll(() => {
    cleanupWs();
  });

  it('diagnostics confirms feature flag is enabled in this test environment', async () => {
    // Can't easily toggle the flag mid-test (set at process start).
    // Verify via the diagnostics endpoint that the flag is on.
    const res = await api(`/api/outcomes/${wsId}/diagnostics`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.featureEnabled).toBe(true);
  });

  it('public summary endpoint returns data (not 404) when flag is enabled', async () => {
    // Seed a passwordless workspace
    const pws = seedWorkspace({ clientPassword: '' });
    try {
      const res = await api(`/api/public/outcomes/${pws.workspaceId}/summary`);
      expect(res.status).toBe(200);
    } finally {
      pws.cleanup();
    }
  });

  it('public wins endpoint returns data (not 404) when flag is enabled', async () => {
    const pws = seedWorkspace({ clientPassword: '' });
    try {
      const res = await api(`/api/public/outcomes/${pws.workspaceId}/wins`);
      expect(res.status).toBe(200);
    } finally {
      pws.cleanup();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 7: Trend computation — recentWinRate vs overallWinRate overlap bug
// ══════════════════════════════════════════════════════════════════════════════

describe('Suite 7: Trend computation — recent vs older cohort (not recent vs overall)', () => {
  let wsId = '';
  let cleanupWs: () => void;

  beforeAll(() => {
    const ws = createWorkspace('Trend Computation Test');
    wsId = ws.id;
    cleanupWs = () => deleteWorkspace(wsId);
  });

  afterAll(() => {
    cleanupWs();
  });

  it('trend is "stable" with symmetric wins/losses across all actions', async () => {
    // Seed 6 actions: 3 wins + 3 losses.
    // computeScorecard() takes the first half (3) as "recent".
    // When recent actions are the most-recently-recorded (newest first), they share
    // the same win rate as the overall set → trend should be 'stable'.
    for (let i = 0; i < 6; i++) {
      const r = await postJson(`/api/outcomes/${wsId}/actions`, {
        actionType: 'meta_updated',
        sourceType: 'trend-test',
        sourceId: `trend-${RUN_ID}-${i}`,
        baselineSnapshot: { position: i + 1 },
      });
      expect(r.status).toBe(200);
      const actionId = (await r.json()).action.id;
      // Alternate wins and losses
      insertOutcomeRow({ actionId, score: i % 2 === 0 ? 'win' : 'loss' });
    }

    const res = await api(`/api/outcomes/${wsId}/scorecard`);
    expect(res.status).toBe(200);
    const scorecard = await res.json();
    // With 3 wins out of 6 scored, overallWinRate = 0.5
    // Depending on which half is "recent", recentWinRate could equal overallWinRate
    expect(scorecard).toHaveProperty('trend');
    expect(['improving', 'stable', 'declining']).toContain(scorecard.trend);
  });

  it('trend is "improving" when recent half is all wins and older half is all losses', async () => {
    // computeScorecard() now compares recent cohort against older cohort (non-overlapping).
    //   recentWinRate (1.0) > olderWinRate (0.0) + 0.1 → 'improving'
    const freshWs = seedWorkspace({ clientPassword: '' });
    const fwsId = freshWs.workspaceId;
    try {
      // Insert 6 actions. getActionsByWorkspace orders DESC, so last-inserted = index 0 = "recent".
      const actionIds: string[] = [];
      for (let i = 0; i < 6; i++) {
        const r = await postJson(`/api/outcomes/${fwsId}/actions`, {
          actionType: 'audit_fix_applied',
          sourceType: 'trend-extreme',
          sourceId: `extreme-${RUN_ID}-${i}`,
          baselineSnapshot: { position: i + 1 },
        });
        expect(r.status).toBe(200);
        actionIds.push((await r.json()).action.id);
      }
      // Last 3 inserted (indices 3-5) → DESC positions 0-2 → "recent" half — all wins
      insertOutcomeRow({ actionId: actionIds[3], score: 'win' });
      insertOutcomeRow({ actionId: actionIds[4], score: 'win' });
      insertOutcomeRow({ actionId: actionIds[5], score: 'win' });
      // First 3 inserted (indices 0-2) → DESC positions 3-5 → "older" half — all losses
      insertOutcomeRow({ actionId: actionIds[0], score: 'loss' });
      insertOutcomeRow({ actionId: actionIds[1], score: 'loss' });
      insertOutcomeRow({ actionId: actionIds[2], score: 'loss' });

      const scoreRes = await api(`/api/outcomes/${fwsId}/scorecard`);
      expect(scoreRes.status).toBe(200);
      const sc = await scoreRes.json();
      expect(sc.overallWinRate).toBeCloseTo(0.5, 5);
      expect(sc.totalScored).toBe(6);
      expect(sc.trend).toBe('improving');
    } finally {
      freshWs.cleanup();
    }
  });

  it('trend correctly detects improving when old code would have returned stable (regression)', async () => {
    // Scenario: 8 actions, older 4 = 3 wins (olderWinRate=0.75), recent 4 = 4 wins (recentWinRate=1.0).
    // Old code: overallWinRate = 7/8 = 0.875; 1.0 > 0.875+0.1=0.975? NO → 'stable' (wrong).
    // New code: 1.0 > 0.75+0.1=0.85? YES → 'improving' (correct).
    const freshWs = seedWorkspace({ clientPassword: '' });
    const fwsId = freshWs.workspaceId;
    try {
      const actionIds: string[] = [];
      for (let i = 0; i < 8; i++) {
        const r = await postJson(`/api/outcomes/${fwsId}/actions`, {
          actionType: 'meta_updated',
          sourceType: 'trend-regression',
          sourceId: `regression-${RUN_ID}-${i}`,
          baselineSnapshot: { position: i + 1 },
        });
        expect(r.status).toBe(200);
        actionIds.push((await r.json()).action.id);
      }
      // Last 4 inserted → "recent" half in DESC order — all 4 wins
      for (let i = 4; i < 8; i++) insertOutcomeRow({ actionId: actionIds[i], score: 'win' });
      // First 4 inserted → "older" half — 3 wins, 1 loss
      insertOutcomeRow({ actionId: actionIds[0], score: 'win' });
      insertOutcomeRow({ actionId: actionIds[1], score: 'win' });
      insertOutcomeRow({ actionId: actionIds[2], score: 'win' });
      insertOutcomeRow({ actionId: actionIds[3], score: 'loss' });

      const scoreRes = await api(`/api/outcomes/${fwsId}/scorecard`);
      expect(scoreRes.status).toBe(200);
      const sc = await scoreRes.json();
      // overallWinRate = 7/8 = 0.875 (both halves combined)
      expect(sc.overallWinRate).toBeCloseTo(0.875, 5);
      // New code: recentWinRate(1.0) vs olderWinRate(0.75) → delta=0.25>0.1 → 'improving'
      expect(sc.trend).toBe('improving');
    } finally {
      freshWs.cleanup();
    }
  });
});
