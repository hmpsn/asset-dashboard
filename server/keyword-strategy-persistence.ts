import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { debouncedStrategyInvalidate, debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from './bridge-infrastructure.js';
import { updateWorkspace } from './workspaces.js';
import { upsertAndCleanPageKeywords, upsertPageKeywordsBatch, listPageKeywords } from './page-keywords.js';
import { listContentGaps, replaceAllContentGaps } from './content-gaps.js';
import { listQuickWins, replaceAllQuickWins } from './quick-wins.js';
import { listKeywordGaps, replaceAllKeywordGaps } from './keyword-gaps.js';
import { listTopicClusters, replaceAllTopicClusters } from './topic-clusters.js';
import { listCannibalizationIssues, replaceAllCannibalizationIssues } from './cannibalization-issues.js';
import { createLogger } from './logger.js';
import db from './db/index.js';
import { recordAction, getActionBySource } from './outcome-tracking.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { addActivity } from './activity-log.js';
import type { KeywordGapEntry } from './seo-data-provider.js';
import type { Workspace, PageKeywordMap, KeywordStrategy, ContentGap, QuickWin, SeoDataStatus } from '../shared/types/workspace.js';
import type { KeywordStrategySeoDataMode, CompetitorKeywordData, QuestionKeywordGroup } from './keyword-strategy-seo-data.js';
import type {
  KeywordStrategyCannibalizationIssue,
  KeywordStrategySiteKeywordMetric,
  KeywordStrategyTopicCluster,
} from './keyword-strategy-enrichment.js';
import type { KeywordStrategySearchData } from './keyword-strategy-search-data.js';
import type { KeywordStrategyPageInfo } from './keyword-strategy-pages.js';
import type { StrategyOutput } from './keyword-strategy-ai-synthesis.js';

const log = createLogger('keyword-strategy:persistence');

export interface PersistKeywordStrategyOptions {
  ws: Workspace;
  strategy: StrategyOutput;
  strategyMode: 'full' | 'incremental';
  pagesToAnalyze: KeywordStrategyPageInfo[];
  siteKeywordMetrics: KeywordStrategySiteKeywordMetric[];
  keywordGaps: KeywordGapEntry[];
  competitorKeywordData: CompetitorKeywordData[];
  topicClusters: KeywordStrategyTopicCluster[];
  cannibalization: KeywordStrategyCannibalizationIssue[];
  questionKeywords: QuestionKeywordGroup[];
  businessContext: string;
  seoDataMode: KeywordStrategySeoDataMode;
  seoDataStatus: SeoDataStatus;
  searchData: Pick<KeywordStrategySearchData, 'deviceBreakdown' | 'countryBreakdown' | 'periodComparison' | 'organicLandingPages' | 'organicOverview'>;
}

export interface PersistKeywordStrategyResult {
  keywordStrategy: KeywordStrategy;
  pageMap: PageKeywordMap[];
}

export function persistKeywordStrategy(options: PersistKeywordStrategyOptions): PersistKeywordStrategyResult {
  const {
    ws,
    strategy,
    strategyMode,
    pagesToAnalyze,
    siteKeywordMetrics,
    keywordGaps,
    competitorKeywordData,
    topicClusters,
    cannibalization,
    questionKeywords,
    businessContext,
    seoDataMode,
    seoDataStatus,
    searchData,
  } = options;
  const {
    deviceBreakdown,
    countryBreakdown,
    periodComparison,
    organicLandingPages,
    organicOverview,
  } = searchData;

  const pageMap = (strategy.pageMap || []) as PageKeywordMap[];
  const newContentGaps = (strategy.contentGaps || []) as ContentGap[];
  const newQuickWins: QuickWin[] = (strategy.quickWins || []).map((quickWin) => ({
    pagePath: quickWin.pagePath,
    currentKeyword: typeof (quickWin as { currentKeyword?: unknown }).currentKeyword === 'string'
      ? (quickWin as { currentKeyword?: string }).currentKeyword
      : undefined,
    action: quickWin.action,
    estimatedImpact: quickWin.estimatedImpact === 'high' || quickWin.estimatedImpact === 'medium' || quickWin.estimatedImpact === 'low'
      ? quickWin.estimatedImpact
      : 'medium',
    rationale: quickWin.rationale ?? quickWin.action,
    roiScore: quickWin.roiScore,
  }));
  const now = new Date().toISOString();
  // Strategy-level data (no pageMap, no contentGaps) goes to workspace JSON blob
  const strategyMeta = { ...strategy } as Partial<KeywordStrategy>;
  delete strategyMeta.pageMap;
  delete strategyMeta.contentGaps;
  delete strategyMeta.quickWins;
  delete strategyMeta.keywordGaps;
  delete strategyMeta.topicClusters;
  delete strategyMeta.cannibalization;
  const keywordStrategy = {
    ...strategyMeta,
    siteKeywordMetrics: siteKeywordMetrics.length > 0 ? siteKeywordMetrics : undefined,
    competitorKeywordData: competitorKeywordData.length > 0 ? competitorKeywordData.slice(0, 150) : undefined,
    questionKeywords: questionKeywords.length > 0 ? questionKeywords : undefined,
    businessContext: businessContext || undefined,
    seoDataMode,
    seoDataStatus,
    // Enriched search signals
    searchSignals: {
      deviceBreakdown: deviceBreakdown.length > 0 ? deviceBreakdown : undefined,
      periodComparison: periodComparison || undefined,
      topCountries: countryBreakdown.length > 0 ? countryBreakdown.slice(0, 5) : undefined,
      organicOverview: organicOverview || undefined,
      organicLandingPages: organicLandingPages.length > 0 ? organicLandingPages.slice(0, 15) : undefined,
    },
    generatedAt: new Date().toISOString(),
  };

  const writeKeywordStrategy = db.transaction(() => {
    // Snapshot previous table-backed state before replacing it, so history can
    // represent the exact prior generation without reading live tables later.
    const prevPageMapForHistory = listPageKeywords(ws.id);
    const prevContentGapsForHistory = listContentGaps(ws.id);
    const prevQuickWinsForHistory = listQuickWins(ws.id);
    const prevKeywordGapsForHistory = listKeywordGaps(ws.id);
    const prevTopicClustersForHistory = listTopicClusters(ws.id);
    const prevCannibalizationForHistory = listCannibalizationIssues(ws.id);

    if (strategyMode === 'full') {
      const stampedMap = pageMap.map((pm) => ({ ...pm, analysisGeneratedAt: now })) as PageKeywordMap[];
      upsertAndCleanPageKeywords(ws.id, stampedMap);
    } else {
      // Only update pages actually re-analyzed in this incremental run.
      const analyzedPaths = new Set(pagesToAnalyze.map(p => p.path));
      const analyzedMappings = pageMap
        .filter((pm) => analyzedPaths.has(pm.pagePath))
        .map((pm) => ({ ...pm, analysisGeneratedAt: now })) as PageKeywordMap[];
      upsertPageKeywordsBatch(ws.id, analyzedMappings);
    }

    replaceAllContentGaps(ws.id, newContentGaps);
    replaceAllQuickWins(ws.id, newQuickWins);
    replaceAllKeywordGaps(ws.id, keywordGaps);
    replaceAllTopicClusters(ws.id, topicClusters);
    replaceAllCannibalizationIssues(ws.id, cannibalization);

    const previousStrategy = ws.keywordStrategy;
    if (previousStrategy?.generatedAt) {
      const previousStrategySnapshot = {
        ...previousStrategy,
        contentGaps: prevContentGapsForHistory,
        quickWins: prevQuickWinsForHistory,
        keywordGaps: prevKeywordGapsForHistory,
        topicClusters: prevTopicClustersForHistory,
        cannibalization: prevCannibalizationForHistory,
      };
      db.prepare(`INSERT INTO strategy_history (workspace_id, strategy_json, page_map_json, generated_at) VALUES (?, ?, ?, ?)`).run( // txn-ok: enclosed by writeKeywordStrategy transaction
        ws.id, JSON.stringify(previousStrategySnapshot), JSON.stringify(prevPageMapForHistory), previousStrategy.generatedAt
      );
      db.prepare(`DELETE FROM strategy_history WHERE workspace_id = ? AND id NOT IN (SELECT id FROM strategy_history WHERE workspace_id = ? ORDER BY generated_at DESC LIMIT 5)`).run(ws.id, ws.id);
    }

    updateWorkspace(ws.id, { keywordStrategy: keywordStrategy as KeywordStrategy });
    addActivity(ws.id, 'strategy_generated', 'Keyword strategy generated', `${pageMap.length} pages mapped with keywords and search intent`);
    try {
      if (!getActionBySource('strategy', ws.id)) recordAction({ // recordAction-ok: ws.id is workspaceId
        workspaceId: ws.id,
        actionType: 'strategy_keyword_added',
        sourceType: 'strategy',
        sourceId: ws.id,
        pageUrl: null,
        targetKeyword: null,
        baselineSnapshot: { captured_at: new Date().toISOString() },
        attribution: 'platform_executed',
      });
    } catch (err) {
      log.warn({ err }, 'Failed to record outcome action for strategy generation');
    }
  });
  writeKeywordStrategy();

  debouncedPageAnalysisInvalidate(ws.id, () => {
    invalidateIntelligenceCache(ws.id);
    invalidateSubCachePrefix(ws.id, 'slice:seoContext');
    invalidateSubCachePrefix(ws.id, 'slice:pageProfile');
  });
  broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_UPDATED, {
    pageCount: pageMap.length,
    siteKeywords: keywordStrategy.siteKeywords?.length || 0,
  });
  invalidateIntelligenceCache(ws.id);
  debouncedStrategyInvalidate(ws.id, () => {
    invalidateIntelligenceCache(ws.id);
    invalidateSubCachePrefix(ws.id, 'slice:seoContext');
  });

  return {
    keywordStrategy: keywordStrategy as KeywordStrategy,
    pageMap,
  };
}
