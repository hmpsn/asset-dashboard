import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { debouncedStrategyInvalidate, debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from './bridge-infrastructure.js';
import { updateWorkspace } from './workspaces.js';
import { upsertAndCleanPageKeywords, upsertPageKeywordsBatch, listPageKeywords } from './page-keywords.js';
import { listContentGaps, replaceAllContentGaps } from './content-gaps.js';
import { createLogger } from './logger.js';
import db from './db/index.js';
import { recordAction, getActionBySource } from './outcome-tracking.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { addActivity } from './activity-log.js';
import type { KeywordGapEntry } from './seo-data-provider.js';
import type { Workspace, PageKeywordMap, KeywordStrategy, ContentGap } from '../shared/types/workspace.js';
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
  // Snapshot previous page map AND content gaps BEFORE replacing (needed for
  // strategy diff). The previous strategy blob no longer holds contentGaps
  // (#365 normalized them out), so we read from the table — those rows
  // represent the previous strategy until replaceAllContentGaps overwrites
  // them below.
  // NOTE: for incremental mode the orchestrator already reads page keywords during discovery,
  // but we re-read here to get the freshest snapshot right before writing.
  const prevPageMapForHistory = listPageKeywords(ws.id);
  const prevContentGapsForHistory = listContentGaps(ws.id);

  // Save pageMap to dedicated table.
  // Full mode: upsert + delete stale rows (clean replacement).
  // Incremental mode: only upsert analyzed pages (preserve existing rows for fresh pages).
  // Both modes stamp analysisGeneratedAt = now so incremental freshness checks work correctly
  // on the next run. Without this, analysis_generated_at stays NULL indefinitely and every
  // incremental run re-analyzes everything (COALESCE preserves NULL, not the current time).
  const now = new Date().toISOString();
  if (strategyMode === 'full') {
    const stampedMap = pageMap.map((pm) => ({ ...pm, analysisGeneratedAt: now })) as PageKeywordMap[];
    upsertAndCleanPageKeywords(ws.id, stampedMap);
  } else {
    // Only update the pages that were actually re-analyzed in this incremental run.
    // Pages with fresh analysis_generated_at are left untouched in the DB.
    const analyzedPaths = new Set(pagesToAnalyze.map(p => p.path));
    const analyzedMappings = pageMap
      .filter((pm) => analyzedPaths.has(pm.pagePath))
      .map((pm) => ({ ...pm, analysisGeneratedAt: now })) as PageKeywordMap[];
    upsertPageKeywordsBatch(ws.id, analyzedMappings);
  }
  // Bridge #5: page keywords replaced — invalidate page caches
  debouncedPageAnalysisInvalidate(ws.id, () => {
    invalidateIntelligenceCache(ws.id);
    invalidateSubCachePrefix(ws.id, 'slice:seoContext');
    invalidateSubCachePrefix(ws.id, 'slice:pageProfile');
  });

  // Save contentGaps to dedicated table (replaces any existing rows for this workspace).
  // The blob copy below has contentGaps stripped so the table is the single source of truth.
  replaceAllContentGaps(ws.id, newContentGaps);

  // Strategy-level data (no pageMap, no contentGaps) goes to workspace JSON blob
  const strategyMeta = { ...strategy };
  delete strategyMeta.pageMap;
  delete strategyMeta.contentGaps;
  const keywordStrategy = {
    ...strategyMeta,
    siteKeywordMetrics: siteKeywordMetrics.length > 0 ? siteKeywordMetrics : undefined,
    keywordGaps: keywordGaps.length > 0 ? keywordGaps.slice(0, 30) : undefined,
    competitorKeywordData: competitorKeywordData.length > 0 ? competitorKeywordData.slice(0, 150) : undefined,
    topicClusters: topicClusters.length > 0 ? topicClusters : undefined,
    cannibalization: cannibalization.length > 0 ? cannibalization.slice(0, 20) : undefined,
    questionKeywords: questionKeywords.length > 0 ? questionKeywords : undefined,
    businessContext: businessContext || undefined,
    seoDataMode,
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

  // Save previous strategy to history (keep last 5).
  // Wrapped in db.transaction() so that the INSERT and the prune-DELETE
  // are atomic — without it, an INSERT that succeeds followed by a
  // DELETE that fails would leave the table over-quota and the next
  // generation would re-attempt the same prune on a stale snapshot,
  // potentially corrupting history ordering for the workspace.
  // Capture into a local so the closure inside db.transaction() preserves
  // the narrowed type from the if-guard above (TS can't propagate the
  // narrowing through the closure boundary on its own).
  const previousStrategy = ws.keywordStrategy;
  if (previousStrategy?.generatedAt) {
    // Merge the previous-state contentGaps from the table back into the
    // history snapshot so the diff endpoint can reassemble the full prior
    // strategy without needing to query the table for historical state.
    const previousStrategySnapshot = { ...previousStrategy, contentGaps: prevContentGapsForHistory };
    const previousStrategyJson = JSON.stringify(previousStrategySnapshot);
    const previousGeneratedAt = previousStrategy.generatedAt;
    const saveStrategyHistory = db.transaction(() => {
      db.prepare(`INSERT INTO strategy_history (workspace_id, strategy_json, page_map_json, generated_at) VALUES (?, ?, ?, ?)`).run(
        ws.id, previousStrategyJson, JSON.stringify(prevPageMapForHistory), previousGeneratedAt
      );
      // Prune old entries, keep last 5
      db.prepare(`DELETE FROM strategy_history WHERE workspace_id = ? AND id NOT IN (SELECT id FROM strategy_history WHERE workspace_id = ? ORDER BY generated_at DESC LIMIT 5)`).run(ws.id, ws.id);
    });
    saveStrategyHistory();
  }

  updateWorkspace(ws.id, { keywordStrategy: keywordStrategy as KeywordStrategy });
  addActivity(ws.id, 'strategy_generated', 'Keyword strategy generated', `${pageMap.length} pages mapped with keywords and search intent`);
  broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_UPDATED, {
    pageCount: pageMap.length,
    siteKeywords: keywordStrategy.siteKeywords?.length || 0,
  });
  invalidateIntelligenceCache(ws.id);
  // Bridge #3: strategy updated — debounced intelligence invalidation
  debouncedStrategyInvalidate(ws.id, () => {
    invalidateIntelligenceCache(ws.id);
    invalidateSubCachePrefix(ws.id, 'slice:seoContext');
  });
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

  return {
    keywordStrategy: keywordStrategy as KeywordStrategy,
    pageMap,
  };
}
