/**
 * A5 (audit #20) — predictedEmv snapshots on ALL completion paths + effort priors +
 * P6 realized-vs-predicted calibration cron.
 *
 * Asserts:
 *  1. LIVE path — PATCH /api/public/recommendations/:ws/:rec → completed snapshots the
 *     rec's opportunity.predictedEmv onto the tracked action (regression guard).
 *  2. BACKFILL path — backfillCompletedRecommendations snapshots predictedEmv from the
 *     rec blob (the audit found it hardcoded null) and stays honest (null) for recs
 *     without an opportunity. Idempotent.
 *  3. REPAIR pass — backfillPredictedEmvSnapshots fills NULL snapshots on existing
 *     recommendation-sourced actions from the blob, never overwrites a non-NULL
 *     snapshot, never fills from a 0/absent prediction, and is idempotent.
 *  4. EFFORT priors — runEmvCalibration aggregates rec-createdAt → action-createdAt
 *     into a per-actionType median effortDays; backfill-flagged actions are excluded
 *     (their created_at is the backfill run time, not completion time); below the
 *     sample floor no prior is fabricated.
 *  5. CALIBRATION — realized attributed_value vs predicted_emv median ratio per
 *     actionType: conclusive at >= MIN_CALIBRATION_PAIRS, honest `inconclusive` (NULL
 *     ratio) below the floor, and actions with missing snapshots or not_acted_on
 *     attribution contribute nothing (FM-2: never fabricated).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations } from '../../server/recommendations.js';
import {
  recordAction,
  recordOutcome,
  getActionByWorkspaceAndSource,
  getAction,
} from '../../server/outcome-tracking.js';
import {
  backfillCompletedRecommendations,
  backfillPredictedEmvSnapshots,
} from '../../server/outcome-backfill.js';
import {
  runEmvCalibration,
  getEmvCalibrationForWorkspace,
  getEffortPriorDays,
  MIN_CALIBRATION_PAIRS,
  MIN_EFFORT_SAMPLES,
} from '../../server/outcome-emv-calibration.js';
import type { Recommendation, RecommendationSet, OpportunityScore } from '../../shared/types/recommendations.js';
import type { ActionType, Attribution, SourceFlag } from '../../shared/types/outcome-tracking.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { patchJson } = ctx;

let wsId = '';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOpp(predictedEmv: number): OpportunityScore {
  return {
    value: 50,
    emvPerWeek: predictedEmv / 12,
    predictedEmv,
    roiPerEffortDay: 50,
    confidence: 1.0,
    calibration: 1.0,
    groundedSpine: 'computed',
    components: [],
    calibrationVersion: 'platform-default',
    modelVersion: 'ov-1',
  };
}

function makeRec(overrides: Partial<Recommendation> & { id: string }): Recommendation {
  const now = new Date().toISOString();
  return {
    workspaceId: wsId,
    priority: 'fix_soon',
    type: 'technical',
    title: `rec ${overrides.id}`,
    description: '',
    insight: '',
    impact: 'medium',
    effort: 'medium',
    impactScore: 50,
    source: 'audit:speed',
    affectedPages: [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: 'gain',
    actionType: 'manual',
    status: 'pending',
    assignedTo: 'client',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedRecSet(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: {
      fixNow: 0,
      fixSoon: recs.length,
      fixLater: 0,
      ongoing: 0,
      totalImpactScore: 0,
      trafficAtRisk: 0,
      topRecommendationId: null,
    },
  };
  saveRecommendations(set);
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function seedRecAction(opts: {
  sourceId: string;
  actionType?: ActionType;
  predictedEmv?: number | null;
  sourceFlag?: SourceFlag;
  attribution?: Attribution;
}): string {
  const action = recordAction({ // recordAction-ok: wsId created in beforeAll
    workspaceId: wsId,
    actionType: opts.actionType ?? 'audit_fix_applied',
    sourceType: 'recommendation',
    sourceId: opts.sourceId,
    pageUrl: null,
    targetKeyword: null,
    baselineSnapshot: { captured_at: new Date().toISOString() },
    sourceFlag: opts.sourceFlag ?? 'live',
    baselineConfidence: 'exact',
    attribution: opts.attribution ?? 'platform_executed',
    predictedEmv: opts.predictedEmv ?? null,
  });
  return action.id;
}

function seedConclusiveOutcome(actionId: string, attributedValue: number): void {
  recordOutcome({
    actionId,
    checkpointDays: 30,
    metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 100 },
    score: 'win',
    deltaSummary: {
      primary_metric: 'clicks',
      baseline_value: 50,
      current_value: 100,
      delta_absolute: 50,
      delta_percent: 100,
      direction: 'improved',
    },
    attributedValue,
    valueBasis: 'clicks_delta_x_cpc',
  });
}

function cleanWorkspaceRows(): void {
  db.prepare('DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id = ?)').run(wsId);
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM outcome_emv_calibration WHERE workspace_id = ?').run(wsId);
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('A5 Predicted EMV Test Workspace');
  wsId = ws.id;
}, 30_000);

afterAll(async () => {
  cleanWorkspaceRows();
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

beforeEach(() => {
  cleanWorkspaceRows();
});

// ── 1. Live completion path ──────────────────────────────────────────────────

describe('live PATCH completion path', () => {
  it('snapshots the rec opportunity.predictedEmv onto the tracked action', async () => {
    seedRecSet([makeRec({ id: 'rec-live', opportunity: makeOpp(480) })]);

    const res = await patchJson(`/api/public/recommendations/${wsId}/rec-live`, { status: 'completed' });
    expect(res.status).toBe(200);

    const action = getActionByWorkspaceAndSource(wsId, 'recommendation', 'rec-live');
    expect(action).not.toBeNull();
    expect(action!.predictedEmv).toBe(480);
  });
});

// ── 2. Backfill completion path ──────────────────────────────────────────────

describe('backfill completion path', () => {
  it('snapshots predictedEmv from the rec blob and stays null-honest without an opportunity', () => {
    seedRecSet([
      makeRec({ id: 'rec-bf-emv', status: 'completed', opportunity: makeOpp(240) }),
      makeRec({ id: 'rec-bf-noopp', status: 'completed' }),
    ]);

    const created = backfillCompletedRecommendations(wsId);
    expect(created).toBe(2);

    const withEmv = getActionByWorkspaceAndSource(wsId, 'recommendation', 'rec-bf-emv');
    expect(withEmv).not.toBeNull();
    expect(withEmv!.predictedEmv).toBe(240);

    // No opportunity on the rec → honest null, never fabricated.
    const withoutOpp = getActionByWorkspaceAndSource(wsId, 'recommendation', 'rec-bf-noopp');
    expect(withoutOpp).not.toBeNull();
    expect(withoutOpp!.predictedEmv).toBeNull();
  });

  it('is idempotent — a second run creates nothing and preserves the snapshot', () => {
    seedRecSet([makeRec({ id: 'rec-bf-idem', status: 'completed', opportunity: makeOpp(120) })]);

    expect(backfillCompletedRecommendations(wsId)).toBe(1);
    expect(backfillCompletedRecommendations(wsId)).toBe(0);
    expect(getActionByWorkspaceAndSource(wsId, 'recommendation', 'rec-bf-idem')!.predictedEmv).toBe(120);
  });
});

// ── 3. Repair pass for existing NULL snapshots ───────────────────────────────

describe('backfillPredictedEmvSnapshots repair pass', () => {
  it('fills NULL snapshots from the blob, skips 0-EMV recs, never overwrites non-NULL', () => {
    seedRecSet([
      makeRec({ id: 'rec-fix', status: 'completed', opportunity: makeOpp(360) }),
      makeRec({ id: 'rec-zero', status: 'completed', opportunity: makeOpp(0) }),
      makeRec({ id: 'rec-keep', status: 'completed', opportunity: makeOpp(500) }),
    ]);
    const fixId = seedRecAction({ sourceId: 'rec-fix', predictedEmv: null });
    const zeroId = seedRecAction({ sourceId: 'rec-zero', predictedEmv: null });
    const keepId = seedRecAction({ sourceId: 'rec-keep', predictedEmv: 123 });

    const filled = backfillPredictedEmvSnapshots(wsId);
    expect(filled).toBe(1);

    expect(getAction(fixId)!.predictedEmv).toBe(360);
    // 0 is the legacy zod round-trip default ("unknown"), not a prediction — stays null.
    expect(getAction(zeroId)!.predictedEmv).toBeNull();
    // A captured snapshot is immutable — the blob's 500 must NOT clobber 123.
    expect(getAction(keepId)!.predictedEmv).toBe(123);
  });

  it('is idempotent — a second run is a natural no-op', () => {
    seedRecSet([makeRec({ id: 'rec-fix-2', status: 'completed', opportunity: makeOpp(75) })]);
    seedRecAction({ sourceId: 'rec-fix-2', predictedEmv: null });

    expect(backfillPredictedEmvSnapshots(wsId)).toBe(1);
    expect(backfillPredictedEmvSnapshots(wsId)).toBe(0);
  });

  it('leaves actions whose rec no longer exists untouched', () => {
    seedRecSet([makeRec({ id: 'rec-present', status: 'completed', opportunity: makeOpp(60) })]);
    const orphanId = seedRecAction({ sourceId: 'rec-vanished', predictedEmv: null });

    expect(backfillPredictedEmvSnapshots(wsId)).toBe(0);
    expect(getAction(orphanId)!.predictedEmv).toBeNull();
  });
});

// ── 4. Effort priors (time-to-completion → effortDays) ──────────────────────

describe('effortDays aggregation', () => {
  it('computes the per-actionType median of rec-createdAt → action-createdAt, excluding backfill actions', () => {
    expect(MIN_EFFORT_SAMPLES).toBeLessThanOrEqual(3); // test seeds 3 live samples
    seedRecSet([
      makeRec({ id: 'rec-e1', status: 'completed', createdAt: daysAgoIso(2) }),
      makeRec({ id: 'rec-e2', status: 'completed', createdAt: daysAgoIso(10) }),
      makeRec({ id: 'rec-e3', status: 'completed', createdAt: daysAgoIso(40) }),
      makeRec({ id: 'rec-e4', status: 'completed', createdAt: daysAgoIso(300) }),
      makeRec({ id: 'rec-single', status: 'completed', createdAt: daysAgoIso(5) }),
    ]);
    seedRecAction({ sourceId: 'rec-e1', actionType: 'content_published' });
    seedRecAction({ sourceId: 'rec-e2', actionType: 'content_published' });
    seedRecAction({ sourceId: 'rec-e3', actionType: 'content_published' });
    // Backfilled action: created_at is the backfill run time, not completion time —
    // including its 300-day gap would corrupt the median. Must be excluded.
    seedRecAction({ sourceId: 'rec-e4', actionType: 'content_published', sourceFlag: 'backfill' });
    // Single sample of another type — below MIN_EFFORT_SAMPLES, no prior fabricated.
    seedRecAction({ sourceId: 'rec-single', actionType: 'meta_updated' });

    runEmvCalibration(wsId);

    const priors = getEffortPriorDays(wsId);
    expect(priors.content_published).toBeDefined();
    expect(priors.content_published!).toBeGreaterThan(9.5);
    expect(priors.content_published!).toBeLessThan(10.5);
    expect(priors.meta_updated).toBeUndefined();
  });
});

// ── 5. Realized-vs-predicted calibration ─────────────────────────────────────

describe('realized-vs-predicted calibration', () => {
  it('produces a conclusive median realization ratio at >= MIN_CALIBRATION_PAIRS pairs', () => {
    expect(MIN_CALIBRATION_PAIRS).toBe(5);
    seedRecSet([]);
    const attributedValues = [50, 100, 150, 200, 250]; // predicted 100 → ratios 0.5..2.5, median 1.5
    attributedValues.forEach((value, i) => {
      const actionId = seedRecAction({ sourceId: `rec-cal-${i}`, actionType: 'audit_fix_applied', predictedEmv: 100 });
      seedConclusiveOutcome(actionId, value);
    });

    runEmvCalibration(wsId);

    const entry = getEmvCalibrationForWorkspace(wsId).find(e => e.actionType === 'audit_fix_applied');
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('conclusive');
    expect(entry!.pairCount).toBe(5);
    expect(entry!.medianRealizationRatio).toBeCloseTo(1.5, 5);
  });

  it('is honest below the pair floor — inconclusive with a NULL ratio, never fabricated', () => {
    seedRecSet([]);
    for (let i = 0; i < MIN_CALIBRATION_PAIRS - 1; i++) {
      const actionId = seedRecAction({ sourceId: `rec-few-${i}`, actionType: 'content_refreshed', predictedEmv: 100 });
      seedConclusiveOutcome(actionId, 100);
    }

    runEmvCalibration(wsId);

    const entry = getEmvCalibrationForWorkspace(wsId).find(e => e.actionType === 'content_refreshed');
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('inconclusive');
    expect(entry!.pairCount).toBe(MIN_CALIBRATION_PAIRS - 1);
    expect(entry!.medianRealizationRatio).toBeNull();
  });

  it('counts nothing from missing snapshots or not_acted_on actions', () => {
    seedRecSet([]);
    // 5 outcomes whose actions carry NO predicted_emv snapshot → zero pairs.
    for (let i = 0; i < 5; i++) {
      const actionId = seedRecAction({ sourceId: `rec-nosnap-${i}`, actionType: 'meta_updated', predictedEmv: null });
      seedConclusiveOutcome(actionId, 100);
    }
    // 5 not_acted_on actions WITH snapshots → A1: unexecuted suggestions are not realized value.
    for (let i = 0; i < 5; i++) {
      const actionId = seedRecAction({
        sourceId: `rec-naa-${i}`,
        actionType: 'schema_deployed',
        predictedEmv: 100,
        attribution: 'not_acted_on',
      });
      seedConclusiveOutcome(actionId, 100);
    }

    runEmvCalibration(wsId);

    const entries = getEmvCalibrationForWorkspace(wsId);
    expect(entries.find(e => e.actionType === 'meta_updated' && e.pairCount > 0)).toBeUndefined();
    expect(entries.find(e => e.actionType === 'schema_deployed' && e.pairCount > 0)).toBeUndefined();
  });

  it('recompute is stable — a second run replaces the snapshot rows without duplication', () => {
    seedRecSet([]);
    for (let i = 0; i < MIN_CALIBRATION_PAIRS; i++) {
      const actionId = seedRecAction({ sourceId: `rec-stable-${i}`, actionType: 'audit_fix_applied', predictedEmv: 100 });
      seedConclusiveOutcome(actionId, 150);
    }

    runEmvCalibration(wsId);
    const first = getEmvCalibrationForWorkspace(wsId);
    runEmvCalibration(wsId);
    const second = getEmvCalibrationForWorkspace(wsId);

    expect(second.length).toBe(first.length);
    const entry = second.find(e => e.actionType === 'audit_fix_applied');
    expect(entry!.status).toBe('conclusive');
    expect(entry!.medianRealizationRatio).toBeCloseTo(1.5, 5);
  });
});
