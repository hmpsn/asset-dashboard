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
  markActionComplete,
} from './outcome-tracking.js';
import { readKeywordRankSnapshot } from './outcome-measurement-keywords.js';
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
import { isProgrammingError } from './errors.js';
import { getPageKeyword } from './page-keywords.js';
import { normalizePageUrl } from './utils/page-address.js';

const log = createLogger('outcome-measurement');

// Position-based metrics where lower is better (improvement = decrease)
const LOWER_IS_BETTER_METRICS = new Set(['position']);

/**
 * Generic phantom-metric guard (A1). A scoring config may name a `primary_metric`
 * that was never captured in a GSC/analytics snapshot — e.g. `click_recovery`
 * (content_refreshed), `target_improvement` (internal_link_added), or
 * `content_produced` (brief_created). None of those keys exist on
 * {@link BaselineSnapshot}, so `computeDelta` reads them as 0, the delta is 0, and
 * the action fabricates a `neutral`/`loss` verdict for a metric that was never
 * measured. The fix: when the metric key is absent (undefined OR null) from BOTH
 * the baseline and the current snapshot, the delta is unmeasurable and the action
 * MUST score `inconclusive`.
 *
 * Generic over any actionType and any metric — the guard inspects the snapshots,
 * not a per-type allow-list — so a future scoring config that names a not-yet-
 * captured metric is caught automatically.
 *
 * Exported contract consumed by A4/A5/A6/E5: no `neutral`/`loss` outcome exists
 * for a phantom metric.
 *
 * @returns true when the metric IS present in at least one snapshot (scoring may
 *          proceed); false when it is phantom (caller must record `inconclusive`).
 */
export function isMetricPresent(
  primaryMetric: string,
  baseline: BaselineSnapshot,
  current: BaselineSnapshot,
): boolean {
  const present = (snap: BaselineSnapshot): boolean => {
    const v = (snap as unknown as Record<string, unknown>)[primaryMetric];
    return v !== undefined && v !== null;
  };
  return present(baseline) || present(current);
}

/**
 * Resolve a potentially relative pageUrl (e.g. `/blog-post`) to a full URL
 * (e.g. `https://example.com/blog-post`) using the workspace's liveDomain.
 * GSC Search Analytics API requires full URLs for the `page` dimension filter.
 */
