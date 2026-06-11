/**
 * A6 (audit #22) — anonymized cross-workspace platform_learnings priors.
 *
 * Asserts:
 *  1. COHORT FLOOR — a prior is published only when >= MIN_COHORT_WORKSPACES distinct
 *     workspaces contributed scored outcomes; below the floor it is ABSENT (FM-2).
 *  2. SAMPLE FLOOR — below MIN_PRIOR_SAMPLES total scored actions the prior is ABSENT
 *     even with enough workspaces.
 *  3. WIN RATE — the published rate is wins / total across all contributing workspaces.
 *  4. ANONYMIZATION — stored rows carry NO workspace id / title / url / keyword; only
 *     (action_type, win_rate, contributing_workspaces, scored_actions, computed_at).
 *  5. not_acted_on EXCLUSION — unexecuted suggestions contribute nothing (A1 semantics).
 *  6. FALLBACK SEAM — buildPlatformPriorAdjustment + the status note act ONLY on a
 *     no_data/degraded workspace and label the rate as cross-workspace; a `ready`
 *     workspace is UNAFFECTED (availability switch respected).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { recordAction, recordOutcome } from '../../server/outcome-tracking.js';
import {
  recomputePlatformPriors,
  getPlatformPriors,
  getPlatformPriorWinRate,
  MIN_COHORT_WORKSPACES,
  MIN_PRIOR_SAMPLES,
} from '../../server/platform-learnings-priors.js';
import {
  buildPlatformPriorAdjustment,
  buildOutcomeLearningStatusNote,
} from '../../server/outcome-learning-default-path.js';
import type { ActionType, OutcomeScore, BaselineSnapshot, DeltaSummary } from '../../shared/types/outcome-tracking.js';

createEphemeralTestContext(import.meta.url);

const createdWorkspaceIds: string[] = [];

const SNAP: BaselineSnapshot = { captured_at: '2026-01-01T00:00:00.000Z', clicks: 10, impressions: 100, position: 5, ctr: 0.1 };

const DELTA: DeltaSummary = {
  primary_metric: 'clicks',
  baseline_value: 10,
  current_value: 20,
  delta_absolute: 10,
  delta_percent: 100,
  direction: 'improved',
};

/** Seed one executed action with a single 90-day outcome of the given score. */
function seedScoredAction(workspaceId: string, actionType: ActionType, score: OutcomeScore): void {
  const action = recordAction({
    workspaceId,
    actionType,
    sourceType: 'manual',
    baselineSnapshot: SNAP,
    attribution: 'platform_executed',
  });
  recordOutcome({
    actionId: action.id,
    checkpointDays: 90,
    metricsSnapshot: SNAP,
    score,
    deltaSummary: DELTA,
  });
}

/** Seed a not_acted_on action with a win outcome — must NOT contribute to priors. */
function seedNotActedOn(workspaceId: string, actionType: ActionType): void {
  const action = recordAction({
    workspaceId,
    actionType,
    sourceType: 'recommendation',
    baselineSnapshot: SNAP,
    attribution: 'not_acted_on',
  });
  recordOutcome({
    actionId: action.id,
    checkpointDays: 90,
    metricsSnapshot: SNAP,
    score: 'strong_win',
    deltaSummary: DELTA,
  });
}

function freshWorkspace(name: string): string {
  const ws = createWorkspace(name);
  createdWorkspaceIds.push(ws.id);
  return ws.id;
}

beforeEach(() => {
  // Each test rebuilds the aggregate from scratch; clear any leftover rows from a prior test.
  db.prepare('DELETE FROM platform_learnings_priors').run();
});

afterAll(() => {
  for (const id of createdWorkspaceIds) {
    try { deleteWorkspace(id); } catch { /* best effort */ }
  }
});

