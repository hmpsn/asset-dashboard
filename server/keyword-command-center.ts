import db from './db/index.js';
import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { isFeatureEnabled } from './feature-flags.js';
import { getLatestSerpSnapshots } from './serp-snapshots-store.js';
import { assembleStoredKeywordStrategy } from './keyword-strategy-assembler.js';
import {
  buildLocalSeoKeywordCandidates,
  countLocalSeoKeywordCandidates,
  buildLocalSeoKeywordVisibilityForKeyword,
  buildLocalSeoKeywordVisibilitySummaryByKey,
  buildLocalSeoKeywordVisibilityByKey,
  getLocalSeoPosture,
  getPrimaryMarketLocationCode,
  listLocalSeoMarkets,
} from './local-seo.js';
import { computeKeywordValueScore, computeKeywordValueComponents, keywordValueReasons } from './scoring/keyword-value-score.js';
import { keywordDollarValue } from './scoring/keyword-value-money.js';
import { createLogger } from './logger.js';
import { addKeywordToPageInTxn, deletePageKeyword, listPageKeywords, listPageKeywordsLite } from './page-keywords.js';
import { slugify } from './helpers.js';
import { isSuspiciousPlannerGroupedVolume } from './keyword-strategy-helpers.js';
import {
  getLatestSnapshotRanks,
  getTrackedKeywords,
  deleteKeywordRankHistory,
  removeTrackedKeyword,
  updateTrackedKeywords,
  type AddTrackedKeywordOptions,
} from './rank-tracking.js';
import { listTrackedKeywordRows } from './tracked-keywords-store.js';
import { recordKeywordTrackingAction } from './outcome-measurement-keywords.js';
import { getScoredOutcomeReadbacks, STRATEGY_PAGE_KEYWORD_SOURCE_TYPE, strategyPageKeywordSourceId } from './outcome-tracking.js';
import { InvalidTransitionError, TRACKED_KEYWORD_TRANSITIONS, validateTransition } from './state-machines.js';
import { getWorkspace } from './workspaces.js';
import { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';
import { buildKeywordStrategyUxPayload } from './keyword-strategy-ux.js';
import { WS_EVENTS } from './ws-events.js';
import { findBestParent, keywordComparisonKey } from '../shared/keyword-normalization.js';
import {
  getLostVisibilityKeys,
  getLostVisibilityQueries,
} from './client-discovered-queries.js';
import {
  deleteFeedbackByKeywordKey,
  readFeedback,
  upsertFeedback,
} from './domains/keyword-command-center/feedback-store.js';
import {
  filterMapByKeys,
  filterStrategyForKeys,
  filterStrategyForSingleKeyword,
  findVariantParentKey,
  pageMatchesKeyword,
  parentableVariantKeys,
  restrictPageToKeys,
} from './domains/keyword-command-center/bundle-filters.js';
import {
  KEYWORD_UNIVERSE_FULL_FLAG,
  LOCAL_CANDIDATE_ROW_LIMIT,
  RAW_EVIDENCE_ROW_LIMIT,
  UNIVERSE_SAFETY_CEILING,
  addCandidateKeysFromBundle,
  filterBundleToKeys,
  gateDiscoveryGaps,
  isTier1JunkKeyword,
  mergeMetricsInto,
  rowCandidateKeysForQuery,
  selectRankEvidence,
  sourceKeysForRows,
  trackedKeywordMatchesFilter,
  type CandidateRowMetricParity,
  type CandidateRowMetricProjection,
  type RowCandidateKey,
} from './domains/keyword-command-center/candidate-boundary.js';
import {
  mergeTrackedKeywordProvenance,
  withResolvedSiteKeywordMetrics,
} from './domains/keyword-command-center/tracked-keyword-provenance.js';
import {
  buildCounts,
  buildFilterFacetsFromCounts,
  buildFilters,
  filterNeedsLocalCandidates,
  matchesFilter,
  matchesSearch,
  paginateRows,
  setKeywordCommandCenterRowValueScore,
  sortRows,
  sortRowsForQuery,
  stripRowForList,
  type SkinnyFilterCounts,
} from './domains/keyword-command-center/row-query.js';
import {
  buildLocalSeoState,
  buildNextActions,
  ensureRow,
  feedbackState,
  lifecycleStatus,
  protectedReason,
  setAssignment,
  sourceFromExplanation,
  sourceFromKeywordGap,
  statusLabel,
  trackingSourceDetail,
} from './domains/keyword-command-center/row-lifecycle.js';
import type {
  CommandCenterSourceBundle,
  DraftRow,
  FeedbackRow,
  FinalizedRows,
  LostVisibilityQuery,
  RowFinalizeContext,
  ValueScoringConfig,
} from './domains/keyword-command-center/types.js';
import type { PageKeywordMap, Workspace } from '../shared/types/workspace.js';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  KEYWORD_COMMAND_CENTER_FILTERS,
  type KeywordCommandCenterActionRequest,
  type KeywordCommandCenterActionResult,
  type KeywordCommandCenterBulkActionItem,
  type KeywordCommandCenterBulkActionRequest,
  type KeywordCommandCenterBulkActionResult,
  type KeywordCommandCenterCounts,
  type KeywordCommandCenterDetailResponse,
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterMetrics,
  type KeywordCommandCenterRowsQuery,
  type KeywordCommandCenterRowsResponse,
  type KeywordCommandCenterResponse,
  type KeywordCommandCenterRow,
  type KeywordCommandCenterSourceLabel,
  type KeywordCommandCenterSummaryResponse,
} from '../shared/types/keyword-command-center.js';
import { LOCAL_SEO_MARKET_STATUS, LOCAL_SEO_VISIBILITY_POSTURE, type LocalSeoKeywordVisibilitySummary } from '../shared/types/local-seo.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
  type TrackedKeyword,
} from '../shared/types/rank-tracking.js';
import type { OutcomeReadback } from '../shared/types/outcome-tracking.js';

export {
  assignmentPriority,
  feedbackState,
  ensureRow,
  isInactiveTracking,
  lifecycleStatus,
  localPriority,
  protectedReason,
  sourceFromExplanation,
  sourceFromKeywordGap,
  statusLabel,
} from './domains/keyword-command-center/row-lifecycle.js';

export {
  buildCounts,
  buildFilterFacetsFromCounts,
  filterCount,
  filterNeedsLocalCandidates,
  matchesFilter,
  matchesSearch,
  paginateRows,
  sortRows,
  sortRowsForQuery,
  stripLocalSeoVisibility,
} from './domains/keyword-command-center/row-query.js';

export {
  inferTrackedKeywordSources,
  inferTrackedKeywordSourcesForWorkspace,
  mergeTrackedKeywordProvenance,
  withResolvedSiteKeywordMetrics,
} from './domains/keyword-command-center/tracked-keyword-provenance.js';

export {
  __candidateKeysForTest,
  candidateSortForQuery,
  gateDiscoveryGaps,
  trackedKeywordMatchesFilter,
} from './domains/keyword-command-center/candidate-boundary.js';

export type {
  CandidateRowMetricParity,
  RowCandidateKey,
} from './domains/keyword-command-center/candidate-boundary.js';

export type { CommandCenterSourceBundle } from './domains/keyword-command-center/types.js';

const log = createLogger('keyword-command-center');

/**
 * Per-request value-scoring config. Built ONCE per request in the rows-build entry
 * points. Value-first scoring is always on (`on: true` via buildValueScoringConfig);
 * `ctx` carries the posture/markets/city/state captured once per request (never per
 * keyword). Non-scoring key-only paths (e.g. candidate-key enumeration) may pass
 * `{ on: false }` to skip the score. The SAME config (same `ctx`) is threaded into
 * both the candidate merge-back (Task 1.3) and the row finalize (Task 1.4), so the
 * two stages compute the identical valueScore per key by construction.
 */
/**
 * Build the per-request value-scoring config. Fetches posture + markets ONCE and
 * captures the business-profile city/state — never per keyword. Value-first
 * scoring is always on (the `on` discriminator is retained so non-scoring paths
 * — e.g. key-only candidate enumeration — can still opt out with `{ on: false }`).
 */
function buildValueScoringConfig(workspace: Workspace): ValueScoringConfig {
  return {
    on: true,
    ctx: {
      posture: getLocalSeoPosture(workspace.id),
      markets: listLocalSeoMarkets(workspace.id),
      city: workspace.businessProfile?.address?.city?.toLowerCase(),
      state: workspace.businessProfile?.address?.state?.toLowerCase(),
    },
  };
}

function addSource(row: DraftRow, source: KeywordCommandCenterSourceLabel): void {
  if (row.sourceLabels.some(existing => existing.kind === source.kind && existing.label === source.label && existing.detail === source.detail)) return;
  row.sourceLabels.push(source);
}

function mergeMetrics(row: DraftRow, metrics: KeywordCommandCenterMetrics): void {
  row.metrics = mergeMetricsInto(row.keyword, row.metrics, metrics);
}

function safeLostVisibilityKeys(workspaceId: string): Set<string> {
  try {
    return getLostVisibilityKeys(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'discovered_queries unavailable while reading lost visibility keys');
    return new Set<string>();
  }
}

function safeLostVisibilityRows(workspaceId: string): LostVisibilityQuery[] {
  try {
    return getLostVisibilityQueries(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'discovered_queries unavailable while reading lost visibility rows');
    return [];
  }
}

