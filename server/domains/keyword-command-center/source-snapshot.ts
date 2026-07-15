import { getLocalSeoPosture, listLocalSeoMarkets } from '../local-seo/configuration-service.js';
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
import type { ScoringContext } from '../../scoring/keyword-value-score.js';
import {
  countLocalSeoKeywordCandidatesFromLoadedContext,
  type LocalSeoKeywordCandidateLoadedContext,
} from '../local-seo/candidate-service.js';

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
  localCandidatesCount?: number;
  localCandidateContext?: LocalSeoKeywordCandidateLoadedContext;
  geoLabel?: string;
  trafficValueMonthly?: number | null;
  topicClusters?: import('../../../shared/types/workspace.js').TopicCluster[];
  cannibalization?: import('../../../shared/types/workspace.js').CannibalizationItem[];
  rankFreshness: KeywordRankFreshness;
  scoringContext?: ScoringContext;
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
  options: {
    includeLocalSeo?: boolean;
    includeSummary?: boolean;
    includeScoring?: boolean;
    includeLocalCandidates?: boolean;
  } = {},
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
  const localMarkets = options.includeLocalSeo || options.includeScoring || options.includeLocalCandidates
    ? listLocalSeoMarkets(workspace.id)
    : [];
  const activeLocalMarketCount = options.includeLocalSeo
    ? localMarkets.filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length
    : undefined;
  const primaryMarket = localMarkets.find(market =>
    market.isPrimary
    && market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE
    && market.providerLocationCode != null,
  );
  const trackedKeywords = listTrackedKeywordRows(workspace.id);
  const latestSnapshot = getLatestSnapshotRanksWithDate(workspace.id, { trackedKeywords });
  const lostVisibilityRows = safeLostVisibilityRows(workspace.id);
  const feedback = readFeedback(workspace.id);
  const posture = options.includeLocalSeo || options.includeScoring || options.includeLocalCandidates
    ? getLocalSeoPosture(workspace.id)
    : undefined;
  const localCandidateContext = options.includeLocalSeo || options.includeLocalCandidates
    ? {
        workspace,
        markets: localMarkets,
        trackedKeywords,
        contentGaps: projection.localCandidateContentGaps,
        pageMap: projection.pageMap,
        declinedKeywords: [...feedback.values()]
          .filter(row => row.status === 'declined')
          .map(row => row.keyword),
        settingsPosture: posture,
      }
    : undefined;
  const localCandidatesCount = options.includeLocalSeo
    ? countLocalSeoKeywordCandidatesFromLoadedContext(localCandidateContext!)
    : undefined;
  return {
    workspace,
    strategy: projection.strategy,
    pageMap: projection.pageMap,
    contentGaps,
    keywordGaps,
    trackedKeywords,
    latestRanks: latestSnapshot.ranks,
    feedback,
    lostVisibilityRows,
    lostVisibilityCount: lostVisibilityRows.length,
    localVisibilityByKeyword,
    activeLocalMarketCount,
    localCandidatesCount,
    localCandidateContext,
    geoLabel: primaryMarket
      ? (primaryMarket.stateOrRegion ? `${primaryMarket.city}, ${primaryMarket.stateOrRegion}` : `${primaryMarket.city}, ${primaryMarket.country}`)
      : undefined,
    trafficValueMonthly: projection.trafficValueMonthly,
    topicClusters: projection.topicClusters,
    cannibalization: projection.cannibalization,
    rankFreshness: rankFreshness(latestSnapshot.snapshotDate),
    scoringContext: options.includeScoring ? {
      posture: posture ?? getLocalSeoPosture(workspace.id),
      markets: localMarkets,
      city: workspace.businessProfile?.address?.city?.toLowerCase(),
      state: workspace.businessProfile?.address?.state?.toLowerCase(),
    } : undefined,
  };
}
