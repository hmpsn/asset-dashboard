import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import type { KeywordCommandCenterDetailResponse } from '../../../shared/types/keyword-command-center.js';
import { LOCAL_SEO_MARKET_STATUS, type LocalSeoKeywordVisibilitySummary } from '../../../shared/types/local-seo.js';
import type { OutcomeReadback } from '../../../shared/types/outcome-tracking.js';
import { assembleStoredKeywordStrategy } from '../../keyword-strategy-assembler.js';
import {
  buildLocalSeoKeywordVisibilityForKeyword,
  listLocalSeoMarkets,
} from '../../local-seo.js';
import { createLogger } from '../../logger.js';
import { getScoredOutcomeReadbacks, STRATEGY_PAGE_KEYWORD_SOURCE_TYPE, strategyPageKeywordSourceId } from '../../outcome-tracking.js';
import { listPageKeywordsLite } from '../../page-keywords.js';
import { getLatestSnapshotRanks, getTrackedKeywords } from '../../rank-tracking.js';
import { getWorkspace } from '../../workspaces.js';
import {
  filterMapByKeys,
  filterStrategyForSingleKeyword,
  pageMatchesKeyword,
} from './bundle-filters.js';
import { gateDiscoveryGaps } from './candidate-boundary.js';
import { readFeedback } from './feedback-store.js';
import {
  buildValueScoringConfig,
  ensureLocalVisibilityRows,
  finalizeDraftRow,
  populateDraftRows,
  safeLostVisibilityKeys,
  safeLostVisibilityRows,
} from './read-model.js';
import type { DraftRow } from './types.js';
import { mergeTrackedKeywordProvenance, withResolvedSiteKeywordMetrics } from './tracked-keyword-provenance.js';

const log = createLogger('keyword-command-center');

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
  const row = rows.get(normalized)
    ? finalizeDraftRow(rows.get(normalized)!, {
      workspaceId: workspace.id,
      localVisibilityByKeyword,
      activeLocalMarketCount,
      lostVisibilityKeys: safeLostVisibilityKeys(workspace.id),
      // P1 dark-loop fix: the rows/model path passes valueScoring so
      // finalizeDraftRow computes valueReasons, but the detail path omitted it —
      // KeywordDetailDrawer renders row.valueReasons, so the value-first reason chips
      // were silently absent in the admin drawer. Pass the same per-request config.
      valueScoring: buildValueScoringConfig(workspace),
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