async function populateDraftRows(rows: Map<string, DraftRow>, bundle: CommandCenterSourceBundle): Promise<void> {
  const strategy = bundle.strategy;

  for (const metric of strategy?.siteKeywordMetrics ?? []) {
    const row = ensureRow(rows, metric.keyword);
    if (!row) continue;
    setAssignment(row, { role: 'site_keyword' });
    addSource(row, { kind: 'strategy', label: 'Strategy keyword', detail: 'Site keyword' });
    mergeMetrics(row, { volume: metric.volume, difficulty: metric.difficulty });
  }

  for (const keyword of strategy?.siteKeywords ?? []) {
    const row = ensureRow(rows, keyword);
    if (!row) continue;
    setAssignment(row, { role: 'site_keyword' });
    addSource(row, { kind: 'strategy', label: 'Strategy keyword', detail: 'Site keyword' });
  }

  for (const page of bundle.pageMap) {
    const pageKeywords = [page.primaryKeyword, ...(page.secondaryKeywords ?? [])].filter(Boolean);
    for (const keyword of pageKeywords) {
      const row = ensureRow(rows, keyword);
      if (!row) continue;
      setAssignment(row, {
        pagePath: page.pagePath,
        pageTitle: page.pageTitle,
        role: 'page_keyword',
      });
      addSource(row, { kind: 'page_assignment', label: 'Page assignment', detail: page.pageTitle ?? page.pagePath });
      mergeMetrics(row, {
        volume: page.volume,
        difficulty: page.difficulty,
        cpc: page.cpc, // Task 3.2: join cpc from page_keywords (the realized-$ input)
        intent: page.searchIntent, // NOTE field name: pageMap carries intent as `searchIntent`
      });
    }
  }

  for (const gap of bundle.contentGaps) {
    const row = ensureRow(rows, gap.targetKeyword);
    if (!row) continue;
    setAssignment(row, {
      pageTitle: gap.topic,
      role: 'content_gap',
    });
    addSource(row, { kind: 'content_gap', label: 'Content opportunity', detail: gap.topic });
    mergeMetrics(row, {
      volume: gap.volume,
      difficulty: gap.difficulty,
      cpc: gap.cpc, // real content-gap cpc (#1103) → cpc-aware value score, same as enrichment/strategy
      intent: gap.intent,
    });
  }

  const strategyUx = bundle.includeStrategyUx === false
    ? null
    : await buildKeywordStrategyUxPayload({
      workspaceId: bundle.workspaceId,
      workspaceName: bundle.workspaceName,
      strategy: strategy ?? null,
      // Bug 1 fix: strategy here is withResolvedSiteKeywordMetrics result —
      // siteKeywordMetrics is already table-resolved. Pass explicitly since
      // buildKeywordStrategyUxPayload no longer reads options.strategy?.siteKeywordMetrics.
      siteKeywordMetrics: strategy?.siteKeywordMetrics,
      pageMap: bundle.pageMap,
      contentGaps: bundle.contentGaps,
      keywordGaps: bundle.keywordGaps,
      surface: 'admin',
      trackedKeywords: bundle.trackedKeywords,
      includeWorkspaceIntelligence: bundle.includeWorkspaceIntelligence,
    });

  for (const explanation of strategyUx?.explanations ?? []) {
    const row = ensureRow(rows, explanation.keyword);
    if (!row) continue;
    row.explanation = explanation;
    row.rawEvidenceOnly = Boolean(explanation.rawEvidenceOnly);
    addSource(row, sourceFromExplanation(explanation));
    mergeMetrics(row, {
      volume: explanation.role === 'content_gap'
        ? bundle.contentGaps.find(gap => keywordComparisonKey(gap.targetKeyword) === explanation.normalizedKeyword)?.volume
        : undefined,
      difficulty: explanation.role === 'content_gap'
        ? bundle.contentGaps.find(gap => keywordComparisonKey(gap.targetKeyword) === explanation.normalizedKeyword)?.difficulty
        : undefined,
    });
  }

  for (const gap of bundle.keywordGaps) {
    const row = ensureRow(rows, gap.keyword);
    if (!row) continue;
    row.rawEvidenceOnly = row.rawEvidenceOnly ?? !row.explanation;
    addSource(row, sourceFromKeywordGap(gap));
    mergeMetrics(row, {
      volume: gap.volume,
      difficulty: gap.difficulty,
    });
  }

  for (const keyword of bundle.trackedKeywords) {
    const row = ensureRow(rows, keyword.query);
    if (!row) continue;
    row.tracking = keyword;
    addSource(row, {
      kind: keyword.source === TRACKED_KEYWORD_SOURCE.MANUAL ? 'manual' : 'tracking',
      label: 'Rank tracking',
      detail: trackingSourceDetail(keyword.source),
    });
    mergeMetrics(row, {
      volume: keyword.volume,
      difficulty: keyword.difficulty,
      cpc: keyword.cpc,
      intent: keyword.intent,
      currentPosition: keyword.baselinePosition,
      clicks: keyword.baselineClicks,
      impressions: keyword.baselineImpressions,
    });
  }

  for (const [normalized, row] of bundle.feedback) {
    const draft = ensureRow(rows, row.keyword);
    if (!draft) continue;
    draft.feedback = feedbackState(row);
    addSource(draft, {
      kind: row.status === 'requested' ? 'client_request' : 'feedback',
      label: row.status === 'requested' ? 'Requested keyword' : 'Keyword feedback',
      detail: row.status,
    });
    if (draft.normalizedKeyword !== normalized) rows.set(normalized, draft);
  }

  for (const lost of bundle.lostVisibilityRows ?? []) {
    const row = ensureRow(rows, lost.query);
    if (!row) continue;
    row.rawEvidenceOnly = row.rawEvidenceOnly ?? true;
    addSource(row, {
      kind: 'rank_data',
      label: 'Lost Search Console visibility',
      detail: `Last seen ${lost.lastSeen}`,
    });
    mergeMetrics(row, {
      currentPosition: lost.lastPosition ?? undefined,
      impressions: lost.totalImpressions,
    });
  }

  const strategyKeys = [...rows.entries()]
    .filter(([, row]) => row.rawEvidenceOnly !== true)
    .map(([key]) => key);
  const metricsMap = new Map(
    strategyKeys.map(key => [key, rows.get(key)?.metrics.impressions ?? 0]),
  );
  const variantParentMap = new Map<string, string>();
  for (const rank of bundle.latestRanks) {
    const normalizedQuery = keywordComparisonKey(rank.query);
    if (!normalizedQuery || rows.has(normalizedQuery)) continue;
    const parent = findBestParent(normalizedQuery, strategyKeys, metricsMap);
    if (parent) variantParentMap.set(normalizedQuery, parent);
  }

  const rankedUntrackedFiltered = bundle.latestRanks
    .filter(rank => !rows.has(keywordComparisonKey(rank.query)))
    .filter(rank => !variantParentMap.has(keywordComparisonKey(rank.query)));
  const { selected: rankedUntracked } = selectRankEvidence(rankedUntrackedFiltered, bundle.workspaceId);
  for (const rank of rankedUntracked) {
    const row = ensureRow(rows, rank.query);
    if (!row) continue;
    row.rank = rank;
    addSource(row, { kind: 'rank_data', label: 'Search Console evidence', detail: 'Ranking query not currently selected' });
    mergeMetrics(row, {
      currentPosition: rank.position,
      clicks: rank.clicks,
      impressions: rank.impressions,
      ctr: rank.ctr,
    });
  }

  for (const rank of bundle.latestRanks) {
    const row = rows.get(keywordComparisonKey(rank.query));
    if (!row) continue;
    row.rank = rank;
    mergeMetrics(row, {
      currentPosition: rank.position,
      clicks: rank.clicks,
      impressions: rank.impressions,
      ctr: rank.ctr,
    });
  }

  // National SERP overlay (P6 / national-serp-tracking). PURELY ADDITIVE — it never writes
  // `currentPosition` (so the value score, which keys off GSC currentPosition, is identical to
  // the candidate/skinny replay path; the row==candidate invariant holds). `nationalPosition`
  // is the distinct live-SERP rank. Flag OFF → no read, no merge → byte-identical to pre-P6.
  // snap.query is already keywordComparisonKey-normalized at write time (joins to GSC rows).
  if (isFeatureEnabled('national-serp-tracking', bundle.workspaceId)) {
    for (const snap of getLatestSerpSnapshots(bundle.workspaceId)) {
      const row = rows.get(keywordComparisonKey(snap.query));
      if (!row) continue;
      mergeMetrics(row, {
        nationalPosition: snap.position,
        matchedUrl: snap.matchedUrl,
        serpFeatures: snap.features,
        aiOverviewCited: snap.aiOverviewCited,
        aiOverviewPresent: snap.aiOverviewPresent,
      });
    }
  }

  for (const rank of bundle.latestRanks) {
    const normalizedQuery = keywordComparisonKey(rank.query);
    const parentKey = variantParentMap.get(normalizedQuery);
    if (!parentKey) continue;
    const parentRow = rows.get(parentKey);
    if (!parentRow) continue;
    parentRow.variants = parentRow.variants ?? [];
    parentRow.variants.push(rank);
    parentRow.metrics.impressions = (parentRow.metrics.impressions ?? 0) + rank.impressions;
    parentRow.metrics.clicks = (parentRow.metrics.clicks ?? 0) + rank.clicks;
    if (
      parentRow.metrics.currentPosition == null
      || rank.position < parentRow.metrics.currentPosition
    ) {
      parentRow.metrics.currentPosition = rank.position;
    }
  }

  for (const candidate of bundle.localCandidates ?? []) {
    // F2: local candidates are built by buildLocalSeoKeywordCandidates (a separate
    // source from the gated gaps), so apply Tier-1 here too — a malformed gap
    // keyword with a local twin must not leak into the local_candidates filter.
    // Tier-1 only (matches the localVisibility candidate-boundary gate); local
    // candidates are a curated/local surface and are never relevance-gated.
    if (isTier1JunkKeyword(candidate.keyword)) continue;
    const row = ensureRow(rows, candidate.keyword);
    if (!row) continue;
    row.localCandidate = candidate;
    addSource(row, {
      kind: 'local_candidate',
      label: candidate.sourceLabel,
      detail: candidate.detail,
    });
    mergeMetrics(row, {
      volume: candidate.volume,
      difficulty: candidate.difficulty,
    });
  }
}

