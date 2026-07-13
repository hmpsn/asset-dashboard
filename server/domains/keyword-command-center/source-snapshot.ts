import { listLocalSeoMarkets } from '../local-seo/configuration-service.js';
import { buildLocalSeoKeywordVisibilitySummaryByKey } from '../local-seo/snapshot-store.js';
import { getLatestSnapshotRanksWithDate } from '../../rank-tracking.js';
import { listTrackedKeywordRows } from '../../tracked-keywords-store.js';
import { getWorkspace } from '../../workspaces.js';
import { gateDiscoveryGaps } from './candidate-boundary.js';
import { readFeedback } from './feedback-store.js';
import { safeLostVisibilityRows } from './read-model.js';
import type { CommandCenterSourceBundle, FeedbackRow, LostVisibilityQuery } from './types.js';
import { buildKeywordCommandCenterReadProjection } from './read-projection.js';
import { LOCAL_SEO_MARKET_STATUS, type LocalSeoKeywordVisibilitySummary } from '../../../shared/types/local-seo.js';
import { KEYWORD_RANK_FRESHNESS_STATUS, type KeywordRankFreshness } from '../../../shared/types/keyword-command-center.js';
import type { Workspace } from '../../../shared/types/workspace.js';
import type { LatestRank, TrackedKeyword } from '../../../shared/types/rank-tracking.js';

export interface KeywordCommandCenterSourceSnapshot {
  workspace: Workspace;
  strategy: CommandCenterSourceBundle['strategy'];
  pageMap: CommandCenterSourceBundle['pageMap'];
  contentGaps: CommandCenterSourceBundle['contentGaps'];
  keywordGaps: CommandCenterSourceBundle['keywordGaps'];
  trackedKeywords: TrackedKeyword[];
  latestRanks: LatestRank[];
  feedback: Map<string, FeedbackRow>;
  lostVisibilityRows: LostVisibilityQuery[];
  lostVisibilityCount: number;
  localVisibilityByKeyword?: Map<string, LocalSeoKeywordVisibilitySummary>;
  activeLocalMarketCount?: number;
  geoLabel?: string;
  trafficValueMonthly?: number | null;
  topicClusters?: import('../../../shared/types/workspace.js').TopicCluster[];
  cannibalization?: import('../../../shared/types/workspace.js').CannibalizationItem[];
  rankFreshness: KeywordRankFreshness;
}

export const KCC_RANK_FRESHNESS_MAX_AGE_DAYS = 14;

function rankFreshness(snapshotDate: string | null, now = Date.now()): KeywordRankFreshness {
  if (!snapshotDate) return { snapshotDate: null, ageDays: null, status: KEYWORD_RANK_FRESHNESS_STATUS.MISSING };
  const ageDays = Math.max(0, Math.floor((now - new Date(snapshotDate).getTime()) / 86_400_000));
  return {
    snapshotDate,
    ageDays,
    status: ageDays > KCC_RANK_FRESHNESS_MAX_AGE_DAYS
      ? KEYWORD_RANK_FRESHNESS_STATUS.STALE
      : KEYWORD_RANK_FRESHNESS_STATUS.FRESH,
  };
}

export function buildKeywordCommandCenterSourceSnapshot(
  workspaceId: string,
  options: { includeLocalSeo?: boolean; includeSummary?: boolean } = {},
): KeywordCommandCenterSourceSnapshot | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const projection = buildKeywordCommandCenterReadProjection(workspace, {
    includeSummary: options.includeSummary,
  });
  const { contentGaps, keywordGaps } = gateDiscoveryGaps({
    contentGaps: projection.contentGaps,
    keywordGaps: projection.keywordGaps,
  });
  const localVisibilityByKeyword = options.includeLocalSeo
    ? buildLocalSeoKeywordVisibilitySummaryByKey(workspace.id)
    : undefined;
  const localMarkets = options.includeLocalSeo ? listLocalSeoMarkets(workspace.id) : [];
  const activeLocalMarketCount = options.includeLocalSeo
    ? localMarkets.filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length
    : undefined;
  const primaryMarket = localMarkets.find(market => market.isPrimary && market.providerLocationCode != null);
  const latestSnapshot = getLatestSnapshotRanksWithDate(workspace.id);
  const lostVisibilityRows = safeLostVisibilityRows(workspace.id);
  return {
    workspace,
    strategy: projection.strategy,
    pageMap: projection.pageMap,
    contentGaps,
    keywordGaps,
    trackedKeywords: listTrackedKeywordRows(workspace.id),
    latestRanks: latestSnapshot.ranks,
    feedback: readFeedback(workspace.id),
    lostVisibilityRows,
    lostVisibilityCount: lostVisibilityRows.length,
    localVisibilityByKeyword,
    activeLocalMarketCount,
    geoLabel: primaryMarket
      ? (primaryMarket.stateOrRegion ? `${primaryMarket.city}, ${primaryMarket.stateOrRegion}` : `${primaryMarket.city}, ${primaryMarket.country}`)
      : undefined,
    trafficValueMonthly: projection.trafficValueMonthly,
    topicClusters: projection.topicClusters,
    cannibalization: projection.cannibalization,
    rankFreshness: rankFreshness(latestSnapshot.snapshotDate),
  };
}
