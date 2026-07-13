import {
  keywordComparisonKey,
  keywordIdentityKeyV2,
} from '../../../shared/keyword-normalization.js';
import type { KeywordCommandCenterDetailResponse } from '../../../shared/types/keyword-command-center.js';
import { LOCAL_SEO_MARKET_STATUS, type LocalSeoKeywordVisibilitySummary } from '../../../shared/types/local-seo.js';
import type { OutcomeReadback } from '../../../shared/types/outcome-tracking.js';
import { buildLocalSeoKeywordVisibilityForKeyword } from '../local-seo/snapshot-store.js';
import { createLogger } from '../../logger.js';
import { getScoredOutcomeReadbacks, STRATEGY_PAGE_KEYWORD_SOURCE_TYPE, strategyPageKeywordSourceId } from '../../outcome-tracking.js';
import { listPublishedPostPagePaths } from '../../content-posts-db.js';
import {
  buildValueScoringConfig,
  ensureLocalVisibilityRows,
  finalizeDraftRow,
  populateDraftRows,
} from './read-model.js';
import type { DraftRow } from './types.js';
import {
  buildKeywordCommandCenterSourceSnapshot,
  type KeywordCommandCenterSourceSnapshot,
} from './source-snapshot.js';

const log = createLogger('keyword-command-center');

function selectExactIdentity<T>(items: T[], query: string, value: (item: T) => string): T[] {
  const queryV2 = keywordIdentityKeyV2(query);
  const exact = queryV2
    ? items.filter(item => keywordIdentityKeyV2(value(item)) === queryV2)
    : [];
  if (exact.length > 0) return exact;
  const queryV1 = keywordComparisonKey(query);
  return items.filter(item => keywordComparisonKey(value(item)) === queryV1);
}

export async function buildKeywordCommandCenterDetail(
  workspaceId: string,
  keyword: string,
  options: { includeLocalSeo?: boolean; sourceSnapshot?: KeywordCommandCenterSourceSnapshot } = {},
): Promise<KeywordCommandCenterDetailResponse | null> {
  const startedAt = Date.now();
  const normalized = keywordComparisonKey(keyword);
  const identityV2 = keywordIdentityKeyV2(keyword);
  if (!normalized || !identityV2) return null;
  const snapshot = options.sourceSnapshot ?? buildKeywordCommandCenterSourceSnapshot(workspaceId, {
    includeScoring: true,
  });
  if (!snapshot) return null;
  const { workspace } = snapshot;
  const pageKeywordEntries = snapshot.pageMap.flatMap(page =>
    [page.primaryKeyword, ...(page.secondaryKeywords ?? [])].map(pageKeyword => ({ page, pageKeyword })),
  );
  const selectedPageEntries = selectExactIdentity(pageKeywordEntries, keyword, entry => entry.pageKeyword);
  const pageMap = [...new Set(selectedPageEntries.map(entry => entry.page))].map(page => {
    const selected = selectedPageEntries
      .filter(entry => entry.page === page)
      .map(entry => entry.pageKeyword);
    const primarySelected = selected.includes(page.primaryKeyword);
    if (primarySelected) {
      return { ...page, secondaryKeywords: (page.secondaryKeywords ?? []).filter(item => selected.includes(item)) };
    }
    const [primaryKeyword, ...secondaryKeywords] = selected;
    return { ...page, primaryKeyword, secondaryKeywords };
  });
  const contentGaps = selectExactIdentity(snapshot.contentGaps, keyword, gap => gap.targetKeyword);
  const keywordGaps = selectExactIdentity(snapshot.keywordGaps, keyword, gap => gap.keyword);
  const trackedKeywords = selectExactIdentity(snapshot.trackedKeywords, keyword, entry => entry.query);
  // Load all ranks for variant aggregation — populateDraftRows uses variantParentMap to
  // cluster GSC query variants (e.g. "teeth whitening san antonio") under their canonical
  // keyword. Filtering to exact matches here would prevent variant metrics from rolling up.
  // Use the filtered set only for the hasBaseSource check below.
  const allLatestRanks = snapshot.latestRanks;
  const latestRanks = selectExactIdentity(allLatestRanks, keyword, rank => rank.query);
  const selectedFeedback = selectExactIdentity([...snapshot.feedback.values()], keyword, row => row.keyword);
  const feedback = new Map(selectedFeedback.map(row => [
    row.keyword_v2 ?? row.keyword_v1 ?? keywordComparisonKey(row.keyword),
    row,
  ] as const));
  const lostVisibilityRows = selectExactIdentity(snapshot.lostVisibilityRows, keyword, row => row.query);
  // #19b: resolve siteKeywordMetrics table-first (blob fallback) before filtering.
  const strategy = snapshot.strategy
    ? {
      ...snapshot.strategy,
      siteKeywords: selectExactIdentity(snapshot.strategy.siteKeywords ?? [], keyword, item => item),
      siteKeywordMetrics: selectExactIdentity(snapshot.strategy.siteKeywordMetrics ?? [], keyword, item => item.keyword),
    }
    : snapshot.strategy;
  const localVisibility = options.includeLocalSeo
    ? buildLocalSeoKeywordVisibilityForKeyword(workspace.id, keyword)
    : undefined;
  const localVisibilityByKeyword = localVisibility
    ? new Map([[identityV2, localVisibility]])
    : new Map<string, LocalSeoKeywordVisibilitySummary>();
  const activeLocalMarketCount = options.includeLocalSeo
    ? snapshot.scoringContext?.markets.filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length ?? 0
    : 0;
  const hasStrategyKeyword = Boolean((strategy?.siteKeywords?.length ?? 0) > 0 || (strategy?.siteKeywordMetrics?.length ?? 0) > 0);
  const hasLocalVisibility = localVisibilityByKeyword.has(identityV2);
  const hasBaseSource = hasStrategyKeyword
    || pageMap.length > 0
    || contentGaps.length > 0
    || keywordGaps.length > 0
    || trackedKeywords.length > 0
    || latestRanks.length > 0
    || feedback.size > 0
    || lostVisibilityRows.length > 0
    || hasLocalVisibility;
  if (!hasBaseSource) {
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
  const publishedPagePaths = listPublishedPostPagePaths(workspace.id);
  const detailRow = [...new Set(rows.values())].find(item => keywordIdentityKeyV2(item.keyword) === identityV2)
    ?? [...new Set(rows.values())].find(item => keywordComparisonKey(item.keyword) === normalized);
  const row = detailRow
    ? finalizeDraftRow(detailRow, {
      workspaceId: workspace.id,
      localVisibilityByKeyword,
      activeLocalMarketCount,
      lostVisibilityKeys: new Set(snapshot.lostVisibilityRows.map(item => keywordComparisonKey(item.query)).filter(Boolean)),
      publishedPagePaths,
      // P1 dark-loop fix: the rows/model path passes valueScoring so
      // finalizeDraftRow computes valueReasons, but the detail path omitted it —
      // KeywordDetailDrawer renders row.valueReasons, so the value-first reason chips
      // were silently absent in the admin drawer. Pass the same per-request config.
      valueScoring: snapshot.scoringContext
        ? { on: true, ctx: snapshot.scoringContext }
        : buildValueScoringConfig(workspace),
    })
    : null;
  if (!row) return null;

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
