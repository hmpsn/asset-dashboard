import type { CannibalizationItem, ContentGap, KeywordGapItem, KeywordStrategy, PageKeywordMap, TopicCluster } from '../../../shared/types/workspace.js';
import { listCannibalizationIssues } from '../../cannibalization-issues.js';
import { listContentGaps } from '../../content-gaps.js';
import { listKeywordGaps } from '../../keyword-gaps.js';
import { listPageKeywordsLite } from '../../page-keywords.js';
import { keywordDollarValue } from '../../scoring/keyword-value-money.js';
import { resolveSiteKeywordMetrics } from '../../site-keyword-metrics.js';
import { listTopicClusters } from '../../topic-clusters.js';
import type { Workspace } from '../../../shared/types/workspace.js';

/** KCC-local table-first fallback. Keep parity with the strategy assembler without loading its unrelated arrays. */
function tableOrBlob<T>(tableRows: T[], blobRows: T[] | undefined): T[] {
  return tableRows.length > 0 ? tableRows : (blobRows ?? []);
}

export interface KeywordCommandCenterReadProjection {
  strategy: KeywordStrategy | null | undefined;
  pageMap: PageKeywordMap[];
  contentGaps: ContentGap[];
  /** Table-only gaps matching the canonical local-candidate builder's input. */
  localCandidateContentGaps: ContentGap[];
  keywordGaps: KeywordGapItem[];
  trafficValueMonthly?: number | null;
  topicClusters?: TopicCluster[];
  cannibalization?: CannibalizationItem[];
}

function trafficValueFromPages(pages: PageKeywordMap[]): number | null {
  if (!pages.some(page => page.cpc != null)) return null;
  const total = pages.reduce((sum, page) => sum + keywordDollarValue({
    clicks: page.clicks ?? 0,
    cpc: page.cpc ?? 0,
  }).currentMonthly, 0);
  return Math.round(total * 100) / 100;
}

/**
 * Read only the normalized sources the KCC consumes. Unlike the generic strategy
 * assembler this deliberately skips quick wins and all full page-analysis JSON.
 */
export function buildKeywordCommandCenterReadProjection(
  workspace: Workspace,
  options: { includeSummary?: boolean } = {},
): KeywordCommandCenterReadProjection {
  const strategyBlob = workspace.keywordStrategy;
  const pageMap = listPageKeywordsLite(workspace.id);
  const localCandidateContentGaps = listContentGaps(workspace.id);
  const contentGaps = tableOrBlob(localCandidateContentGaps, strategyBlob?.contentGaps);
  const keywordGaps = tableOrBlob(listKeywordGaps(workspace.id), strategyBlob?.keywordGaps);
  const siteKeywordMetrics = resolveSiteKeywordMetrics(workspace.id);
  const strategy = strategyBlob
    ? { ...strategyBlob, siteKeywordMetrics: siteKeywordMetrics.length > 0 ? siteKeywordMetrics : undefined }
    : strategyBlob;

  if (!options.includeSummary) {
    return { strategy, pageMap, contentGaps, localCandidateContentGaps, keywordGaps };
  }

  const valuePages = pageMap.length > 0 ? pageMap : (strategyBlob?.pageMap ?? []);
  return {
    strategy,
    pageMap,
    contentGaps,
    localCandidateContentGaps,
    keywordGaps,
    trafficValueMonthly: trafficValueFromPages(valuePages),
    topicClusters: tableOrBlob(listTopicClusters(workspace.id), strategyBlob?.topicClusters),
    cannibalization: tableOrBlob(listCannibalizationIssues(workspace.id), strategyBlob?.cannibalization),
  };
}
