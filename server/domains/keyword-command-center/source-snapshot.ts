import { assembleStoredKeywordStrategy } from '../../keyword-strategy-assembler.js';
import { listLocalSeoMarkets } from '../local-seo/configuration-service.js';
import { buildLocalSeoKeywordVisibilitySummaryByKey } from '../local-seo/snapshot-store.js';
import { listPageKeywordsLite } from '../../page-keywords.js';
import { getLatestSnapshotRanks, getTrackedKeywords } from '../../rank-tracking.js';
import { getWorkspace } from '../../workspaces.js';
import { gateDiscoveryGaps } from './candidate-boundary.js';
import { readFeedback } from './feedback-store.js';
import { safeLostVisibilityCount, safeLostVisibilityRows } from './read-model.js';
import type { CommandCenterSourceBundle, FeedbackRow, LostVisibilityQuery } from './types.js';
import { mergeTrackedKeywordProvenance, withResolvedSiteKeywordMetrics } from './tracked-keyword-provenance.js';
import { LOCAL_SEO_MARKET_STATUS, type LocalSeoKeywordVisibilitySummary } from '../../../shared/types/local-seo.js';
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
}

export function buildKeywordCommandCenterSourceSnapshot(
  workspaceId: string,
  options: { includeLocalSeo?: boolean } = {},
): KeywordCommandCenterSourceSnapshot | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  const assembled = assembleStoredKeywordStrategy(workspace.id);
  const { contentGaps, keywordGaps } = gateDiscoveryGaps({
    contentGaps: assembled?.contentGaps ?? [],
    keywordGaps: assembled?.keywordGaps ?? [],
  });
  const localVisibilityByKeyword = options.includeLocalSeo
    ? buildLocalSeoKeywordVisibilitySummaryByKey(workspace.id)
    : undefined;
  const activeLocalMarketCount = options.includeLocalSeo
    ? listLocalSeoMarkets(workspace.id).filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length
    : undefined;
  return {
    workspace,
    strategy: withResolvedSiteKeywordMetrics(workspace.id, workspace.keywordStrategy),
    pageMap: listPageKeywordsLite(workspace.id),
    contentGaps,
    keywordGaps,
    trackedKeywords: mergeTrackedKeywordProvenance(
      workspace.id,
      getTrackedKeywords(workspace.id, { includeInactive: true }),
    ),
    latestRanks: getLatestSnapshotRanks(workspace.id),
    feedback: readFeedback(workspace.id),
    lostVisibilityRows: safeLostVisibilityRows(workspace.id),
    lostVisibilityCount: safeLostVisibilityCount(workspace.id),
    localVisibilityByKeyword,
    activeLocalMarketCount,
  };
}
