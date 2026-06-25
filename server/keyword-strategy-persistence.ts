import { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';
import { debouncedStrategyInvalidate, debouncedPageAnalysisInvalidate, invalidateSubCachePrefix } from './bridge-infrastructure.js';
import { updateWorkspace } from './workspaces.js';
import { upsertAndCleanPageKeywords, upsertPageKeywordsBatch, listPageKeywords } from './page-keywords.js';
import { listContentGaps, replaceAllContentGaps } from './content-gaps.js';
import { listQuickWins, replaceAllQuickWins } from './quick-wins.js';
import { listKeywordGaps, replaceAllKeywordGaps } from './keyword-gaps.js';
import { listTopicClusters, replaceAllTopicClusters } from './topic-clusters.js';
import { listCannibalizationIssues, replaceAllCannibalizationIssues } from './cannibalization-issues.js';
import { replaceAllSiteKeywordMetrics } from './site-keyword-metrics.js';
import { reconcileStrategyKeywordSet } from './domains/strategy/managed-keyword-set.js';
import db from './db/index.js';
import {
  recordAction,
  getActionByWorkspaceAndSource,
  STRATEGY_PAGE_KEYWORD_SOURCE_TYPE,
  strategyPageKeywordSourceId,
} from './outcome-tracking.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { addActivity } from './activity-log.js';
import { normalizePageUrl } from './helpers.js';
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

export interface PersistKeywordStrategyOptions {
  ws: Workspace;
  strategy: StrategyOutput;
  strategyMode: 'full' | 'incremental';
  pagesToAnalyze: KeywordStrategyPageInfo[];
  extraPagePaths?: string[];
  removedPagePaths?: string[];
  siteKeywordMetrics: KeywordStrategySiteKeywordMetric[];
  keywordGaps: KeywordGapEntry[];
  competitorKeywordData: CompetitorKeywordData[];
  topicClusters: KeywordStrategyTopicCluster[];
  cannibalization: KeywordStrategyCannibalizationIssue[];
  questionKeywords: QuestionKeywordGroup[];
  businessContext: string;
  seoDataMode: KeywordStrategySeoDataMode;
  maxPages?: number;
  seoDataStatus: SeoDataStatus;
  searchData: Pick<KeywordStrategySearchData, 'deviceBreakdown' | 'countryBreakdown' | 'periodComparison' | 'organicLandingPages' | 'organicOverview'>;
}

export interface PersistKeywordStrategyResult {
  keywordStrategy: KeywordStrategy;
  pageMap: PageKeywordMap[];
}

/**
 * Snapshot the prior strategy state into strategy_history (capped to 5 rows), so the "What Changed"
 * (StrategyDiff) boundary moves to this point. Reused by BOTH the AI-regen path and the manual PATCH
 * edit path so human edits don't get misattributed to the last regeneration.
 *
 * MUST be called INSIDE a db.transaction(), and BEFORE the replaceAll/upsert calls clobber the
 * table-backed arrays (callers pass the prior arrays read just before mutating). No-ops when there is
 * no prior `generatedAt` (a table-backed-only workspace with no blob has no boundary to record).
 */
export function snapshotStrategyHistory(
  workspaceId: string,
  previousStrategy: KeywordStrategy | undefined,
  prior: {
    pageMap: ReturnType<typeof listPageKeywords>;
    contentGaps: ReturnType<typeof listContentGaps>;
    quickWins: ReturnType<typeof listQuickWins>;
    keywordGaps: ReturnType<typeof listKeywordGaps>;
    topicClusters: ReturnType<typeof listTopicClusters>;
    cannibalization: ReturnType<typeof listCannibalizationIssues>;
  },
): void {
  if (!previousStrategy?.generatedAt) return;
  const previousStrategySnapshot = {
    ...previousStrategy,
    contentGaps: prior.contentGaps,
    quickWins: prior.quickWins,
    keywordGaps: prior.keywordGaps,
    topicClusters: prior.topicClusters,
    cannibalization: prior.cannibalization,
  };
  db.prepare(`INSERT INTO strategy_history (workspace_id, strategy_json, page_map_json, generated_at) VALUES (?, ?, ?, ?)`).run( // txn-ok: callers (writeKeywordStrategy + PATCH applyPatch) invoke this inside db.transaction()
    workspaceId, JSON.stringify(previousStrategySnapshot), JSON.stringify(prior.pageMap), previousStrategy.generatedAt
  );
  db.prepare(`DELETE FROM strategy_history WHERE workspace_id = ? AND id NOT IN (SELECT id FROM strategy_history WHERE workspace_id = ? ORDER BY generated_at DESC LIMIT 5)`).run(workspaceId, workspaceId); // txn-ok: enclosed by caller's transaction
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
    maxPages,
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
    // siteKeywordMetrics is NOT written to the blob (Wave 3b-ii strip; table-as-truth).
    // It is persisted solely to the site_keyword_metrics table via
    // replaceAllSiteKeywordMetrics below. If `strategyMeta` carries a stale
    // siteKeywordMetrics key forward from a previous blob, drop it so the column
    // never re-acquires the array.
    siteKeywordMetrics: undefined,
    competitorKeywordData: competitorKeywordData.length > 0 ? competitorKeywordData.slice(0, 150) : undefined,
    questionKeywords: questionKeywords.length > 0 ? questionKeywords : undefined,
    businessContext: businessContext || undefined,
    seoDataMode,
    maxPages: maxPages != null ? maxPages : undefined,
    seoDataStatus,
    // Enriched search signals
    searchSignals: {
      deviceBreakdown: deviceBreakdown.length > 0 ? deviceBreakdown : undefined,
      periodComparison: periodComparison || undefined,
      topCountries: countryBreakdown.length > 0 ? countryBreakdown.slice(0, 5) : undefined,
      organicOverview: organicOverview || undefined,
      organicLandingPages: organicLandingPages.length > 0 ? organicLandingPages.slice(0, 15) : undefined,
    },
    generatedAt: now,
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

    // Entries actually persisted in this run — the candidate set for A3 per-keyword
    // outcome actions below (full mode: the whole stamped map; incremental mode: only
    // the pages re-analyzed/updated in this run).
    let persistedEntries: PageKeywordMap[];
    if (strategyMode === 'full') {
      const stampedMap = pageMap.map((pm) => ({ ...pm, analysisGeneratedAt: now })) as PageKeywordMap[];
      // rotate=true: this is the strategy-refresh boundary, so each surviving page's
      // prior current_position rotates into previous_position — the producer the
      // Rankings-tab movements card reads (improved/declined/lost vs the last refresh).
      upsertAndCleanPageKeywords(ws.id, stampedMap, true);
      persistedEntries = stampedMap;
    } else {
      // Only update pages actually re-analyzed in this incremental run.
      const analyzedPaths = new Set(pagesToAnalyze.map(p => normalizePageUrl(p.path)));
      const extraPagePaths = new Set((options.extraPagePaths ?? []).map(pagePath => normalizePageUrl(pagePath)));
      const pathsToUpdate = new Set([...analyzedPaths, ...extraPagePaths]);
      const explicitlyRemovedPaths = new Set((options.removedPagePaths ?? []).map(pagePath => normalizePageUrl(pagePath)));
      const analyzedMappings = pageMap
        .filter((pm) => pathsToUpdate.has(normalizePageUrl(pm.pagePath)))
        .map((pm) => ({ ...pm, analysisGeneratedAt: now })) as PageKeywordMap[];
      // rotate=true: incremental is still a refresh boundary for the pages it touches,
      // so re-analyzed pages rotate prior current_position → previous_position. Untouched
      // pages aren't upserted, so their movement baseline stays frozen until next refreshed.
      upsertPageKeywordsBatch(ws.id, analyzedMappings, true);
      persistedEntries = analyzedMappings;
      for (const pagePath of explicitlyRemovedPaths) {
        db.prepare('DELETE FROM page_keywords WHERE workspace_id = ? AND page_path = ?').run(ws.id, pagePath); // txn-ok: enclosed by writeKeywordStrategy transaction and scoped by workspace_id
        db.prepare('DELETE FROM page_keyword_score_history WHERE workspace_id = ? AND page_path = ?').run(ws.id, pagePath); // txn-ok: enclosed by writeKeywordStrategy transaction and scoped by workspace_id
      }
    }

    replaceAllContentGaps(ws.id, newContentGaps);
    replaceAllQuickWins(ws.id, newQuickWins);
    replaceAllKeywordGaps(ws.id, keywordGaps);
    replaceAllTopicClusters(ws.id, topicClusters);
    replaceAllCannibalizationIssues(ws.id, cannibalization);
    // Strategy redesign (graft 1) — reconcile the managed keyword working-set IN this same
    // transaction so it is atomic with the strategy write (a regen + its set update commit or
    // roll back together). The reconciler is PURE read-diff-insert (NO AI) and runs inside this
    // txn (does NOT open its own). It seeds net-new siteKeywords as 'regen_computed' and
    // auto-replenishes operator-removed slots from the freshly-computed opportunity pool
    // (contentGaps/keywordGaps/opportunities). Kept/active rows survive; soft-removed rows stay
    // removed. The STRATEGY_KEYWORD_SET_UPDATED broadcast fires AFTER commit (outside this body).
    reconcileStrategyKeywordSet(ws.id, {
      ...keywordStrategy,
      keywordGaps,
      contentGaps: newContentGaps,
    } as KeywordStrategy);
    // SOLE STORE (#19b, Wave 3b-ii strip; table-as-truth): the
    // site_keyword_metrics table is now the only persisted home for
    // siteKeywordMetrics. The blob siteKeywordMetrics write was cut above
    // (keywordStrategy.siteKeywordMetrics is forced undefined) — this table write
    // is the source of truth every reader resolves through.
    replaceAllSiteKeywordMetrics(ws.id, siteKeywordMetrics);

    snapshotStrategyHistory(ws.id, ws.keywordStrategy, {
      pageMap: prevPageMapForHistory,
      contentGaps: prevContentGapsForHistory,
      quickWins: prevQuickWinsForHistory,
      keywordGaps: prevKeywordGapsForHistory,
      topicClusters: prevTopicClustersForHistory,
      cannibalization: prevCannibalizationForHistory,
    });

    updateWorkspace(ws.id, { keywordStrategy: keywordStrategy as KeywordStrategy });
    addActivity(ws.id, 'strategy_generated', 'Keyword strategy generated', `${pageMap.length} pages mapped with keywords and search intent`);
    // A3 (audit #14): every regeneration is a distinct trackable event — record a
    // strategy-level action unconditionally. The old `if (!getActionBySource(...))`
    // once-ever guard suppressed every regen after the first, hiding all subsequent
    // strategy work from outcome tracking forever.
    recordAction({ // recordAction-ok: ws.id is workspaceId
      workspaceId: ws.id,
      actionType: 'strategy_keyword_added',
      sourceType: 'strategy',
      sourceId: ws.id,
      pageUrl: null,
      targetKeyword: null,
      baselineSnapshot: { captured_at: now },
      attribution: 'platform_executed',
    });

    // A3 (audit #14): per-keyword outcome actions for net-new pageMap primaries.
    // Each carries a real pageUrl + targetKeyword so the measurement cron can score
    // it later. Two gates keep this idempotent:
    //   1. Net-new diff — the (page, primary) pair was not in the pre-write
    //      page_keywords snapshot, so unchanged primaries on regen record nothing.
    //   2. DB-backed key — no existing tracked action with the deterministic
    //      strategyPageKeywordSourceId(), so a pair removed and later re-added (or a
    //      future Hub-side writer using the same key shape) never duplicates.
    const previousPrimaryPairs = new Set(
      prevPageMapForHistory
        .filter((pm) => pm.pagePath && pm.primaryKeyword?.trim())
        .map((pm) => strategyPageKeywordSourceId(pm.pagePath, pm.primaryKeyword)),
    );
    for (const pm of persistedEntries) {
      if (!pm.pagePath || !pm.primaryKeyword?.trim()) continue;
      const normalizedPath = normalizePageUrl(pm.pagePath);
      // B2's planned-page placeholders (`/planned/<slug>`) are not live URLs — there is
      // nothing to measure against GSC, so they only become scoreable once the page
      // ships under a real path (which then registers as a net-new pair).
      if (normalizedPath.startsWith('/planned/')) continue;
      const sourceId = strategyPageKeywordSourceId(pm.pagePath, pm.primaryKeyword);
      if (previousPrimaryPairs.has(sourceId)) continue; // unchanged primary — not net-new
      if (getActionByWorkspaceAndSource(ws.id, STRATEGY_PAGE_KEYWORD_SOURCE_TYPE, sourceId)) continue; // already tracked
      const hasBaselineMetrics = typeof pm.currentPosition === 'number'
        || typeof pm.clicks === 'number'
        || typeof pm.impressions === 'number';
      recordAction({ // recordAction-ok: ws.id is workspaceId
        workspaceId: ws.id,
        actionType: 'strategy_keyword_added',
        sourceType: STRATEGY_PAGE_KEYWORD_SOURCE_TYPE,
        sourceId,
        pageUrl: normalizedPath,
        targetKeyword: pm.primaryKeyword.trim(),
        baselineSnapshot: {
          captured_at: now,
          ...(typeof pm.currentPosition === 'number' ? { position: pm.currentPosition } : {}),
          ...(typeof pm.clicks === 'number' ? { clicks: pm.clicks } : {}),
          ...(typeof pm.impressions === 'number' ? { impressions: pm.impressions } : {}),
        },
        baselineConfidence: hasBaselineMetrics ? 'exact' : 'estimated',
        attribution: 'platform_executed',
      });
    }
  });
  // Run as BEGIN IMMEDIATE (not better-sqlite3's default deferred): the transaction body READS
  // table-backed prior state (listPageKeywords/listContentGaps/…) BEFORE it writes, so under a
  // concurrent writer on another connection a deferred txn upgrades a stale read snapshot and
  // SQLite returns SQLITE_BUSY_SNAPSHOT ("database is locked") IMMEDIATELY — busy_timeout cannot
  // retry a snapshot conflict. IMMEDIATE acquires the write lock up front (before the reads), so
  // there is no snapshot to invalidate and busy_timeout retries plain lock contention as intended.
  // Fixes the keyword-strategy-partial-state WAL write-contention flake and hardens real concurrent
  // generation.
  writeKeywordStrategy.immediate();

  debouncedPageAnalysisInvalidate(ws.id, () => {
    invalidateIntelligenceCache(ws.id);
    invalidateSubCachePrefix(ws.id, 'slice:seoContext');
    invalidateSubCachePrefix(ws.id, 'slice:pageProfile');
  });
  broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_UPDATED, {
    pageCount: pageMap.length,
    siteKeywords: keywordStrategy.siteKeywords?.length || 0,
  });
  // Strategy redesign (graft 1) — the managed keyword set was reconciled inside the txn above
  // (atomic with the strategy write). Broadcast its update AFTER the commit so the
  // useStrategyKeywordSet hook invalidates and refetches the curated working-set.
  broadcastToWorkspace(ws.id, WS_EVENTS.STRATEGY_KEYWORD_SET_UPDATED, {
    reason: 'regen',
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