function finalizeDraftRow(row: DraftRow, context: RowFinalizeContext): KeywordCommandCenterRow {
  const status = lifecycleStatus(row);
  const protection = protectedReason(row.tracking);
  const explanationRole = row.explanation?.role;
  const isProtected = Boolean(protection);
  const localSeo = context.localVisibilityByKeyword.get(row.normalizedKeyword);
  const localSeoState = buildLocalSeoState(row, status, localSeo, context.activeLocalMarketCount);
  const finalized: KeywordCommandCenterRow = {
    keyword: row.keyword,
    normalizedKeyword: row.normalizedKeyword,
    lifecycleStatus: status,
    statusLabel: statusLabel(status),
    sourceLabels: row.sourceLabels,
    metrics: row.metrics,
    assignment: row.explanation ? {
      pagePath: row.explanation.pagePath,
      pageTitle: row.explanation.pageTitle,
      role: explanationRole === 'competitor_gap' ? 'raw_evidence' : explanationRole,
    } : row.assignment ?? (row.localCandidate?.pagePath || row.localCandidate?.pageTitle ? {
      pagePath: row.localCandidate.pagePath,
      pageTitle: row.localCandidate.pageTitle,
      role: row.localCandidate.source === 'content_gap' ? 'content_gap' : 'page_keyword',
    } : undefined),
    feedback: row.feedback,
    tracking: row.tracking ? {
      status: row.tracking.status ?? TRACKED_KEYWORD_STATUS.ACTIVE,
      source: row.tracking.source,
      pinned: row.tracking.pinned,
      addedAt: row.tracking.addedAt,
      pagePath: row.tracking.pagePath,
      pageTitle: row.tracking.pageTitle,
      replacedBy: row.tracking.replacedBy,
      deprecatedAt: row.tracking.deprecatedAt,
      // Wave 3d-i ADDITIVE provenance (admin-only). Merged onto bundle.trackedKeywords
      // from the provenance-bearing table read (mergeTrackedKeywordProvenance).
      sourceGapKey: row.tracking.sourceGapKey,
      // Wave 4 P0 ADDITIVE ownership (admin-only, three-state). Merged onto row.tracking
      // by mergeTrackedKeywordProvenance from the provenance-bearing read. Project the
      // raw value — NEVER Boolean()/?? false (undefined = ownership unknown, a real state).
      // Stripped from getTrackedKeywords / the public endpoint, so it never leaks.
      strategyOwned: row.tracking.strategyOwned,
      // True when any rank/GSC signal has materialized for the row. Distinguishes
      // active-with-data ("Active") from active-but-empty ("Awaiting data") in the UI.
      // Audit on Swish found ~75% of active-tracked rows had no rank/clicks/impressions —
      // they were tracked in name only until a snapshot showed up.
      hasSignal: row.metrics.currentPosition != null
        || row.metrics.clicks != null
        || row.metrics.impressions != null,
    } : { status: 'not_tracked' },
    explanation: row.explanation,
    localSeo,
    localSeoState,
    nextActions: buildNextActions(row, status, isProtected, protection, localSeoState),
    isProtected,
    protectionReason: protection,
    rawEvidenceOnly: row.rawEvidenceOnly,
    variantCount: row.variants?.length ?? 0,
    variants: row.variants?.map(variant => ({
      query: variant.query,
      position: variant.position,
      clicks: variant.clicks,
      impressions: variant.impressions,
      ctr: variant.ctr,
    })),
    isLostVisibility: context.lostVisibilityKeys?.has(row.normalizedKeyword) ?? false,
  };
  // Phase 1: precompute the row value score ONCE per key (flag ON only) from the
  // fully-merged row.metrics, using the SAME computeKeywordValueScore + SAME
  // per-request ScoringContext as the candidate merge-back — so candidate and row
  // scores are identical by construction. Stored on the WeakMap (never serialized).
  if (context.valueScoring?.on && context.valueScoring.ctx) {
    const input = {
      keyword: finalized.keyword,
      volume: finalized.metrics.volume,
      impressions: finalized.metrics.impressions,
      difficulty: finalized.metrics.difficulty,
      cpc: finalized.metrics.cpc,
      intent: finalized.metrics.intent,
    };
    const { score, components } = computeKeywordValueComponents(input, context.valueScoring.ctx);
    if (score !== undefined) setKeywordCommandCenterRowValueScore(finalized, score);
    // Task 2.2: populate valueReasons from components (admin-only, flag-gated).
    if (components !== undefined) {
      finalized.valueReasons = keywordValueReasons(components, {
        cpc: finalized.metrics.cpc,
        volume: finalized.metrics.volume,
        difficulty: finalized.metrics.difficulty,
      });
    }
  }
  // Task 3.3: per-keyword realized $ via the single keywordDollarValue helper (one $
  // definition — currentMonthly == roi.ts trafficValue). Admin-only path; no flag
  // gate — same realized $ class as ROI. cpc sparsity floors to 0 → omit so the
  // drawer hides the block (no cpc). Also require a realized-traffic signal so a
  // content-gap-only row (which now carries cpc for scoring but has no GSC data)
  // does not surface a misleading $0 block — matching the client, which computes $
  // only for page_keywords (keyword-strategy-ux). Without a signal both figures are
  // 0 anyway, so this only suppresses empty $ blocks.
  const hasRealizedSignal = finalized.metrics.clicks != null
    || finalized.metrics.impressions != null
    || finalized.metrics.currentPosition != null;
  if (finalized.metrics.cpc != null && finalized.metrics.cpc > 0 && hasRealizedSignal) {
    const money = keywordDollarValue({
      clicks: finalized.metrics.clicks,
      cpc: finalized.metrics.cpc,
      currentPosition: finalized.metrics.currentPosition,
      impressions: finalized.metrics.impressions,
      ctrCurve: null,
    });
    finalized.currentMonthly = money.currentMonthly;
    finalized.upsideMonthly = money.upsideMonthly;
  }
  return finalized;
}

function finalizeDraftRows(rows: Map<string, DraftRow>, context: RowFinalizeContext): FinalizedRows {
  const rawEvidenceRows = [...rows.values()].filter(row => row.rawEvidenceOnly && !row.tracking && !row.feedback && !row.localCandidate);
  // Flag-derived raw-evidence cap: 75 (flag OFF, byte-identical) → the universe
  // safety ceiling (flag ON). Still value-ordered (volume desc) so the cap keeps
  // the high-value head — the row stage's equivalent of selectRankEvidence.
  const rawEvidenceLimit = isFeatureEnabled(KEYWORD_UNIVERSE_FULL_FLAG, context.workspaceId)
    ? UNIVERSE_SAFETY_CEILING
    : RAW_EVIDENCE_ROW_LIMIT;
  const allowedRawEvidence = new Set(
    rawEvidenceRows
      .sort((a, b) => (b.metrics.volume ?? 0) - (a.metrics.volume ?? 0))
      .slice(0, rawEvidenceLimit)
      .map(row => row.normalizedKeyword),
  );

  const finalRows = [...rows.values()]
    .filter(row => !row.rawEvidenceOnly || row.tracking || row.feedback || row.localCandidate || allowedRawEvidence.has(row.normalizedKeyword))
    .map(row => finalizeDraftRow(row, context))
    .sort(sortRows);

  return {
    rows: finalRows,
    rawEvidenceTotal: rawEvidenceRows.length,
    rawEvidenceReturned: allowedRawEvidence.size,
  };
}

function ensureLocalVisibilityRows(
  rows: Map<string, DraftRow>,
  localVisibilityByKeyword: Map<string, LocalSeoKeywordVisibilitySummary>,
): void {
  for (const [normalizedKeyword, visibility] of localVisibilityByKeyword) {
    const row = ensureRow(rows, visibility.keyword);
    if (!row) continue;
    if (row.normalizedKeyword !== normalizedKeyword) rows.set(normalizedKeyword, row);
    addSource(row, {
      kind: 'local_visibility',
      label: 'Local visibility',
      detail: visibility.label,
    });
  }
}

