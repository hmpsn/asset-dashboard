import type { SearchPage, QueryPageRow } from '../../search-console.js';
import type { GA4TopPage } from '../../google-analytics.js';
import type { CustomDateRange } from '../../google-analytics.js';
import type { AnalyticsInsight, InsightDataMap, InsightSeverity, InsightType } from '../../../shared/types/analytics.js';
import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import { apiCache } from '../../api-cache.js';
import { deleteStaleInsightsByType, getInsights, upsertInsight } from '../../analytics-insights-store.js';
import { extractBrandTokens } from '../../competitor-brand-filter.js';
import { loadDecayAnalysis } from '../../content-decay.js';
import { isProgrammingError } from '../../errors.js';
import { getConfiguredProvider } from '../../seo-data-provider.js';
import { getGA4LandingPages, getGA4TopPages } from '../../google-analytics.js';
import { buildEnrichmentContext, enrichInsight } from '../../insight-enrichment.js';
import { runFeedbackLoops } from '../../insight-feedback.js';
import { listPageKeywords } from '../../page-keywords.js';
import { getAllGscPages, getQueryPageData } from '../../search-console.js';
import { workspaceProviderGeo } from '../../seo-target-geo.js';
import { createLogger } from '../../logger.js';
import { toInsightPageId } from '../../helpers.js';
import { getWorkspace } from '../../workspaces.js';
import { MIN_DECAY_ABSOLUTE_LOSS, MIN_DECAY_BASELINE_CLICKS } from './constants.js';
import {
  computeCannibalizationInsights,
  computeCompetitorGapInsights,
  computeConversionAttributionInsights,
  computeCtrOpportunities,
  computeFreshnessAlerts,
  computeKeywordClusterInsights,
  computePageHealthScores,
  computeRankingMovers,
  computeRankingOpportunities,
  computeSerpFeatureOpportunities,
  computeSerpOpportunities,
  isKeywordEmerging,
  isStale,
} from './computations.js';
import { capWithDiversity } from './feed.js';
import { deduplicatePages, deduplicateQueryPages } from './normalization.js';
import { validateInsightBatch } from './validation.js';

const log = createLogger('analytics-intelligence');

/**
 * Get insights for a workspace, computing fresh ones if stale.
 * Lazy evaluation: only recomputes if oldest insight is >6 hours old.
 */
export async function getOrComputeInsights(
  workspaceId: string,
  insightType?: InsightType,
  opts?: { force?: boolean },
): Promise<AnalyticsInsight[]> {
  // Always check staleness against ALL workspace insights (not filtered),
  // so a computation cycle that legitimately produced zero results for a
  // given type is recognized as fresh.
  const allExisting = getInsights(workspaceId);

  if (!opts?.force && allExisting.length > 0) {
    const newestComputedAt = allExisting.reduce(
      (newest, i) => (i.computedAt > newest ? i.computedAt : newest),
      allExisting[0].computedAt,
    );
    if (!isStale(newestComputedAt)) {
      const fresh = insightType ? allExisting.filter(i => i.insightType === insightType) : allExisting;
      return capWithDiversity(fresh, insightType);
    }
  }

  // Attempt to compute fresh insights
  try {
    await computeAndPersistInsights(workspaceId);
  } catch (err) {
    log.warn({ err, workspaceId }, 'Failed to compute fresh insights, returning stale data');
    if (allExisting.length > 0) {
      const stale = insightType ? allExisting.filter(i => i.insightType === insightType) : allExisting;
      return capWithDiversity(stale, insightType);
    }
  }

  return capWithDiversity(getInsights(workspaceId, insightType), insightType);
}

/**
 * Compute all insight types for a workspace and persist to SQLite.
 * Enriches every insight with page titles, strategy alignment, pipeline
 * status, domain classification, and impact scores.
 */