export function resolveFullPageUrl(pageUrl: string, ws: { liveDomain?: string; gscPropertyUrl?: string }): string {
  if (pageUrl.startsWith('http')) return pageUrl;
  const gscUrlBase = ws.gscPropertyUrl?.startsWith('http')
    ? ws.gscPropertyUrl.replace(/\/$/, '')
    : '';
  const base = ws.liveDomain
    ? (ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`)
    : gscUrlBase;
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

type CurrentMetricResult = {
  snapshot: BaselineSnapshot;
  available: boolean;
};

async function fetchCurrentMetrics(action: TrackedAction): Promise<CurrentMetricResult> {
  if (!action.pageUrl) {
    return { snapshot: { captured_at: new Date().toISOString() }, available: false };
  }
  const ws = getWorkspace(action.workspaceId);
  if (!ws?.webflowSiteId || !ws?.gscPropertyUrl) {
    return { snapshot: { captured_at: new Date().toISOString() }, available: false };
  }
  try {
    // Use the last 14 days to smooth weekly variation and get a current-state reading
    const fullUrl = resolveFullPageUrl(action.pageUrl, ws);
    const rows = await getPageTrend(ws.webflowSiteId, ws.gscPropertyUrl, fullUrl, 14);
    if (!rows.length) return { snapshot: { captured_at: new Date().toISOString() }, available: false };
    return { snapshot: { ...averageGscRows(rows), captured_at: new Date().toISOString() }, available: true };
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'outcome-measurement/fetchCurrentMetrics: programming error');
    return { snapshot: { captured_at: new Date().toISOString() }, available: false };
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
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'outcome-measurement/fetchGscSnapshot: programming error');
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
    updateBaselineSnapshot(actionId, workspaceId, {
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
// computeAttributedValue — clicks delta × per-page CPC
// ---------------------------------------------------------------------------

/**
 * Compute the dollar value attributed to a clicks delta using the page's CPC
 * from the page_keywords table (the same source computeROI uses).
 *
 * Returns { attributedValue, valueBasis } when a CPC is available,
 * or { attributedValue: null, valueBasis: null } when the page has no CPC
 * or the primary metric is not clicks-based.
 *
 * Never fabricates a 0 — NULL means inconclusive.
 */
function computeAttributedValue(
  workspaceId: string,
  pageUrl: string | null | undefined,
  primaryMetric: string,
  delta: DeltaSummary,
  baselineSnapshot: BaselineSnapshot,
  currentSnapshot: BaselineSnapshot,
): { attributedValue: number | null; valueBasis: string | null } {
  if (!pageUrl) return { attributedValue: null, valueBasis: null };

  // Compute clicks delta independently of the action's primary metric.
  // content_published uses primary_metric='position' and schema_deployed uses
  // 'ctr', but both can have real click data that supports dollar attribution.
  // When the primary metric IS clicks, delta.delta_absolute already captures it;
  // otherwise we compute it from the baseline/current snapshots directly.
  const clicksDelta: number | null = (() => {
    if (primaryMetric === 'clicks') {
      return typeof delta.delta_absolute === 'number' ? delta.delta_absolute : null;
    }
    const baseClicks = baselineSnapshot.clicks ?? null;
    const currentClicks = currentSnapshot.clicks ?? null;
    if (baseClicks == null || currentClicks == null) return null;
    return currentClicks - baseClicks;
  })();

  if (clicksDelta == null) return { attributedValue: null, valueBasis: null };

  try {
    const normalizedPath = normalizePageUrl(pageUrl);
    const pageKw = getPageKeyword(workspaceId, normalizedPath);
    const cpc = pageKw?.cpc ?? null;
    if (cpc == null || cpc <= 0) return { attributedValue: null, valueBasis: null };

    const attributedValue = Math.round(clicksDelta * cpc * 100) / 100;
    return { attributedValue, valueBasis: 'clicks_delta_x_cpc' };
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err, workspaceId, pageUrl }, 'outcome-measurement/computeAttributedValue: programming error');
    return { attributedValue: null, valueBasis: null };
  }
}

// ---------------------------------------------------------------------------
// scoreActionAtCheckpoint — scores a single action at a single checkpoint
// ---------------------------------------------------------------------------

// Search metrics where an unmeasurable delta must yield `inconclusive` / the
// data-volume gates apply. Non-search metrics (page_health_score, voice_score,
// content_produced, etc.) skip those checks.
const SEARCH_METRICS = new Set(['position', 'clicks', 'impressions', 'ctr']);
const BASELINE_SEARCH_FIELDS: Array<keyof BaselineSnapshot> = ['position', 'clicks', 'impressions', 'ctr'];

/**
 * Shared terminal-outcome writer for the unmeasurable paths (`inconclusive` /
 * `insufficient_data`). When `completeAction` is set, the action also exits the
 * measurement queue immediately (used for permanently-unmeasurable actions —
 * see scoreActionAtCheckpoint).
 */
function recordUnmeasurableOutcome(
  action: TrackedAction,
  checkpointDays: CheckpointDays,
  currentSnapshot: BaselineSnapshot,
  primaryMetric: string,
  score: 'inconclusive' | 'insufficient_data',
  reason: string,
  opts: { completeAction?: boolean } = {},
): void {
  const delta = computeDelta(action.baselineSnapshot, currentSnapshot, primaryMetric);
  const outcome = recordOutcome({
    actionId: action.id,
    checkpointDays,
    metricsSnapshot: currentSnapshot,
    score,
    deltaSummary: delta,
  });
  if (opts.completeAction) {
    markActionComplete(action.id, action.workspaceId);
  }
  log.info(
    { actionId: action.id, checkpointDays, primaryMetric, score, completed: Boolean(opts.completeAction) },
    reason,
  );
  broadcastToWorkspace(action.workspaceId, WS_EVENTS.OUTCOME_SCORED, {
    actionId: action.id,
    checkpointDays,
    score: outcome.score,
    earlySignal: outcome.earlySignal,
    deltaSummary: outcome.deltaSummary,
  });
}

/** Result of scoring one checkpoint. `short_circuited` = the action was marked
 *  complete because it can never be measured — skip its remaining checkpoints. */
type CheckpointResult = 'scored' | 'short_circuited';

async function scoreActionAtCheckpoint(
  action: TrackedAction,
  checkpointDays: CheckpointDays,
  config: ScoringConfig,
): Promise<CheckpointResult> {
  const configEntry = config[action.actionType];
  const primaryMetric = configEntry.primary_metric;

  // A4 (audit #15): permanently-unmeasurable detection. A search-metric action
  // with no pageUrl (nothing to fetch from GSC, no baseline repair possible), no
  // targetKeyword (nothing to read from rank_snapshots), and a baseline that never
  // captured any search field can NEVER produce a measurable delta — its baseline
  // is immutable and its current side has no data source. Instead of emitting
  // inconclusive at every checkpoint until the 90-day exit, record one
  // inconclusive outcome at the first due checkpoint and leave the queue.
  const permanentlyUnmeasurable = SEARCH_METRICS.has(primaryMetric)
    && !action.pageUrl
    && !action.targetKeyword?.trim()
    && BASELINE_SEARCH_FIELDS.every(
      k => action.baselineSnapshot[k] === undefined || action.baselineSnapshot[k] === null,
    );
  if (permanentlyUnmeasurable) {
    recordUnmeasurableOutcome(
      action, checkpointDays, { captured_at: new Date().toISOString() }, primaryMetric,
      'inconclusive',
      'No pageUrl, no targetKeyword, and no search baseline — permanently unmeasurable, exiting measurement queue',
      { completeAction: true },
    );
    return 'short_circuited';
  }

  // A4 (audit #15): keyword-level actions measure against rank_snapshots, not
  // page-aggregate GSC. Their stored baselines are keyword-level (A3's
  // pm.currentPosition, the Hub recorder's snapshot position) — comparing a
  // keyword baseline against a page-aggregate position fabricates deltas.
  // FM-2: a missing/stale keyword snapshot is unmeasurable (`inconclusive`),
  // never a fallback to a different measurement basis.
  const isKeywordAction = action.actionType === 'strategy_keyword_added' && Boolean(action.targetKeyword?.trim());
  let currentSnapshot: BaselineSnapshot;
  let currentAvailable: boolean;
  if (isKeywordAction) {
    const keywordSnapshot = readKeywordRankSnapshot(action.workspaceId, action.targetKeyword!.trim());
    currentSnapshot = keywordSnapshot ?? { captured_at: new Date().toISOString() };
    currentAvailable = keywordSnapshot !== null;
  } else {
    const currentMetrics = await fetchCurrentMetrics(action);
    currentSnapshot = currentMetrics.snapshot;
    currentAvailable = currentMetrics.available;
  }

  // Phantom-metric guard (A1, generic): if the configured primary_metric was never
  // captured in either the baseline OR the current snapshot, the delta is
  // unmeasurable. Scoring it would fabricate a neutral/loss verdict (computeDelta
  // reads the missing key as 0). Score `inconclusive` instead. This catches any
  // action type whose scoring config names a metric the snapshot does not carry
  // (e.g. click_recovery, target_improvement, content_produced).
  if (!isMetricPresent(primaryMetric, action.baselineSnapshot, currentSnapshot)) {
    recordUnmeasurableOutcome(
      action, checkpointDays, currentSnapshot, primaryMetric, 'inconclusive',
      'Primary metric absent from snapshot — phantom metric, scoring inconclusive',
    );
    return 'scored';
  }

  // Edge case: insufficient data — only applies to search-impression-based metrics.
  if (SEARCH_METRICS.has(primaryMetric) && !currentAvailable) {
    recordUnmeasurableOutcome(
      action, checkpointDays, currentSnapshot, primaryMetric, 'inconclusive',
      isKeywordAction
        ? 'No fresh rank snapshot for keyword — cannot measure delta'
        : 'Current GSC data unavailable — cannot measure delta',
    );
    return 'scored';
  }
  // Only apply the insufficient_data gate when impressions was explicitly captured
  // (undefined means the baseline was recorded without GSC data — don't block scoring)
  const baselineImpressions = action.baselineSnapshot.impressions;
  const maxImpressions = Math.max(baselineImpressions ?? 0, currentSnapshot.impressions ?? 0);
  if (SEARCH_METRICS.has(primaryMetric) && baselineImpressions !== undefined && maxImpressions < MIN_IMPRESSIONS_FOR_DATA) {
    recordUnmeasurableOutcome(
      action, checkpointDays, currentSnapshot, primaryMetric, 'insufficient_data',
      'Insufficient baseline data',
    );
    return 'scored';
  }

  // A4 fix (inherited from A3 review): a search-metric action whose baseline lacks
  // the PRIMARY metric must score `inconclusive`, regardless of other baseline
  // fields. The old guard only fired when ALL search fields were absent — a
  // baseline with clicks/impressions but no position slipped through, computeDelta
  // read the missing baseline position as 0, and the action fabricated a loss
  // against a phantom position 0. (This subsumes the old all-fields-absent check.)
  if (SEARCH_METRICS.has(primaryMetric)) {
    const baselinePrimary = action.baselineSnapshot[primaryMetric as keyof BaselineSnapshot];
    if (baselinePrimary === undefined || baselinePrimary === null) {
      recordUnmeasurableOutcome(
        action, checkpointDays, currentSnapshot, primaryMetric, 'inconclusive',
        'Baseline lacks the primary metric — cannot measure delta',
      );
      return 'scored';
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
    recordUnmeasurableOutcome(
      action, checkpointDays, currentSnapshot, primaryMetric, 'inconclusive',
      'All current metrics undefined — page may be deleted or redirected',
    );
    return 'scored';
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
      updateActionContext(action.id, action.workspaceId, updatedContext);
    }
  }

  // Compute attributed dollar value from clicks delta × per-page CPC.
  // Clicks delta is computed independently of the primary metric so action types
  // like content_published (position) and schema_deployed (ctr) also get dollar
  // attribution when click data is present. No-CPC / no-click cases → null.
  const { attributedValue, valueBasis } = computeAttributedValue(
    action.workspaceId,
    action.pageUrl,
    primaryMetric,
    delta,
    action.baselineSnapshot,
    currentSnapshot,
  );

  const outcome = recordOutcome({
    actionId: action.id,
    checkpointDays,
    metricsSnapshot: currentSnapshot,
    score,
    earlySignal,
    deltaSummary: delta,
    attributedValue,
    valueBasis,
  });

  log.info(
    { actionId: action.id, checkpointDays, score, earlySignal, direction: delta.direction, attributedValue },
    'Action scored',
  );

  broadcastToWorkspace(action.workspaceId, WS_EVENTS.OUTCOME_SCORED, {
    actionId: action.id,
    checkpointDays,
    score: outcome.score,
    earlySignal: outcome.earlySignal,
    deltaSummary: outcome.deltaSummary,
  });
  return 'scored';
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
          const result = await scoreActionAtCheckpoint(action, checkpoint, config);
          measured++;
          // A4: a permanently-unmeasurable action exited the queue at this
          // checkpoint — recording further inconclusive checkpoints is noise.
          if (result === 'short_circuited') break;
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