async function buildKeywordCommandCenterModel(
  workspaceId: string,
  options: {
    includeLocalSeo?: boolean;
    includeLocalSeoDetails?: boolean;
    includeLocalCandidates?: boolean;
    includeStrategyUx?: boolean;
    timingLabel?: string;
  } = {},
): Promise<KeywordCommandCenterResponse | null> {
  const startedAt = Date.now();
  const marks: Record<string, number> = {};
  const heap: Record<string, number> = {};
  const mark = (stage: string) => {
    marks[stage] = Date.now() - startedAt;
    heap[stage.replace(/Ms$/, 'HeapMb')] = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  };
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;

  // #19b: siteKeywordMetrics resolved table-first (blob fallback). siteKeywords/
  // generatedAt stay blob-sourced.
  const strategy = withResolvedSiteKeywordMetrics(workspace.id, workspace.keywordStrategy);
  const pageMap = options.includeStrategyUx === false
    ? listPageKeywordsLite(workspace.id)
    : listPageKeywords(workspace.id);
  // contentGaps + keywordGaps via the single assembler (#2). strategy stays the
  // raw blob (siteKeywords/generatedAt) with siteKeywordMetrics table-resolved
  // above, and pageMap keeps the Lite/full page_keywords path above — KCC only
  // needs the two gap arrays here.
  const assembled = assembleStoredKeywordStrategy(workspace.id);
  // Tier-1 + Tier-2 junk gate applied ONCE at the discovery source so the read
  // model (incl. the LOCAL_CANDIDATES filter) never surfaces a junk gap keyword.
  const { contentGaps, keywordGaps } = gateDiscoveryGaps({
    contentGaps: assembled?.contentGaps ?? [],
    keywordGaps: assembled?.keywordGaps ?? [],
  });
  // Wave 3d-i: getTrackedKeywords strips provenance; merge sourceGapKey back from
  // the provenance-bearing table read (KCC is admin-authed) so the tracking row can
  // expose it.
  // Wave 3d-ii: read the table-bearing shape (sourceGapKey + strategyOwned merged
  // back). Ownership/classification now reads strategyOwned directly — the read-time
  // inferTrackedKeywordSources call was RETIRED (the boot backfill still stamps legacy
  // UNKNOWN sources one-time). sourceKeysForRows + trackedKeywordMatchesFilter +
  // protectedReason all agree on this merged shape.
  const trackedKeywords = mergeTrackedKeywordProvenance(
    workspace.id,
    getTrackedKeywords(workspace.id, { includeInactive: true }),
  );
  const latestRanks = getLatestSnapshotRanks(workspace.id);
  const feedback = readFeedback(workspace.id);
  const lostVisibilityRows = safeLostVisibilityRows(workspace.id);
  const lostVisibilityKeys = new Set(lostVisibilityRows.map(row => keywordComparisonKey(row.query)).filter(Boolean));
  mark('sourceLoadingMs');
  const localVisibilityByKeyword = options.includeLocalSeo
    ? options.includeLocalSeoDetails
      ? buildLocalSeoKeywordVisibilityByKey(workspace.id)
      : buildLocalSeoKeywordVisibilitySummaryByKey(workspace.id)
    : new Map();
  // KCC row enrichment uses sourceLabel/detail/pagePath/pageTitle/volume/difficulty.
  // `reasons` and the evaluator's suppression are not needed — cheap default is correct.
  const localCandidates = options.includeLocalSeo && options.includeLocalCandidates === true
    ? (() => {
        // Sort unselected candidates first so the slice doesn't exhaust its budget on
        // strategy/tracking-sourced entries (which are already IN_STRATEGY or TRACKED and
        // therefore get lifecycle=SELECTED).  The "Local Candidates" filter only matches
        // lifecycle=CANDIDATE, so without this reorder the filter returns 0 rows even
        // when hundreds of local_variant / content_gap candidates exist further down the
        // score-sorted list.  Within each group the original score order is preserved.
        const all = buildLocalSeoKeywordCandidates(workspace.id);
        const sorted = [
          ...all.filter(c => !c.selected),
          ...all.filter(c => c.selected),
        ];
        // Task 3 OOM EXCEPTION: the universe-full flag does NOT lift this cap.
        // localCandidates feed the LOCAL_CANDIDATES filter, which takes the MODEL
        // path (buildKeywordCommandCenterModel → full per-row evaluation, not the
        // page-bounded skinny path). Lifting this to UNIVERSE_SAFETY_CEILING would
        // force thousands of full row evaluations into memory at once (the exact
        // OOM regression docs/rules/keyword-command-center.md guards against), so it
        // stays at LOCAL_CANDIDATE_ROW_LIMIT regardless of the flag.
        return sorted.slice(0, LOCAL_CANDIDATE_ROW_LIMIT);
      })()
    : [];
  const activeLocalMarketCount = options.includeLocalSeo
    ? listLocalSeoMarkets(workspace.id).filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length
    : 0;
  mark('localSeoMs');
  const rows = new Map<string, DraftRow>();
  await populateDraftRows(rows, {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    strategy,
    pageMap,
    contentGaps,
    keywordGaps,
    trackedKeywords,
    latestRanks,
    feedback,
    localCandidates,
    lostVisibilityRows,
    includeStrategyUx: options.includeStrategyUx,
  });
  ensureLocalVisibilityRows(rows, localVisibilityByKeyword);
  mark('strategyUxMs');
  const finalized = finalizeDraftRows(rows, {
    workspaceId: workspace.id,
    localVisibilityByKeyword,
    activeLocalMarketCount,
    lostVisibilityKeys,
    // Phase 1: precompute row valueScore in finalize when the flag is ON (no DB
    // reads when OFF). The model path's row sort selects the accessor by the same flag.
    valueScoring: buildValueScoringConfig(workspace),
  });
  const finalRows = finalized.rows;
  mark('rowIndexMs');

  log.info({
    workspaceId,
    mode: options.timingLabel ?? 'full',
    rowCount: finalRows.length,
    rawEvidenceTotal: finalized.rawEvidenceTotal,
    rawEvidenceReturned: finalized.rawEvidenceReturned,
    ...marks,
    ...heap,
    totalMs: Date.now() - startedAt,
    finalHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'keyword command center read model built');

  return {
    rows: finalRows,
    counts: buildCounts(finalRows),
    filters: buildFilters(finalRows),
    rawEvidenceTotal: finalized.rawEvidenceTotal,
    rawEvidenceReturned: finalized.rawEvidenceReturned,
    generatedAt: strategy?.generatedAt ?? null,
  };
}

export async function buildKeywordCommandCenterSummary(
  workspaceId: string,
  options: { includeLocalSeo?: boolean } = {},
): Promise<KeywordCommandCenterSummaryResponse | null> {
  const startedAt = Date.now();
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;

  const allKeys = new Set<string>();
  const inStrategyKeys = new Set<string>();
  const pageAssignedKeys = new Set<string>();
  const contentKeys = new Set<string>();
  const rawEvidenceKeys = new Set<string>();
  // Track which keys have at least one source contributing a positive volume
  // value. Used to surface "{X} keywords missing demand data" diagnostic.
  const keysWithVolume = new Set<string>();
  const addKey = (target: Set<string>, keyword: string | undefined) => {
    const key = keywordComparisonKey(keyword ?? '');
    if (!key) return;
    target.add(key);
    allKeys.add(key);
  };
  const markVolume = (keyword: string | undefined, volume: number | undefined | null) => {
    if (volume == null || volume <= 0) return;
    // Mirror the planner-bucket mask from mergeMetrics — a 1M+ planner sentinel
    // is NOT real demand data, so it must not count toward the volume diagnostic.
    if (isSuspiciousPlannerGroupedVolume(keyword, volume)) return;
    const key = keywordComparisonKey(keyword ?? '');
    if (!key) return;
    keysWithVolume.add(key);
  };

  // #19b: siteKeywordMetrics resolved table-first (blob fallback).
  const summaryStrategy = withResolvedSiteKeywordMetrics(workspace.id, workspace.keywordStrategy);
  for (const metric of summaryStrategy?.siteKeywordMetrics ?? []) {
    addKey(inStrategyKeys, metric.keyword);
    markVolume(metric.keyword, metric.volume);
  }
  for (const keyword of summaryStrategy?.siteKeywords ?? []) addKey(inStrategyKeys, keyword);

  for (const page of listPageKeywordsLite(workspace.id)) {
    addKey(pageAssignedKeys, page.primaryKeyword);
    addKey(inStrategyKeys, page.primaryKeyword);
    markVolume(page.primaryKeyword, page.volume);
    for (const secondary of page.secondaryKeywords ?? []) {
      addKey(pageAssignedKeys, secondary);
      addKey(inStrategyKeys, secondary);
      // Page secondaries don't carry their own volume — the page's volume is
      // associated with the primary keyword only.
    }
  }

  // contentGaps + keywordGaps via the single assembler (#2); siteKeywords/
  // siteKeywordMetrics above stay blob-sourced (workspace.keywordStrategy).
  // F1 fix: gate the discovery gaps through the SAME Tier-1 + Tier-2 junk gate the
  // rows path uses, so the summary `counts`/`filterCounts` and `/rows?filter=all`
  // `totalRows` agree on the gated universe (numerator/denominator share a source).
  const summaryAssembled = assembleStoredKeywordStrategy(workspace.id);
  const { contentGaps, keywordGaps } = gateDiscoveryGaps({
    contentGaps: summaryAssembled?.contentGaps ?? [],
    keywordGaps: summaryAssembled?.keywordGaps ?? [],
  });
  for (const gap of contentGaps) {
    addKey(contentKeys, gap.targetKeyword);
    addKey(inStrategyKeys, gap.targetKeyword);
    markVolume(gap.targetKeyword, gap.volume);
  }

  for (const gap of keywordGaps) {
    addKey(rawEvidenceKeys, gap.keyword);
    markVolume(gap.keyword, gap.volume);
  }

  const feedback = readFeedback(workspace.id);
  // Wave 3d-ii: merge the table-bearing shape so trackedKeywordMatchesFilter (used
  // below) sees strategyOwned — getTrackedKeywords STRIPS it, so without this merge
  // the IN_STRATEGY summary count would read undefined → false → zero. Read-time
  // inferTrackedKeywordSources was retired here too.
  const trackedKeywords = mergeTrackedKeywordProvenance(
    workspace.id,
    getTrackedKeywords(workspace.id, { includeInactive: true }),
  );
  for (const tracked of trackedKeywords) {
    addKey(allKeys, tracked.query);
    markVolume(tracked.query, tracked.volume);
  }
  const trackedKeys = new Set(trackedKeywords.map(keyword => keywordComparisonKey(keyword.query)).filter(Boolean));

  // Align with sourceKeysForRows(IN_STRATEGY): tracked keywords promoted from the
  // strategy (active + STRATEGY_PRIMARY/STRATEGY_SITE_KEYWORD source) count toward
  // In Strategy. Without this, the summary badge under-counts vs the rows table.
  for (const tracked of trackedKeywords) {
    if (trackedKeywordMatchesFilter(tracked, KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY)) {
      addKey(inStrategyKeys, tracked.query);
    }
  }

  for (const row of feedback.values()) addKey(allKeys, row.keyword);
  const feedbackKeys = new Set([...feedback.keys()]);

  // Align with sourceKeysForRows(IN_STRATEGY): approved feedback keywords count toward
  // In Strategy; declined/requested feedback keys must NOT (they live under other tabs).
  for (const row of feedback.values()) {
    if (row.status === 'approved') addKey(inStrategyKeys, row.keyword);
  }
  for (const row of feedback.values()) {
    if (row.status === 'declined' || row.status === 'requested') {
      const key = keywordComparisonKey(row.keyword);
      if (key) inStrategyKeys.delete(key);
    }
  }

  const latestRanks = getLatestSnapshotRanks(workspace.id);
  const lostVisibilityRows = safeLostVisibilityRows(workspace.id);
  const lostVisibilityCount = lostVisibilityRows.length;
  const lostVisibilityKeys = new Set(lostVisibilityRows.map(row => keywordComparisonKey(row.query)).filter(Boolean));
  for (const key of lostVisibilityKeys) allKeys.add(key);
  const rankEvidenceKeys = new Set<string>();
  // The pre-ceiling count of selected rank-evidence queries — drives honest
  // truncation disclosure (rawEvidenceTotal) when the safety ceiling bites.
  const rankEvidenceFiltered = latestRanks.filter(
    rank => !allKeys.has(keywordComparisonKey(rank.query)),
  );
  const rankEvidence = selectRankEvidence(rankEvidenceFiltered, workspace.id);
  for (const rank of rankEvidence.selected) {
    addKey(rankEvidenceKeys, rank.query);
  }
  const rankEvidenceTotal = rankEvidence.total;

  // Striking-distance count: distinct keyword keys with position 11–20 inclusive
  // (page 2). Uses a Set to deduplicate variants. The source set MUST mirror
  // sourceKeysForRows(STRIKING_DISTANCE) and the isStrikingDistanceRow row filter,
  // which read the MERGED currentPosition (rank snapshot OR tracked baselinePosition).
  // Excluding baselinePosition here under-counted the pill vs the rendered rows: a
  // tracked keyword with baselinePosition 11–20 and NO rank snapshot would appear in
  // the rows but be invisible to the facet count (rate-display rule — the pill count
  // must equal the rendered rows).
  const strikingDistanceKeys = new Set<string>();
  for (const rank of latestRanks) {
    if (rank.position >= 11 && rank.position <= 20) {
      const key = keywordComparisonKey(rank.query);
      if (key) strikingDistanceKeys.add(key);
    }
  }
  for (const tracked of trackedKeywords) {
    const pos = tracked.baselinePosition;
    if (pos != null && pos >= 11 && pos <= 20) {
      const key = keywordComparisonKey(tracked.query);
      if (key) strikingDistanceKeys.add(key);
    }
  }
  const strikingDistanceCount = strikingDistanceKeys.size;

  const activeTracked = trackedKeywords.filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE);
  const inactiveTracked = trackedKeywords.filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE);
  const requested = [...feedback.values()].filter(row => row.status === 'requested');
  const declined = [...feedback.values()].filter(row => row.status === 'declined');
  const rawEvidenceOnlyKeys = new Set(
    [...rawEvidenceKeys].filter(key =>
      !inStrategyKeys.has(key)
      && !trackedKeys.has(key)
      && !feedbackKeys.has(key)
    ),
  );
  const localVisibility = options.includeLocalSeo ? buildLocalSeoKeywordVisibilitySummaryByKey(workspace.id) : new Map();
  for (const key of localVisibility.keys()) allKeys.add(key);
  const localVisibilityValues = [...localVisibility.values()];

  // Local Candidates badge: cheap count-only path that skips evaluateKeywordCandidate
  // (the per-candidate scan that caused the 35-second regression in PR #876).
  // `countLocalSeoKeywordCandidates` mirrors the candidate generator's outer iteration
  // and source filters (declined/inactive/intent/market) but never builds row objects
  // or runs eligibility evaluation. Sub-100ms even on Swish-scale workspaces.
  // Slight overcount possible — the displayable list still comes from the full
  // generator when the user clicks into the Local Candidates filter.
  let localCandidatesCount = 0;
  if (options.includeLocalSeo) {
    try {
      // local-candidates-unconditional-ok: countLocalSeoKeywordCandidates is the cheap-count helper, not the full generator; capped at LOCAL_CANDIDATE_HARD_CAP
      localCandidatesCount = countLocalSeoKeywordCandidates(workspace.id);
    } catch (err) {
      log.warn({ err, workspaceId }, 'localCandidates count failed; reporting 0');
    }
  }

  // Keywords across the universe with no real provider volume attached.
  // Planner-bucket sentinels (1M+) are intentionally excluded from "has volume"
  // so they count as missing — consistent with the mergeMetrics mask in rows.
  const missingVolume = Math.max(0, allKeys.size - keysWithVolume.size);

  const counts: KeywordCommandCenterCounts = {
    total: allKeys.size,
    inStrategy: inStrategyKeys.size,
    tracked: activeTracked.length,
    needsReview: requested.length + rankEvidenceKeys.size,
    evidence: rawEvidenceOnlyKeys.size,
    local: localVisibility.size,
    localCandidates: localCandidatesCount,
    retired: inactiveTracked.length,
    declined: declined.length,
    strikingDistance: strikingDistanceCount,
    missingVolume,
    lostVisibility: lostVisibilityCount,
  };
  const filterCounts: SkinnyFilterCounts = {
    all: counts.total,
    inStrategy: counts.inStrategy,
    tracked: counts.tracked,
    needsReview: counts.needsReview,
    content: contentKeys.size,
    pageAssigned: pageAssignedKeys.size,
    rawEvidence: counts.evidence,
    local: counts.local,
    localCandidates: localCandidatesCount,
    strikingDistance: strikingDistanceCount,
    visibleLocally: localVisibilityValues.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE).length,
    possibleMatch: localVisibilityValues.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH).length,
    notVisible: localVisibilityValues.filter(item =>
      item.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE
      || item.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT,
    ).length,
    notChecked: 0,
    providerDegraded: localVisibilityValues.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED).length,
    requested: requested.length,
    declined: declined.length,
    retired: inactiveTracked.length,
    lostVisibility: lostVisibilityCount,
  };

  log.info({
    workspaceId,
    mode: 'summary-skinny',
    totalKeys: counts.total,
    trackedCount: trackedKeywords.length,
    contentGapCount: contentGaps.length,
    keywordGapCount: keywordGaps.length,
    localVisibilityCount: localVisibility.size,
    totalMs: Date.now() - startedAt,
    finalHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'keyword command center summary built');

  let geoLabel: string | undefined;
  try {
    geoLabel = getPrimaryMarketLocationCode(workspace.id)?.label;
  } catch (err) {
    log.debug({ err, workspaceId }, 'KCC summary geo label lookup failed; omitting');
  }

  // Honest truncation disclosure (Task 3). The rank-evidence selection above is
  // already ceiling-capped (post-ceiling) and feeds rawEvidenceOnlyKeys, so
  // rawEvidenceOnlyKeys.size is the RETURNED universe. The TRUE pre-ceiling size
  // adds back the value-ordered tail the ceiling dropped, so when the ceiling bites
  // rawEvidenceTotal > rawEvidenceReturned and the Task-4 banner fires. Flag OFF:
  // droppedRankEvidenceTail is 0 (the 50-cap leaves no tail) and the raw cap stays
  // RAW_EVIDENCE_ROW_LIMIT (75) — byte-identical to today.
  const droppedRankEvidenceTail = Math.max(0, rankEvidenceTotal - rankEvidence.selected.length);
  const rawEvidenceReturnedCap = isFeatureEnabled(KEYWORD_UNIVERSE_FULL_FLAG, workspace.id)
    ? UNIVERSE_SAFETY_CEILING
    : RAW_EVIDENCE_ROW_LIMIT;

  return {
    counts,
    filters: buildFilterFacetsFromCounts(filterCounts),
    rawEvidenceTotal: rawEvidenceOnlyKeys.size + droppedRankEvidenceTail,
    rawEvidenceReturned: Math.min(counts.evidence, rawEvidenceReturnedCap),
    generatedAt: workspace.keywordStrategy?.generatedAt ?? null,
    summarizedAt: new Date().toISOString(),
    geoLabel,
  };
}