async function computeAndPersistInsights(workspaceId: string): Promise<void> {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error(`Workspace not found: ${workspaceId}`);

  const siteId = ws.webflowSiteId;
  const gscUrl = ws.gscPropertyUrl;
  const ga4Id = ws.ga4PropertyId;

  // CLIENT-workspace SERP geo for provider domain/competitor/gap queries below.
  // `{}` when the geo-targeting flag is OFF (byte-identical to pre-P4); resolved
  // { locationCode, languageCode } when ON. Folded into the apiCache.wrap keys so a
  // geo change busts the workspace-scoped cache rather than serving stale US data. (P4)
  const geo = workspaceProviderGeo(workspaceId);

  // Build enrichment context once for the full cycle
  const enrichCtx = await buildEnrichmentContext(workspaceId);

  // Compute non-overlapping date ranges for decay comparison
  // Current: last 30 days (with 3-day GSC delay)
  // Previous: the 30 days before that
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const curEnd = new Date();
  curEnd.setDate(curEnd.getDate() - 3); // GSC ~3 day delay
  const curStart = new Date(curEnd);
  curStart.setDate(curStart.getDate() - 30);
  const prevEnd = new Date(curStart);
  prevEnd.setDate(prevEnd.getDate() - 1); // day before current period starts
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - 30);

  const currentDateRange: CustomDateRange = { startDate: fmt(curStart), endDate: fmt(curEnd) };
  const previousDateRange: CustomDateRange = { startDate: fmt(prevStart), endDate: fmt(prevEnd) };

  // Fetch data in parallel, using the API cache
  const [gscPages, queryPageData, ga4Pages, , previousQueryPageData] = await Promise.all([
    gscUrl && siteId
      ? apiCache.wrap(workspaceId, 'getAllGscPages', { range: currentDateRange }, () =>
          getAllGscPages(siteId, gscUrl, 30, currentDateRange),
        )
      : [],
    gscUrl && siteId
      ? apiCache.wrap(workspaceId, 'getQueryPageData_paginated', { days: 30, maxRows: 2000 }, () =>
          getQueryPageData(siteId, gscUrl, 30, { maxRows: 2000 }),
        )
      : [],
    ga4Id
      ? apiCache.wrap(workspaceId, 'getGA4TopPages', { days: 30, limit: 100 }, () =>
          getGA4TopPages(ga4Id, 30, 100),
        )
      : [],
    // Previous period GSC pages for decay comparison (non-overlapping 30d window)
    gscUrl && siteId
      ? apiCache.wrap(workspaceId, 'getAllGscPages_prev', { range: previousDateRange }, () =>
          getAllGscPages(siteId, gscUrl, 30, previousDateRange),
        )
      : [],
    // Previous period query-page data for ranking movers
    gscUrl && siteId
      ? apiCache.wrap(workspaceId, 'getQueryPageData_prev', { days: 30, maxRows: 2000, range: previousDateRange }, () =>
          getQueryPageData(siteId, gscUrl, 30, { maxRows: 2000, dateRange: previousDateRange }),
        )
      : [],
  ]) as [SearchPage[], QueryPageRow[], GA4TopPage[], SearchPage[], QueryPageRow[]];

  // Clone, normalize, and deduplicate — merges metrics for URL variants
  // (trailing slashes, query params, fragments) of the same logical page.
  // Cloning avoids mutating apiCache shared references.
  const normGscPages = deduplicatePages(gscPages);
  const normQueryPageData = deduplicateQueryPages(queryPageData);
  const normPrevQueryPageData = deduplicateQueryPages(previousQueryPageData);

  log.info(
    { workspaceId, gscPages: gscPages.length, queryRows: queryPageData.length, ga4Pages: ga4Pages.length },
    'Fetched analytics data for intelligence computation',
  );

  // Record cycle start time — after all upserts for a type, delete rows
  // with computed_at older than this to prune insights that dropped out
  // of the current top-N set.
  const cycleStart = new Date().toISOString();

  /** Helper: enrich and upsert a single insight */
  function enrichAndUpsert<T extends InsightType>(insight: {
    insightType: T;
    pageId: string | null;
    data: InsightDataMap[T];
    severity: InsightSeverity;
  }): void {
    const enrichment = enrichInsight(
      { pageId: insight.pageId, insightType: insight.insightType, severity: insight.severity, data: insight.data },
      enrichCtx,
    );
    // `enrichment` is Partial<AnalyticsInsight> so spreading it can introduce
    // an untyped `data` field; strip it so the narrowly-typed `insight.data` wins.
    const { data: _enrichedData, ...enrichmentRest } = enrichment;
    void _enrichedData;
    upsertInsight({ // clone-ok: fresh computed insert from live analytics + enrichment; `insight` is computed input, not a stored row
      workspaceId,
      pageId: insight.pageId,
      insightType: insight.insightType,
      data: insight.data,
      severity: insight.severity,
      ...enrichmentRest,
    });
  }

  // Compute each insight type — use normalized arrays to prevent URL-variant duplicates
  if (normGscPages.length > 0) {
    const healthInsights = computePageHealthScores(normGscPages, ga4Pages);
    for (const insight of healthInsights) {
      enrichAndUpsert({
        insightType: 'page_health',
        pageId: insight.pageId,
        data: insight.data,
        severity: insight.severity,
      });
    }
    deleteStaleInsightsByType(workspaceId, 'page_health', cycleStart);
    log.info({ workspaceId, count: healthInsights.length }, 'Computed page health scores');
  }

  if (normQueryPageData.length > 0) {
    const brandTokens = [...new Set(
      (ws.competitorDomains ?? []).flatMap(domain => extractBrandTokens(domain)),
    )];

    const rankingOpps = computeRankingOpportunities(normQueryPageData, brandTokens);
    for (const insight of rankingOpps.slice(0, 20)) {
      enrichAndUpsert({
        insightType: 'ranking_opportunity',
        pageId: insight.pageId,
        data: insight.data,
        severity: insight.severity,
      });
    }
    deleteStaleInsightsByType(workspaceId, 'ranking_opportunity', cycleStart);
    log.info({ workspaceId, count: Math.min(rankingOpps.length, 20) }, 'Computed ranking opportunities');

    const cannibalization = computeCannibalizationInsights(normQueryPageData, brandTokens);
    for (const insight of cannibalization.slice(0, 15)) {
      enrichAndUpsert({
        insightType: 'cannibalization',
        pageId: insight.pageId,
        data: insight.data,
        severity: insight.severity,
      });
    }
    deleteStaleInsightsByType(workspaceId, 'cannibalization', cycleStart);
    log.info({ workspaceId, count: Math.min(cannibalization.length, 15) }, 'Computed cannibalization insights');
  }

  // Content decay — delegate to the standalone content-decay engine
  {
    const decayAnalysis = loadDecayAnalysis(workspaceId);
    if (decayAnalysis && decayAnalysis.decayingPages.length > 0) {
      // Only surface decay that's both percentage-significant AND volume-significant.
      // A page dropping from 20→17 clicks (-15%) isn't actionable even though it exceeds
      // the decay engine's 10% threshold. Require minimum baseline AND minimum absolute loss.
      const significantDecay = decayAnalysis.decayingPages.filter(p =>
        p.previousClicks >= MIN_DECAY_BASELINE_CLICKS &&
        Math.abs(p.previousClicks - p.currentClicks) >= MIN_DECAY_ABSOLUTE_LOSS
      );
      for (const page of significantDecay) {
        const severity: InsightSeverity =
          page.severity === 'critical' ? 'critical'
          : page.severity === 'warning' ? 'warning'
          : 'opportunity';
        enrichAndUpsert({
          insightType: 'content_decay',
          pageId: toInsightPageId(page.page),
          data: {
            baselineClicks: page.previousClicks,
            currentClicks: page.currentClicks,
            deltaPercent: page.clickDeclinePct,
            baselinePeriod: 'previous_30d',
            currentPeriod: 'current_30d',
          },
          severity,
        });
      }
      log.info({ workspaceId, count: significantDecay.length, filtered: decayAnalysis.decayingPages.length - significantDecay.length }, 'Loaded content decay insights from decay engine');
    }
    // Always prune stale decay insights — even when the decay engine
    // returns null/empty, old decay insights should be removed
    deleteStaleInsightsByType(workspaceId, 'content_decay', cycleStart);
  }

  // Phase 3A: Keyword clustering
  if (normQueryPageData.length > 0) {
    const clusterInsights = computeKeywordClusterInsights(normQueryPageData);
    for (const insight of clusterInsights.slice(0, 20)) {
      enrichAndUpsert({
        insightType: 'keyword_cluster',
        pageId: insight.pageId,
        data: insight.data,
        severity: insight.severity,
      });
    }
    deleteStaleInsightsByType(workspaceId, 'keyword_cluster', cycleStart);
    log.info({ workspaceId, count: Math.min(clusterInsights.length, 20) }, 'Computed keyword clusters');
  }

  // Phase 3B: Competitor gap analysis (uses SEMRush/DataForSEO provider)
  if (ws.liveDomain) {
    try {
      const provider = getConfiguredProvider(ws.seoDataProvider);
      if (provider?.isConfigured()) {
        const competitors = ws.competitorDomains?.length
          ? ws.competitorDomains
          : await provider.getCompetitors(ws.liveDomain, workspaceId, 3, undefined, geo.locationCode, geo.languageCode).then(c => c.map(e => e.domain)).catch(() => []);

        if (competitors.length > 0) {
          const gapData = await apiCache.wrap(workspaceId, 'keywordGap', { competitors, loc: geo.locationCode, lang: geo.languageCode }, () =>
            provider.getKeywordGap(ws.liveDomain!, competitors, workspaceId, 50, undefined, geo.locationCode, geo.languageCode),
          );
          if (gapData.length > 0) {
            const gapInsights = computeCompetitorGapInsights(gapData, normQueryPageData);
            for (const insight of gapInsights.slice(0, 30)) {
              enrichAndUpsert({
                insightType: 'competitor_gap',
                pageId: insight.pageId,
                data: insight.data,
                severity: insight.severity,
              });
            }
            log.info({ workspaceId, count: Math.min(gapInsights.length, 30) }, 'Computed competitor gap insights');
          }
        }
      }
    } catch (err) {
      log.warn({ err, workspaceId }, 'Failed to compute competitor gap insights');
    }
  }
  // Always prune stale competitor_gap rows — outside liveDomain guard so cleanup runs when liveDomain is cleared
  deleteStaleInsightsByType(workspaceId, 'competitor_gap', cycleStart);

  // Phase 3C: Conversion attribution (GA4 organic landing pages)
  if (ga4Id) {
    try {
      const landingPages = await apiCache.wrap(workspaceId, 'ga4LandingPages_organic', { days: 30 }, () =>
        getGA4LandingPages(ga4Id, 30, 100, true),
      );
      if (landingPages.length > 0) {
        const conversionInsights = computeConversionAttributionInsights(landingPages);
        for (const insight of conversionInsights.slice(0, 20)) {
          enrichAndUpsert({
            insightType: 'conversion_attribution',
            pageId: insight.pageId,
            data: insight.data,
            severity: insight.severity,
          });
        }
        log.info({ workspaceId, count: Math.min(conversionInsights.length, 20) }, 'Computed conversion attribution insights');
      }
    } catch (err) {
      log.warn({ err, workspaceId }, 'Failed to compute conversion attribution insights');
    }
  }
  // Always prune stale conversion_attribution rows — outside ga4Id guard so cleanup runs when GA4 is disconnected
  deleteStaleInsightsByType(workspaceId, 'conversion_attribution', cycleStart);

  // Phase 4: ranking_mover, ctr_opportunity, serp_opportunity
  if (normQueryPageData.length > 0 && normPrevQueryPageData.length > 0) {
    const movers = computeRankingMovers(normQueryPageData, normPrevQueryPageData);
    for (const insight of movers) {
      enrichAndUpsert({
        insightType: 'ranking_mover',
        pageId: insight.pageId,
        data: insight.data,
        severity: insight.severity,
      });
    }
    log.info({ workspaceId, count: movers.length }, 'Computed ranking movers');
  }
  // Always prune stale ranking_mover rows — outside GSC-data guard so cleanup runs when GSC is disconnected
  deleteStaleInsightsByType(workspaceId, 'ranking_mover', cycleStart);

  if (normQueryPageData.length > 0) {
    const ctrOpps = computeCtrOpportunities(normQueryPageData);
    for (const insight of ctrOpps) {
      enrichAndUpsert({
        insightType: 'ctr_opportunity',
        pageId: insight.pageId,
        data: insight.data,
        severity: insight.severity,
      });
    }
    log.info({ workspaceId, count: ctrOpps.length }, 'Computed CTR opportunities');
  }
  // Always prune stale ctr_opportunity rows — outside GSC-data guard so cleanup runs when GSC is disconnected
  deleteStaleInsightsByType(workspaceId, 'ctr_opportunity', cycleStart);

  if (normGscPages.length > 0) {
    // Load pages that already have schema markup from the DB (graceful fallback)
    let pagesWithSchema = new Set<string>();
    try {
      const schemaDb = await import('../../db/index.js'); // dynamic-import-ok — circular dep prevention, default export is typed
      const rows = schemaDb.default.prepare(
        `SELECT DISTINCT page_path FROM schema_page_types WHERE workspace_id = ?`,
      ).all(workspaceId) as Array<{ page_path: string }>;
      pagesWithSchema = new Set(rows.map(r => r.page_path));
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'analytics-intelligence: programming error');
      // schema_page_types table may not exist — proceed with empty set
    }
    const serpOpps = computeSerpOpportunities(normGscPages, pagesWithSchema);
    for (const insight of serpOpps) {
      enrichAndUpsert({
        insightType: 'serp_opportunity',
        pageId: insight.pageId,
        data: insight.data,
        severity: insight.severity,
      });
    }
    log.info({ workspaceId, count: serpOpps.length }, 'Computed SERP opportunities');
  }
  // Always prune stale serp_opportunity rows — outside GSC-data guard so cleanup runs when GSC is disconnected
  deleteStaleInsightsByType(workspaceId, 'serp_opportunity', cycleStart);

  // P6: serp_feature_opportunity — flag-gated (no-op when national-serp-tracking is OFF).
  // Reads the latest national-SERP snapshots; the compute itself enforces the flag guard.
  {
    const serpFeatureOpps = computeSerpFeatureOpportunities(workspaceId);
    for (const insight of serpFeatureOpps) {
      enrichAndUpsert({
        insightType: 'serp_feature_opportunity',
        pageId: insight.pageId,
        data: insight.data,
        severity: insight.severity,
      });
    }
    if (serpFeatureOpps.length > 0) {
      log.info({ workspaceId, count: serpFeatureOpps.length }, 'Computed SERP feature opportunities');
    }
  }
  // Always prune stale serp_feature_opportunity rows — outside the snapshot/flag guard so
  // disconnecting the SERP provider (or turning the flag OFF) cleans up old insights instead
  // of orphaning them.
  deleteStaleInsightsByType(workspaceId, 'serp_feature_opportunity', cycleStart);

  // Phase 5: Emerging keyword detection (SEMRush trend analysis)
  if (ws.liveDomain) {
    try {
      const provider = getConfiguredProvider(ws.seoDataProvider);
      if (provider?.isConfigured()) {
        const domainKws = await apiCache.wrap(workspaceId, 'domainKeywords_emerging', { loc: geo.locationCode, lang: geo.languageCode }, () =>
          provider.getDomainKeywords(ws.liveDomain!, workspaceId, 200, undefined, geo.locationCode, geo.languageCode),
        );
        // A keyword can rank on multiple pages; keep the BEST (lowest) position so
        // currentPosition reflects our strongest ranking, not an arbitrary last-seen page.
        const gscLookup = normQueryPageData.reduce<Map<string, number>>((map, r) => {
          const key = keywordComparisonKey(r.query);
          const existing = map.get(key);
          if (existing === undefined || r.position < existing) map.set(key, r.position);
          return map;
        }, new Map());
        const emerging = domainKws.filter(
          kw => kw.volume >= 100 && isKeywordEmerging({ trend: kw.trend }),
        );
        for (const kw of emerging.slice(0, 10)) {
          const currentPosition = gscLookup.get(keywordComparisonKey(kw.keyword));
          enrichAndUpsert({
            insightType: 'emerging_keyword',
            pageId: `emerging_keyword::${kw.keyword}`, // unique per keyword so each gets its own DB row
            data: {
              keyword: kw.keyword,
              volume: kw.volume,
              difficulty: kw.difficulty,
              trendData: kw.trend,
              currentPosition,
              rankingUrl: kw.url,
            },
            severity: 'opportunity',
          });
        }
        log.info({ workspaceId, count: Math.min(emerging.length, 10) }, 'Computed emerging keyword insights');
      }
    } catch (err) {
      log.warn({ err, workspaceId }, 'Failed to compute emerging keyword insights');
    }
  }
  // Always prune stale emerging_keyword rows — even when liveDomain is unset or provider is unconfigured
  // (avoids orphaning rows from a previous run when liveDomain is later cleared)
  deleteStaleInsightsByType(workspaceId, 'emerging_keyword', cycleStart);

  // Phase 6: Content freshness alerts — flag pages with stale keyword analysis + meaningful traffic
  {
    try {
      const pageKws = listPageKeywords(workspaceId);
      const freshnessAlerts = computeFreshnessAlerts(pageKws);
      for (const alert of freshnessAlerts) {
        enrichAndUpsert({
          insightType: 'freshness_alert',
          pageId: alert.pageId,
          data: alert.data,
          severity: alert.severity,
        });
      }
      log.info({ workspaceId, count: freshnessAlerts.length }, 'Computed content freshness alerts');
    } catch (err) {
      log.warn({ err, workspaceId }, 'Failed to compute content freshness alerts');
    }
    // Always prune stale freshness_alert rows — outside try so it runs even if listPageKeywords throws
    deleteStaleInsightsByType(workspaceId, 'freshness_alert', cycleStart);
  }

  // Quality gate: suppress contradictory/duplicate/low-confidence insights
  validateInsightBatch(workspaceId);

  // Phase 2 feedback loops: push signals to Strategy & Pipeline
  // Non-fatal — runFeedbackLoops has its own try/catch
  runFeedbackLoops(workspaceId);
}
