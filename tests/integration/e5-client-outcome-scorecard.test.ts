/**
 * E5 (audit #5) — client outcome scorecard + honest win attribution.
 *
 * Covers the PUBLIC read paths (the actual client read path, per CLAUDE.md):
 *   - GET /api/public/outcomes/:wsId/summary — full scorecard serialization
 *     (strongWinRate + pendingMeasurement included, so OutcomeSummary never renders NaN)
 *   - GET /api/public/outcomes/:wsId/wins —
 *       * recommendation-sourced wins resolve the REAL recommendation title
 *       * unresolvable sources fall back to an honest generic (never the legacy
 *         fabricated "<action_type> action" string)
 *       * attributedValue (action_outcomes.attributed_value) is surfaced
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { saveRecommendations } from '../../server/recommendations.js';
import db from '../../server/db/index.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson } = ctx;

const RUN_ID = Date.now().toString(36);

beforeAll(async () => {
  await ctx.startServer();
}, 30_000);

afterAll(async () => {
  await ctx.stopServer();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function insertOutcomeRow(opts: {
  actionId: string;
  score: string;
  attributedValue?: number | null;
  deltaSummary?: object;
}): void {
  const id = `e5-outcome-${Math.random().toString(36).slice(2)}`;
  const deltaJson = JSON.stringify(opts.deltaSummary ?? {
    primary_metric: 'clicks',
    baseline_value: 10,
    current_value: 25,
    delta_absolute: 15,
    delta_percent: 150,
    direction: 'improved',
  });
  db.prepare(`
    INSERT INTO action_outcomes (id, action_id, checkpoint_days, metrics_snapshot, score, delta_summary, measured_at, attributed_value, value_basis)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
  `).run(
    id, opts.actionId, 30, '{}', opts.score, deltaJson,
    opts.attributedValue ?? null,
    opts.attributedValue != null ? 'clicks_delta_x_cpc' : null,
  );
}

async function recordActionViaApi(wsId: string, body: Record<string, unknown>): Promise<string> {
  const r = await postJson(`/api/outcomes/${wsId}/actions`, {
    baselineSnapshot: { position: 8, clicks: 10, impressions: 200 },
    // B14: default to platform_executed — these tests seed platform-executed wins that must
    // surface in the client scorecard/wins feed. Since B14 a missing attribution stores the
    // honest 'not_acted_on', which is EXCLUDED from win surfaces. Tests can override.
    attribution: 'platform_executed',
    ...body,
  });
  expect(r.status).toBe(200);
  return (await r.json()).action.id as string;
}

function makeRec(wsId: string, overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: `rec-e5-${RUN_ID}`,
    workspaceId: wsId,
    priority: 'fix_now',
    type: 'metadata',
    title: 'Rewrite the pricing page meta description',
    description: 'The pricing page meta description is truncated in SERPs.',
    insight: 'Truncated descriptions suppress CTR on a high-intent page.',
    impact: 'high',
    effort: 'low',
    impactScore: 80,
    source: 'meta-audit',
    affectedPages: ['/pricing'],
    trafficAtRisk: 120,
    impressionsAtRisk: 2400,
    estimatedGain: 'Improved CTR on the pricing page',
    actionType: 'manual',
    status: 'completed',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 1: Public summary serializes the full scorecard
// ══════════════════════════════════════════════════════════════════════════════

describe('public summary returns the full scorecard the client component renders', () => {
  let wsId = '';
  let cleanup: () => void;

  beforeAll(() => {
    const seeded = seedWorkspace({ clientPassword: '' });
    wsId = seeded.workspaceId;
    cleanup = seeded.cleanup;
  });

  afterAll(() => cleanup());

  it('includes strongWinRate and pendingMeasurement (OutcomeSummary renders both)', async () => {
    // 1 strong win + 1 pending action
    const winId = await recordActionViaApi(wsId, {
      actionType: 'meta_updated',
      sourceType: 'e5-summary',
      sourceId: `summary-win-${RUN_ID}`,
    });
    insertOutcomeRow({ actionId: winId, score: 'strong_win' });
    await recordActionViaApi(wsId, {
      actionType: 'meta_updated',
      sourceType: 'e5-summary',
      sourceId: `summary-pending-${RUN_ID}`,
    });

    const res = await api(`/api/public/outcomes/${wsId}/summary`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.strongWinRate).toBeCloseTo(1.0, 5); // 1 strong win / 1 scored
    expect(body.pendingMeasurement).toBe(2); // neither action is measurementComplete
    // Pre-existing fields keep their contract
    expect(body.overallWinRate).toBeCloseTo(1.0, 5);
    expect(body.totalScored).toBe(1);
    expect(Array.isArray(body.byCategory)).toBe(true);
  });

  // C4 (attribution honesty): a `not_acted_on` action — an unexecuted proposal — must NOT
  // count toward the client scorecard win rate or scored/confirmed-wins totals, even when its
  // outcome scored a win. The PUBLIC summary route computes the scorecard with not_acted_on
  // EXCLUDED (excludeNotActedOn: true); the admin route keeps them.
  it('excludes not_acted_on actions from the client win rate and scored counts', async () => {
    const seeded = seedWorkspace({ clientPassword: '' });
    const isolatedWs = seeded.workspaceId;
    try {
      // 1 executed win — counts.
      const executedId = await recordActionViaApi(isolatedWs, {
        actionType: 'meta_updated',
        sourceType: 'c4-executed',
        sourceId: `c4-exec-${RUN_ID}`,
        attribution: 'platform_executed',
      });
      insertOutcomeRow({ actionId: executedId, score: 'strong_win' });

      // 1 unexecuted proposal that ALSO scored a win — must be excluded.
      const proposalId = await recordActionViaApi(isolatedWs, {
        actionType: 'meta_updated',
        sourceType: 'c4-proposal',
        sourceId: `c4-prop-${RUN_ID}`,
        attribution: 'not_acted_on',
      });
      insertOutcomeRow({ actionId: proposalId, score: 'strong_win' });

      const res = await api(`/api/public/outcomes/${isolatedWs}/summary`);
      expect(res.status).toBe(200);
      const body = await res.json();

      // Only the executed win counts: 1 scored, 100% win rate — NOT 2 scored / diluted.
      expect(body.totalScored).toBe(1);
      expect(body.overallWinRate).toBeCloseTo(1.0, 5);
      expect(body.strongWinRate).toBeCloseTo(1.0, 5);
      // The proposal is dropped from totalTracked too (client sees only executed work).
      expect(body.totalTracked).toBe(1);
    } finally {
      seeded.cleanup();
    }
  });

  // C4: the not_acted_on proposal must also never appear in the "we called it" wins feed,
  // and every entry carries its honest attribution field.
  it('excludes not_acted_on from the wins feed and carries attribution on each entry', async () => {
    const seeded = seedWorkspace({ clientPassword: '' });
    const isolatedWs = seeded.workspaceId;
    try {
      const executedId = await recordActionViaApi(isolatedWs, {
        actionType: 'content_refreshed',
        sourceType: 'c4-wins-exec',
        sourceId: `c4-wins-exec-${RUN_ID}`,
        attribution: 'platform_executed',
      });
      insertOutcomeRow({ actionId: executedId, score: 'win', attributedValue: 50 });

      const proposalId = await recordActionViaApi(isolatedWs, {
        actionType: 'content_refreshed',
        sourceType: 'c4-wins-prop',
        sourceId: `c4-wins-prop-${RUN_ID}`,
        attribution: 'not_acted_on',
      });
      insertOutcomeRow({ actionId: proposalId, score: 'strong_win', attributedValue: 999 });

      const res = await api(`/api/public/outcomes/${isolatedWs}/wins`);
      expect(res.status).toBe(200);
      const wins = await res.json() as Array<Record<string, unknown>>;

      expect(wins.find(w => w.actionId === executedId)).toBeDefined();
      expect(wins.find(w => w.actionId === proposalId)).toBeUndefined();
      // Every surfaced win carries an honest, non-not_acted_on attribution.
      for (const w of wins) {
        expect(w.attribution).toBeDefined();
        expect(w.attribution).not.toBe('not_acted_on');
      }
    } finally {
      seeded.cleanup();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 2: Public wins — honest recommendation titles + attributed value
// ══════════════════════════════════════════════════════════════════════════════

describe('public wins resolve real source titles and surface attributed value', () => {
  let wsId = '';
  let cleanup: () => void;

  beforeAll(() => {
    const seeded = seedWorkspace({ clientPassword: '' });
    wsId = seeded.workspaceId;
    cleanup = seeded.cleanup;
  });

  afterAll(() => cleanup());

  it('recommendation-sourced win shows the REAL recommendation title', async () => {
    const rec = makeRec(wsId);
    saveRecommendations({
      workspaceId: wsId,
      generatedAt: new Date().toISOString(),
      recommendations: [rec],
      summary: { fixNow: 1, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 80, trafficAtRisk: 120 },
    });

    const actionId = await recordActionViaApi(wsId, {
      actionType: 'meta_updated',
      sourceType: 'recommendation',
      sourceId: rec.id,
      pageUrl: 'https://example.com/pricing',
    });
    insertOutcomeRow({ actionId, score: 'win', attributedValue: 142.5 });

    const res = await api(`/api/public/outcomes/${wsId}/wins`);
    expect(res.status).toBe(200);
    const wins = await res.json() as Array<Record<string, unknown>>;
    const entry = wins.find(w => w.actionId === actionId);
    expect(entry).toBeDefined();
    expect(entry!.recommendation).toBe('Rewrite the pricing page meta description');
  });

  it('surfaces attributedValue from the win outcome and null when absent', async () => {
    const valuedId = await recordActionViaApi(wsId, {
      actionType: 'content_refreshed',
      sourceType: 'e5-valued',
      sourceId: `valued-${RUN_ID}`,
    });
    insertOutcomeRow({ actionId: valuedId, score: 'strong_win', attributedValue: 318.4 });

    const unvaluedId = await recordActionViaApi(wsId, {
      actionType: 'internal_link_added',
      sourceType: 'e5-unvalued',
      sourceId: `unvalued-${RUN_ID}`,
    });
    insertOutcomeRow({ actionId: unvaluedId, score: 'win', attributedValue: null });

    const res = await api(`/api/public/outcomes/${wsId}/wins`);
    expect(res.status).toBe(200);
    const wins = await res.json() as Array<Record<string, unknown>>;

    const valued = wins.find(w => w.actionId === valuedId);
    expect(valued).toBeDefined();
    expect(valued!.attributedValue).toBeCloseTo(318.4, 3);

    const unvalued = wins.find(w => w.actionId === unvaluedId);
    expect(unvalued).toBeDefined();
    expect(unvalued!.attributedValue).toBeNull();
  });

  it('unresolvable source falls back to an honest generic — never the fabricated "<action_type> action"', async () => {
    const actionId = await recordActionViaApi(wsId, {
      actionType: 'schema_deployed',
      sourceType: 'unknown_system',
      sourceId: `ghost-${RUN_ID}`,
    });
    insertOutcomeRow({ actionId, score: 'win' });

    const res = await api(`/api/public/outcomes/${wsId}/wins`);
    expect(res.status).toBe(200);
    const wins = await res.json() as Array<Record<string, unknown>>;
    const entry = wins.find(w => w.actionId === actionId);
    expect(entry).toBeDefined();
    // The legacy fabrication was `${actionType.replace(/_/g, ' ')} action`
    expect(entry!.recommendation).not.toBe('schema deployed action');
    // C2/R12a: canonical client-vocabulary wording (shared/types/client-vocabulary.ts).
    expect(entry!.recommendation).toBe('Added structured data');
  });

  it('recommendation sourceId that no longer exists falls back honestly', async () => {
    const actionId = await recordActionViaApi(wsId, {
      actionType: 'audit_fix_applied',
      sourceType: 'recommendation',
      sourceId: `deleted-rec-${RUN_ID}`,
    });
    insertOutcomeRow({ actionId, score: 'win' });

    const res = await api(`/api/public/outcomes/${wsId}/wins`);
    const wins = await res.json() as Array<Record<string, unknown>>;
    const entry = wins.find(w => w.actionId === actionId);
    expect(entry).toBeDefined();
    // C2/R12a: canonical client-vocabulary wording (shared/types/client-vocabulary.ts).
    expect(entry!.recommendation).toBe('Fixed audit issue');
    expect(entry!.recommendation).not.toMatch(/ action$/);
  });

  // R6-PR1 (B11): resolution order is snapshot → live → generic.
  it('snapshot-first: uses the write-time source_label even when the LIVE source is gone', async () => {
    // No recommendation set is saved for this sourceId — the live lookup would fail and
    // degrade to the generic label. The snapshot captured at record time must win instead.
    const actionId = await recordActionViaApi(wsId, {
      actionType: 'content_published',
      sourceType: 'recommendation',
      sourceId: `snap-gone-${RUN_ID}`,
      source: {
        label: 'Snapshotted headline that outlived its source',
        snapshot: { title: 'Snapshotted headline that outlived its source', type: 'recommendation' },
      },
    });
    insertOutcomeRow({ actionId, score: 'win' });

    const res = await api(`/api/public/outcomes/${wsId}/wins`);
    const wins = await res.json() as Array<Record<string, unknown>>;
    const entry = wins.find(w => w.actionId === actionId);
    expect(entry).toBeDefined();
    // Snapshot beats both the (missing) live lookup AND the generic fallback.
    expect(entry!.recommendation).toBe('Snapshotted headline that outlived its source');
  });

  it('generic fallback stays INTACT when neither snapshot nor live source resolves (B12 demotes it, not B11)', async () => {
    const actionId = await recordActionViaApi(wsId, {
      actionType: 'meta_updated',
      sourceType: 'unknown_system',
      sourceId: `no-snap-${RUN_ID}`,
      // no `source` threaded → no snapshot; unknown_system → no live lookup.
    });
    insertOutcomeRow({ actionId, score: 'win' });

    const res = await api(`/api/public/outcomes/${wsId}/wins`);
    const wins = await res.json() as Array<Record<string, unknown>>;
    const entry = wins.find(w => w.actionId === actionId);
    expect(entry).toBeDefined();
    // The honest generic per-action-type label is still served — the fallback is NOT deleted.
    // C2/R12a: canonical client-vocabulary wording (shared/types/client-vocabulary.ts).
    expect(entry!.recommendation).toBe('Updated meta description');
  });
});