function localVisibilityByFilter(
  workspaceId: string,
  filter: KeywordCommandCenterFilter,
  includeLocalSeo: boolean | undefined,
): Map<string, LocalSeoKeywordVisibilitySummary> {
  if (!includeLocalSeo) return new Map();
  const visibility = buildLocalSeoKeywordVisibilitySummaryByKey(workspaceId);
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.ALL) return visibility;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY) {
    return new Map([...visibility.entries()].filter(([, item]) => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE));
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH) {
    return new Map([...visibility.entries()].filter(([, item]) => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH));
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE) {
    return new Map([...visibility.entries()].filter(([, item]) =>
      item.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE
      || item.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT,
    ));
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED) {
    return new Map([...visibility.entries()].filter(([, item]) => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED));
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL) return visibility;
  return new Map();
}

function filterUsesLocalVisibilityRows(filter: KeywordCommandCenterFilter): boolean {
  return filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL
    || filter === KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY
    || filter === KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH
    || filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE
    || filter === KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED;
}

export async function __candidateRowMetricParityForTest(
  bundle: CommandCenterSourceBundle,
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary> = new Map(),
): Promise<CandidateRowMetricParity> {
  // Run the probe with value scoring ON so candidate.valueScore and the row
  // valueScore are populated and can be compared per key. The ScoringContext is a
  // pure request constant (no DB) — a fixed posture/markets is sufficient for the
  // drift guard (the SAME ctx feeds both stages, which is all parity requires).
  const valueScoring: ValueScoringConfig = { on: true, ctx: { posture: 'non_local', markets: [] } };

  const candidates = new Map<string, RowCandidateKey>();
  addCandidateKeysFromBundle(candidates, { ...bundle, includeStrategyUx: false }, localVisibility, valueScoring);
  const candidate = new Map<string, CandidateRowMetricProjection>();
  for (const c of candidates.values()) {
    candidate.set(c.key, { demand: c.demand, clicks: c.clicks, rank: c.rank, difficulty: c.difficulty, cpc: c.cpc, intent: c.intent, valueScore: c.valueScore });
  }

  const rows = new Map<string, DraftRow>();
  await populateDraftRows(rows, { ...bundle, includeStrategyUx: false });
  // CRITICAL: the real skinny path calls ensureLocalVisibilityRows AFTER
  // populateDraftRows (keyword-command-center.ts:2797-2798). Without this, a
  // localVisibility-only key exists on the candidate side (addCandidateKeysFromBundle
  // adds it) but is ABSENT on the row side — a false key-set divergence. Mirror
  // production exactly so the key sets match for real, not by papering over a bug.
  ensureLocalVisibilityRows(rows, localVisibility);
  const row = new Map<string, CandidateRowMetricProjection>();
  for (const r of rows.values()) {
    // The row valueScore is computed in finalizeDraftRow from finalized.metrics,
    // which is row.metrics verbatim — so computing it here from r.metrics with the
    // SAME fn + SAME ctx is byte-identical to production's finalize computation.
    const rowValue = valueScoring.ctx
      ? computeKeywordValueScore(
          {
            keyword: r.keyword,
            volume: r.metrics.volume,
            impressions: r.metrics.impressions,
            difficulty: r.metrics.difficulty,
            cpc: r.metrics.cpc,
            intent: r.metrics.intent,
          },
          valueScoring.ctx,
        )
      : undefined;
    row.set(r.normalizedKeyword, {
      demand: r.metrics.volume ?? r.metrics.impressions ?? 0,
      clicks: r.metrics.clicks,
      rank: r.metrics.currentPosition,
      difficulty: r.metrics.difficulty,
      cpc: r.metrics.cpc,
      intent: r.metrics.intent,
      valueScore: rowValue,
    });
  }
  return { candidate, row };
}

function buildFilteredBundle(input: {
  workspace: Workspace;
  filter: KeywordCommandCenterFilter;
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary>;
}): CommandCenterSourceBundle & { keys: Set<string> | null } {
  // #19b: siteKeywordMetrics resolved table-first (blob fallback).
  const strategy = withResolvedSiteKeywordMetrics(input.workspace.id, input.workspace.keywordStrategy);
  const pageMap = listPageKeywordsLite(input.workspace.id);
  // contentGaps + keywordGaps via the single assembler (#2); strategy stays the
  // raw blob (with siteKeywordMetrics table-resolved) and pageMap keeps the Lite
  // page_keywords path.
  const filteredAssembled = assembleStoredKeywordStrategy(input.workspace.id);
  // Gate discovery gaps once at the source (Tier-1 + Tier-2) so the skinny rows
  // path's candidate gathering, populateDraftRows, and key derivation all read the
  // same gated gaps — identical to the read-model / summary / detail paths.
  const { contentGaps, keywordGaps } = gateDiscoveryGaps({
    contentGaps: filteredAssembled?.contentGaps ?? [],
    keywordGaps: filteredAssembled?.keywordGaps ?? [],
  });
  // Wave 3d-i: merge sourceGapKey back from the provenance-bearing table read
  // (getTrackedKeywords strips it; KCC is admin-authed so it may surface it).
  const trackedKeywords = mergeTrackedKeywordProvenance(
    input.workspace.id,
    getTrackedKeywords(input.workspace.id, { includeInactive: true }),
  );
  const latestRanks = getLatestSnapshotRanks(input.workspace.id);
  const feedback = readFeedback(input.workspace.id);
  const lostVisibilityRows = safeLostVisibilityRows(input.workspace.id);
  const variantParentKeys = parentableVariantKeys({
    strategy,
    pageMap,
    contentGaps,
    trackedKeywords,
    feedback,
  });
  const keys = sourceKeysForRows({
    workspaceId: input.workspace.id,
    filter: input.filter,
    strategy,
    pageMap,
    contentGaps,
    keywordGaps,
    trackedKeywords,
    latestRanks,
    feedback,
    localVisibility: input.localVisibility,
    lostVisibilityRows,
  });

  return {
    keys,
    workspaceId: input.workspace.id,
    workspaceName: input.workspace.name,
    strategy: filterStrategyForKeys(strategy, keys),
    pageMap: pageMap
      .map(page => restrictPageToKeys(page, keys))
      .filter((page): page is PageKeywordMap => page !== null),
    contentGaps: keys ? contentGaps.filter(gap => keys.has(keywordComparisonKey(gap.targetKeyword))) : contentGaps,
    keywordGaps: keys ? keywordGaps.filter(gap => keys.has(keywordComparisonKey(gap.keyword))) : keywordGaps,
    trackedKeywords: keys ? trackedKeywords.filter(keyword => keys.has(keywordComparisonKey(keyword.query))) : trackedKeywords,
    latestRanks: keys
      ? latestRanks.filter(rank => {
        const key = keywordComparisonKey(rank.query);
        const parent = findVariantParentKey(key, variantParentKeys);
        return keys.has(key) || Boolean(parent && keys.has(parent));
      })
      : latestRanks,
    feedback: filterMapByKeys(feedback, keys),
    lostVisibilityRows: keys
      ? lostVisibilityRows.filter(row => keys.has(keywordComparisonKey(row.query)))
      : lostVisibilityRows,
    includeStrategyUx: false,
  };
}

