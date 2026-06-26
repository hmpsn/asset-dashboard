import { isFeatureEnabled } from './feature-flags.js';
import { assembleStoredKeywordStrategy } from './keyword-strategy-assembler.js';
import {
  buildLocalSeoKeywordCandidates,
  countLocalSeoKeywordCandidates,
  buildLocalSeoKeywordVisibilityForKeyword,
  buildLocalSeoKeywordVisibilitySummaryByKey,
  buildLocalSeoKeywordVisibilityByKey,
  getPrimaryMarketLocationCode,
  listLocalSeoMarkets,
} from './local-seo.js';
import { createLogger } from './logger.js';
import { listPageKeywords, listPageKeywordsLite } from './page-keywords.js';
import { isSuspiciousPlannerGroupedVolume } from './keyword-strategy-helpers.js';
import {
  getLatestSnapshotRanks,
  getTrackedKeywords,
} from './rank-tracking.js';
import { getScoredOutcomeReadbacks, STRATEGY_PAGE_KEYWORD_SOURCE_TYPE, strategyPageKeywordSourceId } from './outcome-tracking.js';
import { getWorkspace } from './workspaces.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { readFeedback } from './domains/keyword-command-center/feedback-store.js';
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
  filterBundleToKeys,
  gateDiscoveryGaps,
  rowCandidateKeysForQuery,
  selectRankEvidence,
  sourceKeysForRows,
  trackedKeywordMatchesFilter,
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
  sortRowsForQuery,
  stripRowForList,
  type SkinnyFilterCounts,
} from './domains/keyword-command-center/row-query.js';
import {
  buildValueScoringConfig,
  ensureLocalVisibilityRows,
  finalizeDraftRow,
  finalizeDraftRows,
  populateDraftRows,
  safeLostVisibilityKeys,
  safeLostVisibilityRows,
} from './domains/keyword-command-center/read-model.js';
import type {
  CommandCenterSourceBundle,
  DraftRow,
  FeedbackRow,
} from './domains/keyword-command-center/types.js';
import type { PageKeywordMap, Workspace } from '../shared/types/workspace.js';
import {
  KEYWORD_COMMAND_CENTER_FILTERS,
  type KeywordCommandCenterCounts,
  type KeywordCommandCenterDetailResponse,
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterRowsQuery,
  type KeywordCommandCenterRowsResponse,
  type KeywordCommandCenterResponse,
  type KeywordCommandCenterSummaryResponse,
} from '../shared/types/keyword-command-center.js';
import { LOCAL_SEO_MARKET_STATUS, LOCAL_SEO_VISIBILITY_POSTURE, type LocalSeoKeywordVisibilitySummary } from '../shared/types/local-seo.js';
import {
  TRACKED_KEYWORD_STATUS,
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

export {
  __candidateRowMetricParityForTest,
} from './domains/keyword-command-center/read-model.js';

export {
  applyKeywordCommandCenterAction,
  applyKeywordCommandCenterBulkAction,
  deleteKeywordHard,
  isHardDeleteEligible,
} from './domains/keyword-command-center/action-service.js';

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
