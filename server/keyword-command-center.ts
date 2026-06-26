import { assembleStoredKeywordStrategy } from './keyword-strategy-assembler.js';
import {
  buildLocalSeoKeywordCandidates,
  buildLocalSeoKeywordVisibilitySummaryByKey,
  buildLocalSeoKeywordVisibilityByKey,
  listLocalSeoMarkets,
} from './local-seo.js';
import { createLogger } from './logger.js';
import { listPageKeywords, listPageKeywordsLite } from './page-keywords.js';
import {
  getLatestSnapshotRanks,
  getTrackedKeywords,
} from './rank-tracking.js';
import { getWorkspace } from './workspaces.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { readFeedback } from './domains/keyword-command-center/feedback-store.js';
import {
  filterMapByKeys,
  filterStrategyForKeys,
  findVariantParentKey,
  parentableVariantKeys,
  restrictPageToKeys,
} from './domains/keyword-command-center/bundle-filters.js';
import {
  LOCAL_CANDIDATE_ROW_LIMIT,
  filterBundleToKeys,
  gateDiscoveryGaps,
  rowCandidateKeysForQuery,
  sourceKeysForRows,
} from './domains/keyword-command-center/candidate-boundary.js';
import {
  mergeTrackedKeywordProvenance,
  withResolvedSiteKeywordMetrics,
} from './domains/keyword-command-center/tracked-keyword-provenance.js';
import {
  buildCounts,
  buildFilters,
  filterNeedsLocalCandidates,
  matchesFilter,
  matchesSearch,
  paginateRows,
  sortRowsForQuery,
  stripRowForList,
} from './domains/keyword-command-center/row-query.js';
import {
  buildValueScoringConfig,
  ensureLocalVisibilityRows,
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
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterRowsQuery,
  type KeywordCommandCenterRowsResponse,
  type KeywordCommandCenterResponse,
} from '../shared/types/keyword-command-center.js';
import { LOCAL_SEO_MARKET_STATUS, LOCAL_SEO_VISIBILITY_POSTURE, type LocalSeoKeywordVisibilitySummary } from '../shared/types/local-seo.js';

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
  buildKeywordCommandCenterSummary,
} from './domains/keyword-command-center/summary-service.js';

export {
  buildKeywordCommandCenterDetail,
} from './domains/keyword-command-center/detail-service.js';

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