async function buildKeywordCommandCenterRowsViaModel(
  workspaceId: string,
  query: KeywordCommandCenterRowsQuery,
  options: { includeLocalSeo?: boolean },
): Promise<KeywordCommandCenterRowsResponse | null> {
  const payload = await buildKeywordCommandCenterModel(workspaceId, {
    includeLocalSeo: options.includeLocalSeo,
    includeLocalSeoDetails: false,
    includeLocalCandidates: true,
    includeStrategyUx: false,
    timingLabel: 'rows-local-candidate',
  });
  if (!payload) return null;
  // The model builder already precomputed each row's value score in finalize; the
  // sort here is a cheap cached field read of that score (no extra DB work, no
  // ScoringContext needed).
  const filter = query.filter ?? KEYWORD_COMMAND_CENTER_FILTERS.ALL;
  const filtered = payload.rows
    .filter(row => matchesFilter(row, filter))
    .filter(row => matchesSearch(row, query.search))
    .sort(sortRowsForQuery(query.sort, query.direction));
  const page = paginateRows(filtered.map(stripRowForList), query);
  return {
    rows: page.rows,
    pageInfo: {
      page: page.page,
      pageSize: page.pageSize,
      totalRows: page.totalRows,
      totalPages: page.totalPages,
      hasNextPage: page.hasNextPage,
      hasPreviousPage: page.hasPreviousPage,
    },
    generatedAt: payload.generatedAt,
  };
}

async function buildKeywordCommandCenterRowsSkinny(
  workspaceId: string,
  query: KeywordCommandCenterRowsQuery,
  options: { includeLocalSeo?: boolean },
): Promise<KeywordCommandCenterRowsResponse | null> {
  const startedAt = Date.now();
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  // Build the ScoringContext ONCE per request. The SAME config is threaded into
  // the candidate merge-back and the row finalize so both stages score identically
  // per key.
  const valueScoring = buildValueScoringConfig(workspace);
  const filter = query.filter ?? KEYWORD_COMMAND_CENTER_FILTERS.ALL;
  const localVisibilityByKeyword = localVisibilityByFilter(workspace.id, filter, options.includeLocalSeo);
  const activeLocalMarketCount = options.includeLocalSeo
    ? listLocalSeoMarkets(workspace.id).filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length
    : 0;
  const bundle = buildFilteredBundle({ workspace, filter, localVisibility: localVisibilityByKeyword });
  const candidateBundle = filterUsesLocalVisibilityRows(filter)
    ? {
      ...bundle,
      strategy: null,
      pageMap: [],
      contentGaps: [],
      keywordGaps: [],
      trackedKeywords: [],
      latestRanks: [],
      feedback: new Map<string, FeedbackRow>(),
    }
    : bundle;
  const pageSelection = rowCandidateKeysForQuery(candidateBundle, localVisibilityByKeyword, query, valueScoring);
  const pagedBundle = filterBundleToKeys(bundle, pageSelection.keys);
  const pagedLocalVisibility = filterMapByKeys(localVisibilityByKeyword, pageSelection.keys);
  const lostVisibilityKeys = safeLostVisibilityKeys(workspace.id);
  const rows = new Map<string, DraftRow>();
  await populateDraftRows(rows, pagedBundle);
  ensureLocalVisibilityRows(rows, pagedLocalVisibility);
  const finalized = finalizeDraftRows(rows, {
    workspaceId: workspace.id,
    localVisibilityByKeyword: pagedLocalVisibility,
    activeLocalMarketCount,
    lostVisibilityKeys,
    valueScoring,
  });
  const filtered = finalized.rows
    .filter(row => matchesFilter(row, filter))
    .filter(row => matchesSearch(row, query.search))
    .sort(sortRowsForQuery(query.sort, query.direction));

  log.info({
    workspaceId,
    mode: 'rows-skinny',
    filter,
    sourceKeys: bundle.keys?.size ?? null,
    pagedKeys: pageSelection.keys.size,
    rowCount: filtered.length,
    rowsBeforeFilter: finalized.rows.length,
    rowsDropped: finalized.rows.length - filtered.length,
    totalRows: pageSelection.totalRows,
    totalMs: Date.now() - startedAt,
    finalHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'keyword command center rows built');

  return {
    rows: filtered.map(stripRowForList),
    pageInfo: {
      page: pageSelection.page,
      pageSize: pageSelection.pageSize,
      totalRows: pageSelection.totalRows,
      totalPages: pageSelection.totalPages,
      hasNextPage: pageSelection.page < pageSelection.totalPages,
      hasPreviousPage: pageSelection.page > 1,
    },
    generatedAt: workspace.keywordStrategy?.generatedAt ?? null,
  };
}

export async function buildKeywordCommandCenterRows(
  workspaceId: string,
  query: KeywordCommandCenterRowsQuery = {},
  options: { includeLocalSeo?: boolean } = {},
): Promise<KeywordCommandCenterRowsResponse | null> {
  const filter = query.filter ?? KEYWORD_COMMAND_CENTER_FILTERS.ALL;
  if (filterNeedsLocalCandidates(filter)) {
    return buildKeywordCommandCenterRowsViaModel(workspaceId, query, options);
  }
  return buildKeywordCommandCenterRowsSkinny(workspaceId, query, options);
}

export async function buildKeywordCommandCenterDetail(
  workspaceId: string,
  keyword: string,
  options: { includeLocalSeo?: boolean } = {},
): Promise<KeywordCommandCenterDetailResponse | null> {
  const startedAt = Date.now();
  const normalized = keywordComparisonKey(keyword);
  if (!normalized) return null;
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const pageMap = listPageKeywordsLite(workspace.id).filter(page => pageMatchesKeyword(page, normalized));
  // contentGaps + keywordGaps via the single assembler (#2), filtered to the
  // requested keyword; pageMap keeps the Lite page_keywords path above.
  const detailAssembled = assembleStoredKeywordStrategy(workspace.id);
  // F2 fix: gate the discovery gaps (Tier-1 + Tier-2) BEFORE narrowing to the
  // requested keyword, so /detail on a junk gap keyword finds no base source and
  // returns null — consistent with the gated rows/summary universe.
  const gatedDetailGaps = gateDiscoveryGaps({
    contentGaps: detailAssembled?.contentGaps ?? [],
    keywordGaps: detailAssembled?.keywordGaps ?? [],
  });
  const contentGaps = gatedDetailGaps.contentGaps.filter(gap => keywordComparisonKey(gap.targetKeyword) === normalized);
  const keywordGaps = gatedDetailGaps.keywordGaps.filter(gap => keywordComparisonKey(gap.keyword) === normalized);
  // Wave 3d-i/3d-ii: merge sourceGapKey + strategyOwned back from the table read
  // (getTrackedKeywords strips them) so the admin detail drawer exposes accurate
  // provenance, ownership, and protected-state UI. Read-time inference retired.
  const trackedKeywords = mergeTrackedKeywordProvenance(
    workspace.id,
    getTrackedKeywords(workspace.id, { includeInactive: true }),
  ).filter(entry => keywordComparisonKey(entry.query) === normalized);
  // Load all ranks for variant aggregation — populateDraftRows uses variantParentMap to
  // cluster GSC query variants (e.g. "teeth whitening san antonio") under their canonical
  // keyword. Filtering to exact matches here would prevent variant metrics from rolling up.
  // Use the filtered set only for the hasBaseSource check below.
  const allLatestRanks = getLatestSnapshotRanks(workspace.id);
  const latestRanks = allLatestRanks.filter(rank => keywordComparisonKey(rank.query) === normalized);
  const feedback = filterMapByKeys(readFeedback(workspace.id), new Set([normalized]));
  const lostVisibilityRows = safeLostVisibilityRows(workspace.id).filter(row => keywordComparisonKey(row.query) === normalized);
  // #19b: resolve siteKeywordMetrics table-first (blob fallback) before filtering.
  const strategy = filterStrategyForSingleKeyword(
    withResolvedSiteKeywordMetrics(workspace.id, workspace.keywordStrategy),
    normalized,
  );
  const localVisibility = options.includeLocalSeo
    ? buildLocalSeoKeywordVisibilityForKeyword(workspace.id, normalized)
    : undefined;
  const localVisibilityByKeyword = localVisibility
    ? new Map([[normalized, localVisibility]])
    : new Map<string, LocalSeoKeywordVisibilitySummary>();
  const activeLocalMarketCount = options.includeLocalSeo
    ? listLocalSeoMarkets(workspace.id).filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length
    : 0;
  const hasStrategyKeyword = Boolean((strategy?.siteKeywords?.length ?? 0) > 0 || (strategy?.siteKeywordMetrics?.length ?? 0) > 0);
  const hasLocalVisibility = localVisibilityByKeyword.has(normalized);
  const hasBaseSource = hasStrategyKeyword
    || pageMap.length > 0
    || contentGaps.length > 0
    || keywordGaps.length > 0
    || trackedKeywords.length > 0
    || latestRanks.length > 0
    || feedback.size > 0
    || lostVisibilityRows.length > 0
    || hasLocalVisibility;
  if (
    !hasBaseSource
  ) {
    return null;
  }
  const rows = new Map<string, DraftRow>();
  await populateDraftRows(rows, {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    strategy,
    pageMap,
    contentGaps,
    keywordGaps,
    trackedKeywords,
    latestRanks: allLatestRanks,
    feedback,
    lostVisibilityRows,
    includeStrategyUx: true,
    includeWorkspaceIntelligence: false,
  });
  ensureLocalVisibilityRows(rows, localVisibilityByKeyword);
  const row = rows.get(normalized)
    ? finalizeDraftRow(rows.get(normalized)!, {
      workspaceId: workspace.id,
      localVisibilityByKeyword,
      activeLocalMarketCount,
      lostVisibilityKeys: safeLostVisibilityKeys(workspace.id),
      // P1 dark-loop fix: the rows/model path (line ~1645) passes valueScoring so
      // finalizeDraftRow computes valueReasons, but the detail path omitted it —
      // KeywordDetailDrawer renders row.valueReasons, so the value-first reason chips
      // were silently absent in the admin drawer. Pass the same per-request config.
      valueScoring: buildValueScoringConfig(workspace),
    })
    : null;
  if (!row) return null;
  // ── W5.1: read-back outcome verdict for the drawer detail panel ───────────────
  // recordKeywordTrackingAction records every track/promote/add under
  // STRATEGY_PAGE_KEYWORD_SOURCE_TYPE + strategyPageKeywordSourceId(pagePath, keyword).
  // Join the scored outcome back so the drawer can show baseline→current position +
  // verdict. ONE indexed batch read per request (workspace-scoped); the source-id
  // exact match is tried for every candidate page path (the keyword's pageMap pages
  // and the tracked-row page path), then a keyword fallback. Read-only — never
  // mutates outcome data. Failure degrades to no chip, never blocks the drawer.
  let outcome: OutcomeReadback | undefined;
  try {
    const readbacks = getScoredOutcomeReadbacks(workspace.id);
    if (readbacks.bySource.size > 0 || readbacks.byKeyword.size > 0) {
      const candidatePaths = new Set<string>();
      for (const page of pageMap) if (page.pagePath) candidatePaths.add(page.pagePath);
      if (row.tracking.pagePath) candidatePaths.add(row.tracking.pagePath);
      for (const path of candidatePaths) {
        const key = `${STRATEGY_PAGE_KEYWORD_SOURCE_TYPE}::${strategyPageKeywordSourceId(path, row.keyword)}`;
        const hit = readbacks.bySource.get(key);
        if (hit) { outcome = hit; break; }
      }
      // Source recorded with no page path → keyword-keyed fallback.
      if (!outcome) outcome = readbacks.byKeyword.get(row.keyword.trim().toLowerCase());
    }
  } catch (err) {
    log.debug({ err, workspaceId: workspace.id, keyword: normalized }, 'Outcome read-back unavailable for KCC detail');
  }
  log.info({
    workspaceId,
    mode: 'detail-skinny',
    keyword: normalized,
    totalMs: Date.now() - startedAt,
    finalHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'keyword command center detail built');
  return {
    row,
    generatedAt: workspace.keywordStrategy?.generatedAt ?? null,
    outcome,
  };
}

function canModifyProtected(keyword: TrackedKeyword | undefined, force?: boolean): { ok: true } | { ok: false; reason: string } {
  const reason = protectedReason(keyword);
  if (!reason || force) return { ok: true };
  return { ok: false, reason: `${reason} requires explicit confirmation before this action.` };
}

function trackedSourceForMerge(existing: TrackedKeyword, options: AddTrackedKeywordOptions, preferSource: boolean): TrackedKeyword['source'] {
  const existingSource = existing.source ?? TRACKED_KEYWORD_SOURCE.UNKNOWN;
  const existingStatus = existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE;
  const nextStatus = options.status ?? existingStatus;
  if (protectedReason(existing) && !preferSource) return existingSource;
  if (preferSource && options.source && !protectedReason(existing)) return options.source;
  if (existingStatus !== TRACKED_KEYWORD_STATUS.ACTIVE && nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE) {
    return options.source ?? existingSource;
  }
  if (existingSource === TRACKED_KEYWORD_SOURCE.UNKNOWN) return options.source ?? existingSource;
  return existingSource;
}

function upsertTrackedKeywordByKey(
  workspaceId: string,
  keyword: string,
  options: AddTrackedKeywordOptions,
  opts: { preferSource?: boolean } = {},
): TrackedKeyword[] {
  const normalized = keywordComparisonKey(keyword);
  if (!normalized) return getTrackedKeywords(workspaceId, { includeInactive: true });

  return updateTrackedKeywords(workspaceId, keywords => {
    const equivalents = keywords.filter(entry => keywordComparisonKey(entry.query) === normalized);
    const existing = equivalents[0];
    const now = new Date().toISOString();
    const next = keywords.filter(entry => keywordComparisonKey(entry.query) !== normalized);

    if (existing) {
      const nextStatus = options.status ?? existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE;
      const definedOptions = Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
      ) as AddTrackedKeywordOptions;
      next.push({
        ...existing,
        ...definedOptions,
        query: existing.query,
        pinned: equivalents.some(entry => entry.pinned) || Boolean(options.pinned),
        addedAt: existing.addedAt || now,
        status: nextStatus,
        source: trackedSourceForMerge(existing, options, Boolean(opts.preferSource)),
        replacedBy: nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE ? undefined : definedOptions.replacedBy ?? existing.replacedBy,
        deprecatedAt: nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE ? undefined : definedOptions.deprecatedAt ?? existing.deprecatedAt,
      });
      return next;
    }

    next.push({
      query: keyword.trim(),
      pinned: Boolean(options.pinned),
      addedAt: now,
      source: options.source ?? TRACKED_KEYWORD_SOURCE.MANUAL,
      status: options.status ?? TRACKED_KEYWORD_STATUS.ACTIVE,
      pagePath: options.pagePath,
      pageTitle: options.pageTitle,
      strategyGeneratedAt: options.strategyGeneratedAt,
      lastStrategySeenAt: options.lastStrategySeenAt,
      intent: options.intent,
      volume: options.volume,
      difficulty: options.difficulty,
      cpc: options.cpc,
      authorityPosture: options.authorityPosture,
      baselinePosition: options.baselinePosition,
      baselineClicks: options.baselineClicks,
      baselineImpressions: options.baselineImpressions,
      replacedBy: options.replacedBy,
      deprecatedAt: options.deprecatedAt,
    });
    return next;
  });
}

function retireTrackedKeyword(workspaceId: string, keyword: string, status: typeof TRACKED_KEYWORD_STATUS.PAUSED | typeof TRACKED_KEYWORD_STATUS.DEPRECATED): TrackedKeyword[] {
  const normalized = keywordComparisonKey(keyword);
  const now = new Date().toISOString();
  return updateTrackedKeywords(workspaceId, keywords => keywords.map(entry => {
    if (keywordComparisonKey(entry.query) !== normalized) return entry;
    return {
      ...entry,
      status,
      deprecatedAt: status === TRACKED_KEYWORD_STATUS.DEPRECATED ? now : entry.deprecatedAt,
    };
  }));
}

interface ApplyKeywordCommandCenterActionOptions {
  skipBroadcast?: boolean;
  skipActivity?: boolean;
}

function broadcastKeywordCommandCenterAction(
  workspaceId: string,
  request: Pick<KeywordCommandCenterActionRequest, 'action'>,
  payload: Record<string, unknown>,
): void {
  if (
    request.action === KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY
    || request.action === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE
    || request.action === KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE
  ) {
    broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_UPDATED, payload);
    broadcastToWorkspace(workspaceId, WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED, {
      workspaceId,
      reason: 'keyword_command_center',
      updatedAt: payload.updatedAt,
    });
  }
  broadcastToWorkspace(workspaceId, WS_EVENTS.RANK_TRACKING_UPDATED, payload);
}

