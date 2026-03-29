// server/outcome-measurement.ts
// Outcome measurement engine — computes scores for tracked actions.
// Called by the daily cron job.

import { createLogger } from './logger.js';
import {
  getPendingActions,
  recordOutcome,
  getOutcomesForAction,
  getActionsByPage,
  updateActionContext,
} from './outcome-tracking.js';
import { resolveScoringConfig } from './outcome-scoring-defaults.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import type {
  TrackedAction,
  ActionType,
  BaselineSnapshot,
  DeltaSummary,
  OutcomeScore,
  EarlySignal,
  ActionContext,
  ScoringConfig,
} from '../shared/types/outcome-tracking.js';

const log = createLogger('outcome-measurement');

// Position-based metrics where lower is better (improvement = decrease)
const LOWER_IS_BETTER_METRICS = new Set(['position']);

// Minimum impressions required to avoid an insufficient_data outcome
const MIN_IMPRESSIONS_FOR_DATA = 50;

// Checkpoints measured (in days)
const CHECKPOINTS = [7, 30, 60, 90] as const;
type CheckpointDays = 7 | 30 | 60 | 90;

// ---------------------------------------------------------------------------
// Stub: fetch current metrics
// TODO: wire to GSC/GA4 fetch
// ---------------------------------------------------------------------------

