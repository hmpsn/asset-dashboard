import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import {
  KEYWORD_COMMAND_CENTER_FILTERS,
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterRowsQuery,
  type KeywordCommandCenterRowsResponse,
} from '../../../shared/types/keyword-command-center.js';
import { LOCAL_SEO_VISIBILITY_POSTURE, type LocalSeoKeywordVisibilitySummary } from '../../../shared/types/local-seo.js';
import type { PageKeywordMap } from '../../../shared/types/workspace.js';
import { buildLocalSeoKeywordVisibilitySummaryByKey } from '../../local-seo.js';
import { createLogger } from '../../logger.js';
import {
  filterMapByKeys,
  filterStrategyForKeys,
  findVariantParentKey,
  parentableVariantKeys,
  restrictPageToKeys,
} from './bundle-filters.js';
import {
  filterBundleToKeys,
  rowCandidateKeysForQuery,
  sourceKeysForRows,
} from './candidate-boundary.js';
import { buildKeywordCommandCenterModel } from './model-service.js';
import {
  buildValueScoringConfig,
  ensureLocalVisibilityRows,
  finalizeDraftRows,
  populateDraftRows,
  safeLostVisibilityKeys,
} from './read-model.js';
import {
  filterNeedsLocalCandidates,
  matchesFilter,
  matchesSearch,
  paginateRows,
  sortRowsForQuery,
  stripRowForList,
} from './row-query.js';
import type {
  CommandCenterSourceBundle,
  DraftRow,
  FeedbackRow,
} from './types.js';
import {
  buildKeywordCommandCenterSourceSnapshot,
  type KeywordCommandCenterSourceSnapshot,
} from './source-snapshot.js';

const log = createLogger('keyword-command-center');

function localVisibilityByFilter(
  workspaceId: string,
  filter: KeywordCommandCenterFilter,
  includeLocalSeo: boolean | undefined,
  sourceVisibility?: Map<string, LocalSeoKeywordVisibilitySummary>,
): Map<string, LocalSeoKeywordVisibilitySummary> {
  if (!includeLocalSeo) return new Map();
  const visibility = sourceVisibility ?? buildLocalSeoKeywordVisibilitySummaryByKey(workspaceId);
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
  snapshot: KeywordCommandCenterSourceSnapshot;
  filter: KeywordCommandCenterFilter;
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary>;
}): CommandCenterSourceBundle & { keys: Set<string> | null } {
  const { workspace, strategy, pageMap, contentGaps, keywordGaps, trackedKeywords, latestRanks, feedback, lostVisibilityRows } = input.snapshot;
  const variantParentKeys = parentableVariantKeys({
    strategy,
    pageMap,
    contentGaps,
    trackedKeywords,
    feedback,
  });
  const keys = sourceKeysForRows({
    workspaceId: workspace.id,
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
    workspaceId: workspace.id,
    workspaceName: workspace.name,
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
  options: { includeLocalSeo?: boolean; sourceSnapshot?: KeywordCommandCenterSourceSnapshot },
): Promise<KeywordCommandCenterRowsResponse | null> {
  const startedAt = Date.now();
  const snapshot = options.sourceSnapshot ?? buildKeywordCommandCenterSourceSnapshot(workspaceId, {
    includeLocalSeo: options.includeLocalSeo,
  });
  if (!snapshot) return null;
  const { workspace } = snapshot;
  // Build the ScoringContext ONCE per request. The SAME config is threaded into
  // the candidate merge-back and the row finalize so both stages score identically
  // per key.
  const valueScoring = buildValueScoringConfig(workspace);
  const filter = query.filter ?? KEYWORD_COMMAND_CENTER_FILTERS.ALL;
  const localVisibilityByKeyword = localVisibilityByFilter(
    workspace.id,
    filter,
    options.includeLocalSeo,
    snapshot.localVisibilityByKeyword,
  );
  const activeLocalMarketCount = options.includeLocalSeo ? snapshot.activeLocalMarketCount ?? 0 : 0;
  const bundle = buildFilteredBundle({ snapshot, filter, localVisibility: localVisibilityByKeyword });
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
  options: { includeLocalSeo?: boolean; sourceSnapshot?: KeywordCommandCenterSourceSnapshot } = {},
): Promise<KeywordCommandCenterRowsResponse | null> {
  const filter = query.filter ?? KEYWORD_COMMAND_CENTER_FILTERS.ALL;
  if (filterNeedsLocalCandidates(filter)) {
    return buildKeywordCommandCenterRowsViaModel(workspaceId, query, options);
  }
  return buildKeywordCommandCenterRowsSkinny(workspaceId, query, options);
}