function applyKeywordCommandCenterActionInternal(
  workspaceId: string,
  request: KeywordCommandCenterActionRequest,
  options: ApplyKeywordCommandCenterActionOptions = {},
): KeywordCommandCenterActionResult {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  const keyword = keywordComparisonKey(request.keyword);
  if (!keyword) throw new Error('keyword required');
  const displayKeyword = request.keyword.trim();

  // Resolve from the PROVENANCE-BEARING table read (listTrackedKeywordRows), NOT
  // getTrackedKeywords — the latter strips `sourceGapKey` via stripUndefinedKeys,
  // which makes protectedReason()'s "Gap-approved keyword" arm unreachable and
  // silently allows unforced retire/decline/pause of client-approved gap keywords.
  // See deleteKeywordHard for the documented trap this mirrors.
  const existing = listTrackedKeywordRows(workspace.id).find(
    entry => keywordComparisonKey(entry.query) === keyword,
  );
  const protectedCheck = canModifyProtected(existing, request.force);
  const now = new Date().toISOString();
  let trackedKeywords: TrackedKeyword[] | undefined;
  let message = '';
  // M3/I1: compute plannedPath before the transaction so it's available for DECLINE cleanup.
  const plannedPath = `/planned/${slugify(displayKeyword) || 'keyword'}`;

  const run = db.transaction(() => {
    switch (request.action) {
      case KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY:
        upsertFeedback(workspace.id, keyword, 'approved', request.reason ?? 'Added to strategy from Keyword Command Center');
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, displayKeyword, {
          source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          pagePath: request.pagePath,
        }, { preferSource: true });
        // M6: write the page_keywords artifact INSIDE the same transaction as the feedback
        // write — if either fails, the whole transaction rolls back (no phantom approved rows).
        {
          const pagePath = request.pagePath?.trim()
            ? request.pagePath.trim()
            : plannedPath;
          // titleOverride: for planned pages use the displayKeyword (human-readable); for
          // explicit paths the helper derives a clean title from the slug.
          const titleOverride = !request.pagePath?.trim() ? displayKeyword : undefined;
          addKeywordToPageInTxn(workspace.id, pagePath, displayKeyword, titleOverride);
        }
        message = `"${keyword}" was added to the strategy operating loop.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE:
      case KEYWORD_COMMAND_CENTER_ACTIONS.TRACK:
        deleteFeedbackByKeywordKey(workspace.id, keyword);
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, displayKeyword, {
          source: request.action === KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE
            ? TRACKED_KEYWORD_SOURCE.RECOMMENDATION
            : TRACKED_KEYWORD_SOURCE.MANUAL,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          pagePath: request.pagePath,
        });
        message = `"${keyword}" is now active in keyword tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING:
        if (!existing) throw new Error('Keyword is not tracked');
        if (!protectedCheck.ok) throw new Error(protectedCheck.reason);
        // protection guard → transition guard → write. `existing.status` (read pre-txn
        // via listTrackedKeywordRows) is the authoritative `from`; an illegal move throws
        // inside the txn so retireTrackedKeyword never runs (no partial write, no broadcast).
        validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE, TRACKED_KEYWORD_STATUS.PAUSED);
        trackedKeywords = retireTrackedKeyword(workspace.id, keyword, TRACKED_KEYWORD_STATUS.PAUSED);
        message = `"${keyword}" was paused from active tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE:
        if (!existing) throw new Error('Keyword is not tracked');
        if (!protectedCheck.ok) throw new Error(protectedCheck.reason);
        validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE, TRACKED_KEYWORD_STATUS.DEPRECATED);
        trackedKeywords = retireTrackedKeyword(workspace.id, keyword, TRACKED_KEYWORD_STATUS.DEPRECATED);
        message = `"${keyword}" was retired from active strategy-owned tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE:
        if (!protectedCheck.ok) throw new Error(protectedCheck.reason);
        upsertFeedback(workspace.id, keyword, 'declined', request.reason ?? 'Declined from Keyword Command Center');
        // Only the tracked-branch of DECLINE changes an existing row's status; guard it.
        if (existing && !protectedReason(existing)) {
          validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE, TRACKED_KEYWORD_STATUS.DEPRECATED);
          trackedKeywords = retireTrackedKeyword(workspace.id, keyword, TRACKED_KEYWORD_STATUS.DEPRECATED);
        }
        message = `"${keyword}" was declined for future strategy consideration.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE:
        // RESTORE revives a paused/deprecated row to active (an insert-style upsert when
        // not tracked). Guard the transition only when restoring an EXISTING inactive row.
        if (existing && (existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE) {
          validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE, TRACKED_KEYWORD_STATUS.ACTIVE);
        }
        deleteFeedbackByKeywordKey(workspace.id, keyword);
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, displayKeyword, {
          source: existing?.source ?? TRACKED_KEYWORD_SOURCE.MANUAL,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          deprecatedAt: undefined,
          replacedBy: undefined,
        });
        message = `"${keyword}" was restored to the active keyword loop.`;
        break;
    }
  });
  run();

  // I1: DECLINE removes the /planned/ artifact so it doesn't persist after the keyword is
  // rejected. Run outside the transaction (deletePageKeyword uses its own run.immediate()).
  if (request.action === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE) {
    deletePageKeyword(workspace.id, plannedPath);
  }

  // A4 (audit #15): Hub track/promote/add-to-strategy actions enter outcome
  // tracking. recordKeywordTrackingAction is idempotent (shares A3's
  // strategy_page_keyword dedup space), captures a keyword-level rank-snapshot
  // baseline when one is fresh, and never fabricates a baseline (FM-2). Runs
  // after the lifecycle transaction so a recording failure cannot roll back the
  // user-visible action, and a failed transaction never records a phantom action.
  if (
    request.action === KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY
    || request.action === KEYWORD_COMMAND_CENTER_ACTIONS.TRACK
    || request.action === KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE
  ) {
    // Outcome tracking is a side-channel: the user-visible action committed above,
    // so a recording failure must log, never surface as an error to the caller.
    try {
      recordKeywordTrackingAction({
        workspaceId: workspace.id,
        keyword: displayKeyword,
        pagePath: request.pagePath ?? existing?.pagePath,
      });
    } catch (err) {
      log.error({ err, workspaceId: workspace.id, keyword: displayKeyword, action: request.action }, 'keyword outcome recording failed — Hub action already committed');
    }
  }

  invalidateIntelligenceCache(workspace.id);
  const payload = { keyword, action: request.action, source: 'keyword_command_center', updatedAt: now };
  if (!options.skipBroadcast) {
    broadcastKeywordCommandCenterAction(workspace.id, request, payload);
  }
  if (!options.skipActivity) {
    addActivity(workspace.id, 'rank_tracking_updated', 'Keyword lifecycle updated', message, {
      keyword,
      action: request.action,
      source: 'keyword_command_center',
    });
  }

  return {
    ok: true,
    action: request.action,
    keyword,
    protectedKeyword: Boolean(protectedReason(existing)),
    message,
    trackedKeywords,
  };
}

export function applyKeywordCommandCenterAction(
  workspaceId: string,
  request: KeywordCommandCenterActionRequest,
): KeywordCommandCenterActionResult {
  return applyKeywordCommandCenterActionInternal(workspaceId, request);
}

/**
 * Narrow hard-delete eligibility predicate (P3-3c). DELIBERATELY NOT a blind
 * `protectedReason` reuse: `protectedReason` flags MANUAL as protected, but MANUAL is
 * the design's delete-eligible class (genuine mistakes the operator wants gone). Hard
 * delete drops rank history too and is irreversible, so it is ONLY allowed for a MANUAL,
 * UNPINNED keyword with NO strategy/client provenance. Everything else (pinned /
 * CLIENT_REQUESTED / a gap-provenanced row via sourceGapKey) must be RETIRED (soft,
 * restorable), never deleted — `force` overrides for the dedicated route.
 */
export function isHardDeleteEligible(
  existing: TrackedKeyword | undefined,
  options: { hasStrategyFeedbackProvenance?: boolean } = {},
): boolean {
  if (!existing) return false;
  if (existing.pinned) return false;
  if (existing.source === TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED) return false;
  if (existing.sourceGapKey) return false;
  if (existing.strategyOwned === true) return false;
  if (options.hasStrategyFeedbackProvenance === true) return false;
  return existing.source === TRACKED_KEYWORD_SOURCE.MANUAL;
}

/**
 * Hard-delete a tracked keyword (P3-3c) — the THIRD, Hub-specific wrapper over
 * `removeTrackedKeyword`. Unlike the bare rank-tracking function (which broadcasts/logs
 * nothing — the rank route wraps it) this wrapper owns BOTH halves of the data-flow
 * contract: RANK_TRACKING_UPDATED action='deleted' broadcast + an activity row. This is a
 * SEPARATE channel from the lifecycle action enum — it is never a default/bulk action and
 * never lands in `KEYWORD_COMMAND_CENTER_ACTIONS`. Ineligible rows (see
 * `isHardDeleteEligible`) throw without `force`. Delete also drops rank history.
 */
export function deleteKeywordHard(
  workspaceId: string,
  keyword: string,
  options: { force?: boolean } = {},
): { ok: true; keyword: string; trackedKeywords: TrackedKeyword[] } {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  const normalized = keywordComparisonKey(keyword);
  if (!normalized) throw new Error('keyword required');

  // Resolve from the PROVENANCE-BEARING table read (listTrackedKeywordRows), NOT
  // getTrackedKeywords — the latter STRIPS sourceGapKey, which would make
  // a gap-provenanced keyword look eligible and silently bypass the retire-not-delete rule.
  const existing = listTrackedKeywordRows(workspace.id).find(
    entry => keywordComparisonKey(entry.query) === normalized,
  );
  if (!existing) throw new Error('Keyword is not tracked');
  const feedback = readFeedback(workspace.id).get(normalized);
  const hasStrategyFeedbackProvenance = feedback?.status === 'approved' || feedback?.status === 'requested';

  if (!options.force && !isHardDeleteEligible(existing, { hasStrategyFeedbackProvenance })) {
    throw new Error('Keyword is not eligible for permanent deletion — retire it instead.');
  }

  const now = new Date().toISOString();
  let trackedKeywords: TrackedKeyword[] = [];
  const run = db.transaction(() => {
    removeTrackedKeyword(workspace.id, normalized);
    deleteKeywordRankHistory(workspace.id, normalized);
    trackedKeywords = getTrackedKeywords(workspace.id, { includeInactive: true });
  });
  run();

  invalidateIntelligenceCache(workspace.id);
  broadcastToWorkspace(workspace.id, WS_EVENTS.RANK_TRACKING_UPDATED, {
    keyword: normalized,
    action: 'deleted',
    source: 'keyword_hub',
    updatedAt: now,
  });
  addActivity(workspace.id, 'rank_tracking_updated', 'Keyword permanently deleted', `"${normalized}" was permanently deleted (rank history dropped).`, {
    keyword: normalized,
    action: 'deleted',
    source: 'keyword_hub',
  });

  return { ok: true, keyword: normalized, trackedKeywords };
}

function bulkActionLabel(action: KeywordCommandCenterBulkActionRequest['action']): string {
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY) return 'added to strategy';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.TRACK) return 'activated in tracking';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING) return 'paused from active tracking';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE) return 'retired from active tracking';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE) return 'declined from future strategy consideration';
  return String(action).replace(/_/g, ' ');
}

export function applyKeywordCommandCenterBulkAction(
  workspaceId: string,
  request: KeywordCommandCenterBulkActionRequest,
): KeywordCommandCenterBulkActionResult {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  if (!Array.isArray(request.keywords) || request.keywords.length === 0) {
    throw new Error('keywords required');
  }

  const uniqueKeywords = Array.from(
    request.keywords.reduce((deduped, rawKeyword) => {
      const keyword = rawKeyword.trim();
      const key = keywordComparisonKey(keyword);
      if (keyword && key && !deduped.has(key)) deduped.set(key, keyword);
      return deduped;
    }, new Map<string, string>()).values(),
  );
  if (uniqueKeywords.length === 0) throw new Error('keywords required');

  const items: KeywordCommandCenterBulkActionItem[] = [];
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (const keyword of uniqueKeywords) {
    try {
      applyKeywordCommandCenterActionInternal(workspace.id, {
        action: request.action,
        keyword,
        reason: request.reason,
        force: request.force,
      }, { skipBroadcast: true, skipActivity: true });
      items.push({ keyword, status: 'applied' });
      applied++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof InvalidTransitionError) {
        // The keyword is already in — or cannot legally leave — the target state
        // (e.g. RETIRE/PAUSE/DECLINE over a selection that already contains a
        // retired keyword: deprecated→deprecated). A bulk action over a mixed
        // selection routinely includes such no-ops; pre-P3 they were silent
        // idempotent successes. The P3 state-machine guard turned them into a
        // spurious "N failed". Classify as a benign skip, never a failure.
        items.push({ keyword, status: 'skipped_noop', error: message });
        skipped++;
      } else if (message.includes('requires explicit confirmation')) {
        items.push({ keyword, status: 'skipped_protected', error: message });
        skipped++;
      } else if (message === 'Keyword is not tracked') {
        items.push({ keyword, status: 'skipped_not_tracked', error: message });
        skipped++;
      } else {
        items.push({ keyword, status: 'error', error: message });
        failed++;
      }
    }
  }

  const actionLabel = bulkActionLabel(request.action);
  const message = `${applied} keyword${applied === 1 ? '' : 's'} ${actionLabel}${skipped > 0 ? `, ${skipped} skipped` : ''}${failed > 0 ? `, ${failed} failed` : ''}`;

  if (applied > 0) {
    addActivity(
      workspace.id,
      'rank_tracking_updated',
      'Keyword lifecycle updated (bulk)',
      message,
      {
        action: request.action,
        applied,
        skipped,
        failed,
        source: 'keyword_command_center_bulk',
      },
    );

    broadcastKeywordCommandCenterAction(workspace.id, request, {
      action: request.action,
      keywords: uniqueKeywords,
      applied,
      skipped,
      failed,
      source: 'keyword_command_center_bulk',
      updatedAt: now,
    });
  }

  return { action: request.action, applied, skipped, failed, items, message };
}
