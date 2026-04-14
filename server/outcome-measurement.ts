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
  updateBaselineSnapshot,
} from './outcome-tracking.js';
import { resolveScoringConfig } from './outcome-scoring-defaults.js';
import { getWorkspace } from './workspaces.js';
import { getPageTrend } from './search-console.js';
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

/**
 * Resolve a potentially relative pageUrl (e.g. `/blog-post`) to a full URL
 * (e.g. `https://example.com/blog-post`) using the workspace's liveDomain.
 * GSC Search Analytics API requires full URLs for the `page` dimension filter.
 */
export function resolveFullPageUrl(pageUrl: string, ws: { liveDomain?: string; gscPropertyUrl?: string }): string {
  if (pageUrl.startsWith('http')) return pageUrl;
  const base = ws.liveDomain
    ? (ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`)
    : ws.gscPropertyUrl?.replace(/\/$/, '') ?? '';
  if (!base) return pageUrl;
  return `${base}${pageUrl.startsWith('/') ? '' : '/'}${pageUrl}`;
}

// Minimum impressions required to avoid an insufficient_data outcome
const MIN_IMPRESSIONS_FOR_DATA = 50;

// Checkpoints measured (in days)
const CHECKPOINTS = [7, 30, 60, 90] as const;
type CheckpointDays = 7 | 30 | 60 | 90;

// ---------------------------------------------------------------------------
// GSC helpers
// ---------------------------------------------------------------------------

function averageGscRows(
  rows: Array<{ clicks: number; impressions: number; ctr: number; position: number }>,
): Partial<BaselineSnapshot> {
  if (!rows.length) return {};
  const n = rows.length;
  const sum = rows.reduce(
    (acc, r) => ({
      clicks: acc.clicks + r.clicks,
      impressions: acc.impressions + r.impressions,
      position: acc.position + r.position,
    }),
    { clicks: 0, impressions: 0, position: 0 },
  );
  return {
    clicks: Math.round(sum.clicks / n),
    impressions: Math.round(sum.impressions / n),
    // Compute aggregate CTR from totals (clicks/impressions), not by averaging daily percentages
    ctr: sum.impressions > 0 ? +((sum.clicks / sum.impressions) * 100).toFixed(1) : 0,
    position: +(sum.position / n).toFixed(1),
  };
}

async function fetchCurrentMetrics(action: TrackedAction): Promise<BaselineSnapshot> {
  if (!action.pageUrl) {
    return { ...action.baselineSnapshot, captured_at: new Date().toISOString() };
  }
  const ws = getWorkspace(action.workspaceId);
  if (!ws?.webflowSiteId || !ws?.gscPropertyUrl) {
    return { ...action.baselineSnapshot, captured_at: new Date().toISOString() };
  }
  try {
    // Use the last 14 days to smooth weekly variation and get a current-state reading
    const fullUrl = resolveFullPageUrl(action.pageUrl, ws);
    const rows = await getPageTrend(ws.webflowSiteId, ws.gscPropertyUrl, fullUrl, 14);
    if (!rows.length) return { ...action.baselineSnapshot, captured_at: new Date().toISOString() };
    return { ...averageGscRows(rows), captured_at: new Date().toISOString() };
  } catch {
    return { ...action.baselineSnapshot, captured_at: new Date().toISOString() };
  }
}

/**
 * Fetch a GSC snapshot (averaged over `days`) for a page.
 * Returns null if the workspace has no GSC connection or GSC returns no data.
 * Used by both fetchCurrentMetrics and external detection.
 */
export async function fetchGscSnapshot(
  workspaceId: string,
  pageUrl: string,
  days: number,
): Promise<BaselineSnapshot | null> {
  const ws = getWorkspace(workspaceId);
  if (!ws?.webflowSiteId || !ws?.gscPropertyUrl) return null;
  try {
    const fullUrl = resolveFullPageUrl(pageUrl, ws);
    const rows = await getPageTrend(ws.webflowSiteId, ws.gscPropertyUrl, fullUrl, days);
    if (!rows.length) return null;
    return { ...averageGscRows(rows), captured_at: new Date().toISOString() };
  } catch {
    return null;
  }
}

/**
 * Capture and store a GSC baseline for a newly recorded action.
 * Call fire-and-forget (void) from route handlers — does not block the response.
 */
export async function captureBaselineFromGsc(
  actionId: string,
  workspaceId: string,
  pageUrl: string,
): Promise<void> {
  const ws = getWorkspace(workspaceId);
  if (!ws?.webflowSiteId || !ws?.gscPropertyUrl) return;
  try {
    // Use 28 days to get a stable baseline reading at action creation time
    const fullUrl = resolveFullPageUrl(pageUrl, ws);
    const rows = await getPageTrend(ws.webflowSiteId, ws.gscPropertyUrl, fullUrl, 28);
    if (!rows.length) return;
    updateBaselineSnapshot(actionId, {
      ...averageGscRows(rows),
      captured_at: new Date().toISOString(),
    });
    log.info({ actionId, pageUrl }, 'GSC baseline captured');
  } catch (err) {
    log.warn({ err, actionId, pageUrl }, 'Failed to capture GSC baseline');
  }
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
  const baselineValue = (baseline as unknown as Record<string, unknown>)[primaryMetric];
  const currentValue = (current as unknown as Record<string, unknown>)[primaryMetric];

  const bv = typeof baselineValue === 'number' ? baselineValue : 0;
  const cv = typeof currentValue === 'number' ? currentValue : 0;

  const deltaAbsolute = cv - bv;
  // When baseline is 0: any positive change → 100%, any negative → -100%, no change → 0%
  const deltaPercent = bv !== 0
    ? (deltaAbsolute / Math.abs(bv)) * 100
    : cv > 0 ? 100 : cv < 0 ? -100 : 0;

  let direction: DeltaSummary['direction'];
  const lowerIsBetter = LOWER_IS_BETTER_METRICS.has(primaryMetric);

  if (Math.abs(deltaAbsolute) < 0.001) {
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
  } else if (effectivePercent >= -thresholds.neutral_band) {
    // Any improvement below win threshold, or small decline within neutral band → neutral
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

  // Edge case: insufficient data — only applies to search-impression-based metrics.
  // Non-search metrics (page_health_score, voice_score, content_produced, etc.) skip this check.
  const SEARCH_METRICS = new Set(['position', 'clicks', 'impressions', 'ctr']);
  // Only apply the insufficient_data gate when impressions was explicitly captured
  // (undefined means the baseline was recorded without GSC data — don't block scoring)
  const baselineImpressions = action.baselineSnapshot.impressions;
  const maxImpressions = Math.max(baselineImpressions ?? 0, currentSnapshot.impressions ?? 0);
  if (SEARCH_METRICS.has(primaryMetric) && baselineImpressions !== undefined && maxImpressions < MIN_IMPRESSIONS_FOR_DATA) {
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

  // Edge case: baseline has no GSC data for a search-metric action.
  // Without a real baseline we cannot compute a meaningful delta — score inconclusive.
  // (insights.ts already captures position/clicks/etc from insight data, so this only
  // fires for action types whose call sites didn't capture a GSC baseline.)
  if (SEARCH_METRICS.has(primaryMetric)) {
    const searchFields: Array<keyof BaselineSnapshot> = ['position', 'clicks', 'impressions', 'ctr'];
    const baselineLacksData = searchFields.every(
      k => action.baselineSnapshot[k] === undefined || action.baselineSnapshot[k] === null,
    );
    if (baselineLacksData) {
      const delta = computeDelta(action.baselineSnapshot, currentSnapshot, primaryMetric);
      const outcome = recordOutcome({
        actionId: action.id,
        checkpointDays,
        metricsSnapshot: currentSnapshot,
        score: 'inconclusive',
        deltaSummary: delta,
      });
      log.info({ actionId: action.id, checkpointDays }, 'No GSC baseline — cannot measure delta');
      broadcastToWorkspace(action.workspaceId, WS_EVENTS.OUTCOME_SCORED, {
        actionId: action.id,
        checkpointDays,
        score: outcome.score,
        earlySignal: outcome.earlySignal,
        deltaSummary: outcome.deltaSummary,
      });
      return;
    }
  }

  // Edge case: inconclusive — current metrics are all undefined (page deleted/redirected).
  // Only applicable to search-metric-based action types; non-search actions (voice_calibrated,
  // brief_created, etc.) legitimately have no metric fields in their snapshot.
  const metricKeys: Array<keyof BaselineSnapshot> = [
    'position', 'clicks', 'impressions', 'ctr', 'sessions',
    'bounce_rate', 'engagement_rate', 'conversions', 'page_health_score', 'voice_score',
  ];
  const allUndefined = SEARCH_METRICS.has(primaryMetric) &&
    metricKeys.every(k => currentSnapshot[k] === undefined || currentSnapshot[k] === null);
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
  /** Optional workspace priority map: workspaceId → sort score (lower = higher priority). */
  workspacePriority?: ReadonlyMap<string, number>,
): Promise<{ measured: number; errors: number; workspaceIds: string[] }> {
  const pendingActions = getPendingActions();

  // Collect workspace IDs from the pending set so the caller can invalidate
  // intelligence caches for workspaces that were actually measured, regardless
  // of whether getPendingActions is called independently elsewhere.
  const workspaceIds = [...new Set(pendingActions.map(a => a.workspaceId))];

  // Sort actions by workspace health priority (lowest compositeHealthScore first)
  // so the sickest workspaces get measured before healthier ones.
  if (workspacePriority && workspacePriority.size > 0) {
    pendingActions.sort((a, b) => {
      const pa = workspacePriority.get(a.workspaceId) ?? 100;
      const pb = workspacePriority.get(b.workspaceId) ?? 100;
      return pa - pb;
    });
    log.info({ prioritized: workspacePriority.size }, 'Sorted pending actions by compositeHealthScore');
  }

  log.info({ count: pendingActions.length }, 'Starting outcome measurement run');

  // Cache per-workspace configs to avoid repeated DB lookups
  const wsConfigCache = new Map<string, ScoringConfig>();
  const getConfig = (workspaceId: string): ScoringConfig => {
    if (wsConfigCache.has(workspaceId)) return wsConfigCache.get(workspaceId)!;
    const ws = getWorkspace(workspaceId);
    const override = scoringConfigOverride ?? (ws?.scoringConfig as Partial<ScoringConfig> | undefined) ?? null;
    const config = resolveScoringConfig(override);
    wsConfigCache.set(workspaceId, config);
    return config;
  };

  let measured = 0;
  let errors = 0;

  for (const action of pendingActions) {
    const config = getConfig(action.workspaceId);
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

  return { measured, errors, workspaceIds };
}