describe('A6 platform learnings priors — aggregation + floors', () => {
  it('publishes a prior when cohort + sample floors are cleared, with the correct win rate', () => {
    // 3 workspaces, 6 scored actions for schema_deployed: 4 wins / 6 = 0.667.
    const a = freshWorkspace('a6cohort-a');
    const b = freshWorkspace('a6cohort-b');
    const c = freshWorkspace('a6cohort-c');
    seedScoredAction(a, 'schema_deployed', 'strong_win');
    seedScoredAction(a, 'schema_deployed', 'win');
    seedScoredAction(b, 'schema_deployed', 'win');
    seedScoredAction(b, 'schema_deployed', 'loss');
    seedScoredAction(c, 'schema_deployed', 'win');
    seedScoredAction(c, 'schema_deployed', 'loss');

    const result = recomputePlatformPriors();
    expect(result.publishedEntries).toBeGreaterThanOrEqual(1);

    const prior = getPlatformPriors().find(p => p.actionType === 'schema_deployed');
    expect(prior).toBeDefined();
    expect(prior!.contributingWorkspaces).toBe(3);
    expect(prior!.scoredActions).toBe(6);
    expect(prior!.winRate).toBeCloseTo(4 / 6, 5);
    expect(getPlatformPriorWinRate('schema_deployed')).toBeCloseTo(4 / 6, 5);
  });

  it('suppresses a prior below the cohort floor (FM-2 — absent, never fabricated)', () => {
    // Only 2 workspaces (< MIN_COHORT_WORKSPACES=3), even with plenty of samples.
    expect(MIN_COHORT_WORKSPACES).toBe(3);
    const a = freshWorkspace('a6below-a');
    const b = freshWorkspace('a6below-b');
    for (let i = 0; i < 4; i++) seedScoredAction(a, 'meta_updated', 'win');
    for (let i = 0; i < 4; i++) seedScoredAction(b, 'meta_updated', 'win');

    recomputePlatformPriors();
    expect(getPlatformPriors().find(p => p.actionType === 'meta_updated')).toBeUndefined();
    expect(getPlatformPriorWinRate('meta_updated')).toBeNull();
  });

  it('suppresses a prior below the sample floor even with enough workspaces', () => {
    // 4 workspaces but only 4 scored actions total (< MIN_PRIOR_SAMPLES=5).
    expect(MIN_PRIOR_SAMPLES).toBe(5);
    const ws = [0, 1, 2, 3].map(i => freshWorkspace(`a6sample-${i}`));
    ws.forEach(w => seedScoredAction(w, 'audit_fix_applied', 'win'));

    recomputePlatformPriors();
    expect(getPlatformPriors().find(p => p.actionType === 'audit_fix_applied')).toBeUndefined();
  });

  it('excludes not_acted_on actions from the aggregate (A1 semantics)', () => {
    // 3 workspaces × 2 executed losses = 6 scored, 0 wins. Plus a not_acted_on win each
    // that MUST NOT inflate the rate or the counts.
    const ws = [0, 1, 2].map(i => freshWorkspace(`a6naoff-${i}`));
    ws.forEach(w => {
      seedScoredAction(w, 'internal_link_added', 'loss');
      seedScoredAction(w, 'internal_link_added', 'loss');
      seedNotActedOn(w, 'internal_link_added');
    });

    recomputePlatformPriors();
    const prior = getPlatformPriors().find(p => p.actionType === 'internal_link_added');
    expect(prior).toBeDefined();
    expect(prior!.scoredActions).toBe(6); // not 9 — the 3 not_acted_on wins are excluded
    expect(prior!.winRate).toBe(0);
  });

  it('stores zero workspace-identifying data (anonymization contract)', () => {
    const ws = [0, 1, 2].map(i => freshWorkspace(`a6anon-${i}`));
    ws.forEach(w => {
      seedScoredAction(w, 'content_published', 'win');
      seedScoredAction(w, 'content_published', 'win');
    });
    recomputePlatformPriors();

    // Schema-level assertion: the table has no workspace_id / url / title / keyword column.
    const cols = (db.prepare('PRAGMA table_info(platform_learnings_priors)').all() as Array<{ name: string }>)
      .map(c => c.name);
    expect(cols).toEqual(['action_type', 'win_rate', 'contributing_workspaces', 'scored_actions', 'computed_at']);
    // No column IDENTIFIES a workspace/page/keyword. `contributing_workspaces` is a
    // COUNT (the exact-shape assertion above already pins it), so it is exempt here.
    const identifying = cols.filter(c => c !== 'contributing_workspaces');
    expect(identifying.some(c => /workspace_id|\burl\b|title|keyword|page/i.test(c))).toBe(false);

    // Row-level assertion: no stored value is one of the seeded workspace ids.
    const rows = db.prepare('SELECT * FROM platform_learnings_priors').all() as Array<Record<string, unknown>>;
    const serialized = JSON.stringify(rows);
    for (const id of ws) expect(serialized).not.toContain(id);
  });
});

describe('A6 fallback seam — availability stays authoritative', () => {
  it('applies a labeled cross-workspace prior only on no_data / degraded', () => {
    const priors = [
      { actionType: 'schema_deployed', winRate: 0.7, contributingWorkspaces: 4, scoredActions: 20 },
    ];

    const noData = buildPlatformPriorAdjustment({ actionType: 'schema_deployed', availability: 'no_data', platformPriors: priors });
    expect(noData.applied).toBe(true);
    expect(noData.multiplier).toBeGreaterThan(1);
    expect(noData.reasons[0]).toMatch(/across all clients on the platform/i);
    expect(noData.reasons[0]).not.toMatch(/this workspace has performed/i);

    const degraded = buildPlatformPriorAdjustment({ actionType: 'schema_deployed', availability: 'degraded', platformPriors: priors });
    expect(degraded.applied).toBe(true);
  });

  it('is a no-op for ready / disabled / not_requested (availability switch respected)', () => {
    const priors = [
      { actionType: 'schema_deployed', winRate: 0.7, contributingWorkspaces: 4, scoredActions: 20 },
    ];
    for (const availability of ['ready', 'disabled', 'not_requested'] as const) {
      const r = buildPlatformPriorAdjustment({ actionType: 'schema_deployed', availability, platformPriors: priors });
      expect(r.applied).toBe(false);
      expect(r.multiplier).toBe(1);
      expect(r.prior).toBeNull();
      expect(r.reasons).toHaveLength(0);
    }
  });

  it('is a no-op when no prior exists for the action type (FM-2)', () => {
    const r = buildPlatformPriorAdjustment({ actionType: 'meta_updated', availability: 'no_data', platformPriors: [] });
    expect(r.applied).toBe(false);
    expect(r.multiplier).toBe(1);
  });

  it('appends a labeled benchmark to the no_data status note, never on ready', () => {
    const priors = [
      { actionType: 'schema_deployed', winRate: 0.7, contributingWorkspaces: 4, scoredActions: 20 },
    ];
    const noteNoData = buildOutcomeLearningStatusNote('no_data', 'strategy', priors);
    expect(noteNoData).toMatch(/cross-workspace benchmark/i);
    expect(noteNoData).toMatch(/NOT this workspace's own results/i);

    // `ready` returns '' (no fallback note) regardless of priors being present.
    expect(buildOutcomeLearningStatusNote('ready', 'strategy', priors)).toBe('');
    // `disabled` deliberately suppresses platform priors (admin intent extends to them).
    expect(buildOutcomeLearningStatusNote('disabled', 'strategy', priors)).not.toMatch(/cross-workspace benchmark/i);
  });
});