async function fetchCurrentMetrics(action: TrackedAction): Promise<BaselineSnapshot> {
  // Identity stub — returns the baseline until real fetching is wired
  return {
    ...action.baselineSnapshot,
    captured_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// isDueForCheckpoint
// ---------------------------------------------------------------------------

export function isDueForCheckpoint(action: TrackedAction, checkpointDays: CheckpointDays): boolean {
  const createdAt = new Date(action.createdAt).getTime();
  const now = Date.now();
  const elapsedDays = (now - createdAt) / (1000 * 60 * 60 * 24);

  if (elapsedDays < checkpointDays) return false;

  // Check whether this checkpoint has already been recorded
  const outcomes = getOutcomesForAction(action.id);
  const alreadyScored = outcomes.some(o => o.checkpointDays === checkpointDays);
  return !alreadyScored;
}

// ---------------------------------------------------------------------------
// computeDelta
// ---------------------------------------------------------------------------

export function computeDelta(
  baseline: BaselineSnapshot,
  current: BaselineSnapshot,
  primaryMetric: string,
): DeltaSummary {
  const baselineValue = (baseline as Record<string, unknown>)[primaryMetric];
  const currentValue = (current as Record<string, unknown>)[primaryMetric];

  const bv = typeof baselineValue === 'number' ? baselineValue : 0;
  const cv = typeof currentValue === 'number' ? currentValue : 0;

  const deltaAbsolute = cv - bv;
  const deltaPercent = bv !== 0 ? (deltaAbsolute / Math.abs(bv)) * 100 : 0;

  let direction: DeltaSummary['direction'];
  const lowerIsBetter = LOWER_IS_BETTER_METRICS.has(primaryMetric);

  if (Math.abs(deltaPercent) < 0.01) {
    direction = 'stable';
  } else if (lowerIsBetter) {
    // For position: a decrease (negative delta) is an improvement
    direction = deltaAbsolute < 0 ? 'improved' : 'declined';
  } else {
    direction = deltaAbsolute > 0 ? 'improved' : 'declined';
  }

  return {
    primary_metric: primaryMetric,
    baseline_value: bv,
    current_value: cv,
    delta_absolute: deltaAbsolute,
    delta_percent: deltaPercent,
    direction,
  };
}

// ---------------------------------------------------------------------------
// scoreOutcome
// ---------------------------------------------------------------------------

export function scoreOutcome(
  actionType: ActionType,
  delta: DeltaSummary,
  checkpointDays: number,
  config: ScoringConfig,
): { score: OutcomeScore | null; earlySignal?: EarlySignal } {
  const configEntry = config[actionType];
  const thresholds = configEntry.thresholds;
  const lowerIsBetter = LOWER_IS_BETTER_METRICS.has(delta.primary_metric);

  // 7-day checkpoint: return early signal only, no final score
  if (checkpointDays === 7) {
    if (delta.direction === 'stable' && Math.abs(delta.delta_percent) < 0.5) {
      return { score: null, earlySignal: 'no_movement' };
    }
    if (delta.direction === 'improved') {
      return { score: null, earlySignal: 'on_track' };
    }
    // If elapsed time is too short to read signal, default to too_early
    return { score: null, earlySignal: 'too_early' };
  }

  // For 30/60/90-day checkpoints: compute full score
  // For position-based (lower is better), we invert delta_percent sign for comparison
  // A negative delta_percent on position means improvement
  const effectivePercent = lowerIsBetter ? -delta.delta_percent : delta.delta_percent;

  let score: OutcomeScore;

  if (effectivePercent >= thresholds.strong_win) {
    score = 'strong_win';
  } else if (effectivePercent >= thresholds.win) {
    score = 'win';
  } else if (Math.abs(effectivePercent) <= thresholds.neutral_band) {
    score = 'neutral';
  } else {
    score = 'loss';
  }

  return { score };
}

// ---------------------------------------------------------------------------
// scoreActionAtCheckpoint — scores a single action at a single checkpoint
// ---------------------------------------------------------------------------

async function scoreActionAtCheckpoint(
  action: TrackedAction,
  checkpointDays: CheckpointDays,
  config: ScoringConfig,
): Promise<void> {
  const configEntry = config[action.actionType];
  const primaryMetric = configEntry.primary_metric;

  const currentSnapshot = await fetchCurrentMetrics(action);

  // Edge case: insufficient data — check impressions on baseline
  const baselineImpressions = action.baselineSnapshot.impressions ?? 0;
  if (baselineImpressions < MIN_IMPRESSIONS_FOR_DATA) {
    const delta = computeDelta(action.baselineSnapshot, currentSnapshot, primaryMetric);
    const outcome = recordOutcome({
      actionId: action.id,
      checkpointDays,
      metricsSnapshot: currentSnapshot,
      score: 'insufficient_data',
      deltaSummary: delta,
    });
    log.info(
      { actionId: action.id, checkpointDays, score: 'insufficient_data' },
      'Insufficient baseline data',
    );
    broadcastToWorkspace(action.workspaceId, WS_EVENTS.OUTCOME_SCORED, {
      actionId: action.id,
      checkpointDays,
      score: outcome.score,
      earlySignal: outcome.earlySignal,
      deltaSummary: outcome.deltaSummary,
    });
    return;
  }

  // Edge case: inconclusive — current metrics are all undefined (page deleted/redirected)
  const metricKeys: Array<keyof BaselineSnapshot> = [
    'position', 'clicks', 'impressions', 'ctr', 'sessions',
    'bounce_rate', 'engagement_rate', 'conversions', 'page_health_score', 'voice_score',
  ];
  const allUndefined = metricKeys.every(k => currentSnapshot[k] === undefined || currentSnapshot[k] === null);
  if (allUndefined) {
    const delta = computeDelta(action.baselineSnapshot, currentSnapshot, primaryMetric);
    const outcome = recordOutcome({
      actionId: action.id,
      checkpointDays,
      metricsSnapshot: currentSnapshot,
      score: 'inconclusive',
      deltaSummary: delta,
    });
    log.info(
      { actionId: action.id, checkpointDays, score: 'inconclusive' },
      'All current metrics undefined — page may be deleted or redirected',
    );
    broadcastToWorkspace(action.workspaceId, WS_EVENTS.OUTCOME_SCORED, {
      actionId: action.id,
      checkpointDays,
      score: outcome.score,
      earlySignal: outcome.earlySignal,
      deltaSummary: outcome.deltaSummary,
    });
    return;
  }

  const delta = computeDelta(action.baselineSnapshot, currentSnapshot, primaryMetric);
  const { score, earlySignal } = scoreOutcome(action.actionType, delta, checkpointDays, config);

  // Multi-action page detection: tag related actions in context
  if (action.pageUrl) {
    const relatedActions = getActionsByPage(action.workspaceId, action.pageUrl)
      .filter(a => a.id !== action.id)
      .map(a => a.id);

    if (relatedActions.length > 0) {
      const updatedContext: ActionContext = {
        ...action.context,
        relatedActions,
      };
      updateActionContext(action.id, updatedContext);
    }
  }

  const outcome = recordOutcome({
    actionId: action.id,
    checkpointDays,
    metricsSnapshot: currentSnapshot,
    score,
    earlySignal,
    deltaSummary: delta,
  });

  log.info(
    { actionId: action.id, checkpointDays, score, earlySignal, direction: delta.direction },
    'Action scored',
  );

  broadcastToWorkspace(action.workspaceId, WS_EVENTS.OUTCOME_SCORED, {
    actionId: action.id,
    checkpointDays,
    score: outcome.score,
    earlySignal: outcome.earlySignal,
    deltaSummary: outcome.deltaSummary,
  });
}

// ---------------------------------------------------------------------------
// measurePendingOutcomes — main cron entry point
// ---------------------------------------------------------------------------

export async function measurePendingOutcomes(
  scoringConfigOverride?: Partial<ScoringConfig>,
): Promise<{ measured: number; errors: number }> {
  const config = resolveScoringConfig(scoringConfigOverride ?? null);
  const pendingActions = getPendingActions();

  log.info({ count: pendingActions.length }, 'Starting outcome measurement run');

  let measured = 0;
  let errors = 0;

  for (const action of pendingActions) {
    for (const checkpoint of CHECKPOINTS) {
      try {
        if (isDueForCheckpoint(action, checkpoint)) {
          await scoreActionAtCheckpoint(action, checkpoint, config);
          measured++;
        }
      } catch (err) {
        errors++;
        log.error(
          { err, actionId: action.id, checkpoint },
          'Error scoring action at checkpoint',
        );
      }
    }
  }

  log.info({ measured, errors }, 'Outcome measurement run complete');

  return { measured, errors };
}
