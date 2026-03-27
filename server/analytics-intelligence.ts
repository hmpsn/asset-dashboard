/**
 * Analytics Intelligence — computation engine.
 *
 * Pure functions that compute derived insights from raw GSC/GA4 data.
 * Orchestrator function fetches data and persists results via analytics-insights-store.
 *
 * Lazy evaluation: insights computed on-demand when requested and stale (>6 hours).
 */
import type { SearchPage, QueryPageRow } from './search-console.js';
import type { GA4TopPage } from './google-analytics.js';
import type {
  InsightSeverity,
  InsightType,
  AnalyticsInsight,
  PageHealthData,
  QuickWinData,
  ContentDecayData,
  CannibalizationData,
  ConversionAttributionData,
  CompetitorGapData,
  KeywordClusterData,
} from '../shared/types/analytics.js';
import type { GA4LandingPage } from './google-analytics.js';
import { getAllGscPages, getQueryPageData, paginateGscQuery } from './search-console.js';
import { getValidToken } from './google-auth.js';
import type { CustomDateRange } from './google-analytics.js';
import { getGA4TopPages, getGA4LandingPages } from './google-analytics.js';
import { upsertInsight, getInsights, deleteStaleInsightsByType } from './analytics-insights-store.js';
import { buildEnrichmentContext, enrichInsight } from './insight-enrichment.js';
import { loadDecayAnalysis } from './content-decay.js';
import { apiCache } from './api-cache.js';
import { getWorkspace } from './workspaces.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import { createLogger } from './logger.js';

// ── Shared types for computation results ─────────────────────────

interface ComputedInsight<T> {
  pageId: string | null;
  insightType: string;
  data: T;
  severity: InsightSeverity;
}

// ── Expected CTR by position (industry average approximation) ────

const EXPECTED_CTR_BY_POSITION: Record<number, number> = {
  1: 0.30, 2: 0.17, 3: 0.11, 4: 0.08, 5: 0.065,
  6: 0.05, 7: 0.04, 8: 0.035, 9: 0.03, 10: 0.025,
};

function expectedCtrForPosition(pos: number): number {
  const rounded = Math.max(1, Math.min(Math.round(pos), 10));
  return EXPECTED_CTR_BY_POSITION[rounded] ?? 0.02;
}

// ── Staleness check ──────────────────────────────────────────────

const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

export function isStale(computedAt: string | undefined, maxAgeMs: number = DEFAULT_MAX_AGE_MS): boolean {
  if (!computedAt) return true;
  return Date.now() - new Date(computedAt).getTime() > maxAgeMs;
}

// ── Page Health Scores ───────────────────────────────────────────

/**
 * Compute a 0–100 health score for each GSC page, enriched with GA4 data.
 *
 * Scoring components:
 * - Position (0–30):  pos 1 → 30, pos 10 → 15, pos 20+ → 0
 * - Traffic  (0–25):  clicks normalized vs max site clicks
 * - CTR      (0–20):  actual CTR vs expected CTR for that position
 * - Engagement (0–25): GA4 engagement time normalized (0–180s → 0–25)
 */
export function computePageHealthScores(
  gscPages: SearchPage[],
  ga4Pages: GA4TopPage[],
): ComputedInsight<PageHealthData>[] {
  if (gscPages.length === 0) return [];

  const maxClicks = Math.max(...gscPages.map(p => p.clicks), 1);

  // Index GA4 pages by path for O(1) lookup
  const ga4Map = new Map<string, GA4TopPage>();
  for (const p of ga4Pages) {
    ga4Map.set(p.path, p);
  }

  return gscPages.map(page => {
    // Extract path from full URL for GA4 matching
    let pagePath: string;
    try {
      pagePath = new URL(page.page).pathname;
    } catch {
      pagePath = page.page;
    }

    const ga4 = ga4Map.get(pagePath);
    const pageviews = ga4?.pageviews ?? 0;
    const avgEngagement = ga4?.avgEngagementTime ?? 0;

    // Position component (0–30): linear scale, pos 1 = 30, pos 20+ = 0
    const posScore = Math.max(0, Math.min(30, 30 * (1 - (page.position - 1) / 19)));

    // Traffic component (0–25): percentage of max site clicks
    const trafficScore = Math.min(25, 25 * (page.clicks / maxClicks));

    // CTR component (0–20): ratio of actual CTR to expected CTR at that position
    // Note: page.ctr is in percentage form (e.g. 6.3 for 6.3%) from getAllGscPages
    const expectedCtr = expectedCtrForPosition(page.position);
    const actualCtrDecimal = page.ctr / 100;
    const ctrRatio = expectedCtr > 0 ? actualCtrDecimal / expectedCtr : 0;
    const ctrScore = Math.min(20, 20 * Math.min(ctrRatio, 2) / 2);

    // Engagement component (0–25): engagement time capped at 180s
    const engagementScore = Math.min(25, 25 * Math.min(avgEngagement, 180) / 180);

    const score = Math.round(posScore + trafficScore + ctrScore + engagementScore);

    let severity: InsightSeverity;
    if (score >= 70) severity = 'positive';
    else if (score >= 40) severity = 'opportunity';
    else if (score >= 20) severity = 'warning';
    else severity = 'critical';

    return {
      pageId: page.page,
      insightType: 'page_health',
      data: {
        score,
        trend: 'stable' as const, // trend requires historical comparison (Phase 2)
        clicks: page.clicks,
        impressions: page.impressions,
        position: page.position,
        ctr: page.ctr,
        pageviews,
        bounceRate: 0, // not available from GA4TopPage, added in Phase 2
        avgEngagementTime: avgEngagement,
      },
      severity,
    };
  });
}

// ── Ranking Opportunities (formerly Quick Wins) ──────────────────

const QUICK_WIN_MIN_POSITION = 4;
const QUICK_WIN_MAX_POSITION = 20;
const QUICK_WIN_MIN_IMPRESSIONS = 50;

/**
 * Identify pages ranking in positions 4–20 with enough impressions to be
 * worth optimizing. Estimates traffic gain from reaching position 3.
 */
export function computeRankingOpportunities(
  queryPageData: QueryPageRow[],
): ComputedInsight<QuickWinData>[] {
  const candidates = queryPageData.filter(
    row =>
      row.position >= QUICK_WIN_MIN_POSITION &&
      row.position <= QUICK_WIN_MAX_POSITION &&
      row.impressions >= QUICK_WIN_MIN_IMPRESSIONS,
  );

  const results: ComputedInsight<QuickWinData>[] = candidates.map(row => {
    const targetCtr = expectedCtrForPosition(3); // position 3 target
    const estimatedTrafficGain = Math.round(row.impressions * targetCtr - row.clicks);

    return {
      pageId: `${row.page}::${row.query}`, // composite key so each query-page pair gets its own DB row
      insightType: 'ranking_opportunity',
      data: {
        query: row.query,
        currentPosition: row.position,
        impressions: row.impressions,
        estimatedTrafficGain: Math.max(0, estimatedTrafficGain),
        pageUrl: row.page,
      },
      severity: 'opportunity' as const,
    };
  });

  // Sort by estimated traffic gain descending
  results.sort((a, b) => b.data.estimatedTrafficGain - a.data.estimatedTrafficGain);

  return results;
}

// ── Cannibalization Detection ────────────────────────────────────

/**
 * Detect queries where 2+ pages rank in the top 20.
 * Groups by query, flags when multiple pages compete for the same term.
 */
export function computeCannibalizationInsights(
  queryPageData: QueryPageRow[],
): ComputedInsight<CannibalizationData>[] {
  // Group rows by query, keeping only top-20 results
  const byQuery = new Map<string, QueryPageRow[]>();
  for (const row of queryPageData) {
    if (row.position > 20) continue;
    const existing = byQuery.get(row.query) ?? [];
    existing.push(row);
    byQuery.set(row.query, existing);
  }

  const results: ComputedInsight<CannibalizationData>[] = [];

  for (const [query, rows] of byQuery) {
    if (rows.length < 2) continue; // no cannibalization

    // Sort by position ascending
    rows.sort((a, b) => a.position - b.position);

    const totalImpressions = rows.reduce((sum, r) => sum + r.impressions, 0);

    results.push({
      pageId: `cannibalization::${query}`, // use query as key so each gets its own DB row
      insightType: 'cannibalization',
      data: {
        query,
        pages: rows.map(r => r.page),
        positions: rows.map(r => r.position),
        totalImpressions,
      },
      severity: 'warning',
    });
  }

  // Sort by total impressions descending (most impactful first)
  results.sort((a, b) => b.data.totalImpressions - a.data.totalImpressions);

  return results;
}

// ── Conversion Attribution ───────────────────────────────────────

const CONVERSION_MIN_SESSIONS = 10;

/**
 * Compute per-page conversion attribution from GA4 organic landing pages.
 * Pages with fewer than 10 sessions are excluded as noise.
 */
export function computeConversionAttributionInsights(
  landingPages: GA4LandingPage[],
): ComputedInsight<ConversionAttributionData>[] {
  if (landingPages.length === 0) return [];

  const results: ComputedInsight<ConversionAttributionData>[] = landingPages
    .filter(p => p.sessions >= CONVERSION_MIN_SESSIONS)
    .map(p => {
      const conversionRate = p.sessions > 0 ? (p.conversions / p.sessions) * 100 : 0;

      let severity: InsightSeverity;
      if (conversionRate >= 5) severity = 'positive';
      else if (conversionRate >= 2) severity = 'opportunity';
      else if (conversionRate >= 0.5) severity = 'warning';
      else severity = 'critical';

      return {
        pageId: p.landingPage,
        insightType: 'conversion_attribution' as const,
        data: {
          sessions: p.sessions,
          conversions: p.conversions,
          conversionRate: Math.round(conversionRate * 100) / 100,
          estimatedRevenue: null, // Phase 4: derive from GA4 event values
        },
        severity,
      };
    });

  results.sort((a, b) => b.data.conversionRate - a.data.conversionRate);
  return results;
}

// ── Competitor Gap Analysis ──────────────────────────────────────

interface GapInput {
  keyword: string;
  competitorDomain: string;
  competitorPosition: number;
  volume: number;
  difficulty: number;
}

/**
 * Score and classify competitor keyword gaps.
 * Enriches with our existing GSC position when available.
 */
export function computeCompetitorGapInsights(
  gapData: GapInput[],
  ourQueryData: QueryPageRow[],
): ComputedInsight<CompetitorGapData>[] {
  if (gapData.length === 0) return [];

  // Build a map of our best position per query
  const ourPositions = new Map<string, number>();
  for (const row of ourQueryData) {
    const existing = ourPositions.get(row.query);
    if (!existing || row.position < existing) {
      ourPositions.set(row.query, row.position);
    }
  }

  const results: ComputedInsight<CompetitorGapData>[] = gapData.map(gap => {
    const ourPosition = ourPositions.get(gap.keyword) ?? null;

    let severity: InsightSeverity;
    if (gap.volume >= 1000 && gap.difficulty < 50 && ourPosition === null) {
      severity = 'critical'; // High volume, winnable, we don't rank
    } else if (gap.volume >= 500 && gap.difficulty < 60 && ourPosition === null) {
      severity = 'warning';
    } else {
      severity = 'opportunity';
    }

    return {
      pageId: `gap::${gap.keyword}`, // use keyword as key so each gets its own DB row
      insightType: 'competitor_gap' as const,
      data: {
        keyword: gap.keyword,
        competitorDomain: gap.competitorDomain,
        competitorPosition: gap.competitorPosition,
        ourPosition,
        volume: gap.volume,
        difficulty: gap.difficulty,
      },
      severity,
    };
  });

  results.sort((a, b) => b.data.volume - a.data.volume);
  return results;
}

// ── Keyword Clustering ──────────────────────────────────────────

/**
 * Compute word-overlap similarity between two queries (Jaccard on word tokens).
 * Returns 0-1 where 1 = identical word sets.
 */
function wordJaccard(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const CLUSTER_SIMILARITY_THRESHOLD = 0.3;

/**
 * Cluster GSC queries using word-overlap similarity + co-occurrence on same pages.
 * Two queries are grouped if they share ≥30% word overlap OR both rank on the same page.
 */
export function computeKeywordClusterInsights(
  queryPageData: QueryPageRow[],
): ComputedInsight<KeywordClusterData>[] {
  if (queryPageData.length === 0) return [];

  // Deduplicate queries, keeping best-performing row per query
  const bestByQuery = new Map<string, QueryPageRow>();
  for (const row of queryPageData) {
    const existing = bestByQuery.get(row.query);
    if (!existing || row.impressions > existing.impressions) {
      bestByQuery.set(row.query, row);
    }
  }

  // Build page co-occurrence map: page → set of queries
  const pageQueries = new Map<string, Set<string>>();
  for (const row of queryPageData) {
    const existing = pageQueries.get(row.page) ?? new Set();
    existing.add(row.query);
    pageQueries.set(row.page, existing);
  }

  // Build co-occurrence pairs: queries sharing a page are related
  const coOccurs = new Map<string, Set<string>>();
  for (const queries of pageQueries.values()) {
    const arr = [...queries];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (!coOccurs.has(arr[i])) coOccurs.set(arr[i], new Set());
        if (!coOccurs.has(arr[j])) coOccurs.set(arr[j], new Set());
        coOccurs.get(arr[i])!.add(arr[j]);
        coOccurs.get(arr[j])!.add(arr[i]);
      }
    }
  }

  // Union-Find for clustering
  const uniqueQueries = [...bestByQuery.keys()];
  const parent = new Map<string, string>();
  for (const q of uniqueQueries) parent.set(q, q);

  function find(x: string): string {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!); // path compression
      x = parent.get(x)!;
    }
    return x;
  }

  function union(a: string, b: string): void {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // Merge by co-occurrence (same page)
  for (const [query, related] of coOccurs) {
    for (const r of related) {
      if (bestByQuery.has(query) && bestByQuery.has(r)) {
        union(query, r);
      }
    }
  }

  // Merge by word similarity
  for (let i = 0; i < uniqueQueries.length; i++) {
    for (let j = i + 1; j < uniqueQueries.length; j++) {
      if (wordJaccard(uniqueQueries[i], uniqueQueries[j]) >= CLUSTER_SIMILARITY_THRESHOLD) {
        union(uniqueQueries[i], uniqueQueries[j]);
      }
    }
  }

  // Group queries by cluster root
  const clusters = new Map<string, string[]>();
  for (const q of uniqueQueries) {
    const root = find(q);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(q);
  }

  // Convert clusters to insights
  const results: ComputedInsight<KeywordClusterData>[] = [];
  for (const [, queries] of clusters) {
    const rows = queries.map(q => bestByQuery.get(q)!);
    const totalImpressions = rows.reduce((sum, r) => sum + r.impressions, 0);
    const avgPosition = rows.reduce((sum, r) => sum + r.position, 0) / rows.length;

    // Identify pillar page: page with most combined impressions for this cluster
    const pageImpressions = new Map<string, number>();
    for (const row of queryPageData) {
      if (queries.includes(row.query)) {
        pageImpressions.set(row.page, (pageImpressions.get(row.page) ?? 0) + row.impressions);
      }
    }
    let pillarPage: string | null = null;
    let maxPageImp = 0;
    for (const [page, imp] of pageImpressions) {
      if (imp > maxPageImp) { pillarPage = page; maxPageImp = imp; }
    }

    // Label: use the highest-impression query as the cluster label
    const labelQuery = rows.sort((a, b) => b.impressions - a.impressions)[0].query;

    let severity: InsightSeverity;
    if (totalImpressions >= 2000 && avgPosition <= 10) severity = 'positive';
    else if (totalImpressions >= 500) severity = 'opportunity';
    else if (avgPosition > 15) severity = 'warning';
    else severity = 'opportunity';

    results.push({
      pageId: `cluster::${labelQuery}`, // use label as key so each cluster gets its own DB row
      insightType: 'keyword_cluster' as const,
      data: {
        label: labelQuery,
        queries: queries.sort((a, b) => {
          const impA = bestByQuery.get(a)!.impressions;
          const impB = bestByQuery.get(b)!.impressions;
          return impB - impA;
        }),
        totalImpressions,
        avgPosition: Math.round(avgPosition * 10) / 10,
        pillarPage,
      },
      severity,
    });
  }

  results.sort((a, b) => b.data.totalImpressions - a.data.totalImpressions);
  return results;
}

// ── Ranking Movers ───────────────────────────────────────────────

/**
 * Compare current vs previous period query-page positions to identify
 * significant rank changes (>3 positions). Returns top 30 by impact.
 */
export function computeRankingMovers(
  currentQueryPages: QueryPageRow[],
  previousQueryPages: QueryPageRow[],
): Array<{ insightType: 'ranking_mover'; pageId: string; data: Record<string, unknown>; severity: InsightSeverity }> {
  const results: Array<{ insightType: 'ranking_mover'; pageId: string; data: Record<string, unknown>; severity: InsightSeverity }> = [];
  const prevMap = new Map<string, QueryPageRow>();
  for (const row of previousQueryPages) {
    prevMap.set(`${row.query}::${row.page}`, row);
  }
  for (const curr of currentQueryPages) {
    const prev = prevMap.get(`${curr.query}::${curr.page}`);
    if (!prev) continue;
    const positionChange = prev.position - curr.position; // positive = improvement
    if (Math.abs(positionChange) < 3) continue;
    const severity: InsightSeverity = positionChange < -5 ? 'critical'
      : positionChange < -3 ? 'warning'
      : positionChange > 5 ? 'positive' : 'opportunity';
    results.push({
      insightType: 'ranking_mover' as const,
      pageId: curr.page,
      data: {
        query: curr.query, pageUrl: curr.page,
        currentPosition: Math.round(curr.position * 10) / 10,
        previousPosition: Math.round(prev.position * 10) / 10,
        positionChange: Math.round(positionChange * 10) / 10,
        currentClicks: curr.clicks, previousClicks: prev.clicks,
        impressions: curr.impressions,
      },
      severity,
    });
  }
  return results.sort((a, b) => {
    const aI = Math.abs(a.data.positionChange as number) * (a.data.impressions as number);
    const bI = Math.abs(b.data.positionChange as number) * (b.data.impressions as number);
    return bI - aI;
  }).slice(0, 30);
}

// ── CTR Opportunities ────────────────────────────────────────────

const CTR_OPPORTUNITY_MIN_IMPRESSIONS = 100;
const CTR_OPPORTUNITY_THRESHOLD_RATIO = 0.70; // actual CTR must be < 70% of expected

/**
 * Find query-page pairs where actual CTR is significantly below the
 * industry-average expected CTR for their position (100+ impressions).
 * These pages may benefit from title/meta description optimization.
 */
export function computeCtrOpportunities(
  queryPageData: QueryPageRow[],
): Array<{ insightType: 'ctr_opportunity'; pageId: string; data: Record<string, unknown>; severity: InsightSeverity }> {
  const results: Array<{ insightType: 'ctr_opportunity'; pageId: string; data: Record<string, unknown>; severity: InsightSeverity }> = [];

  for (const row of queryPageData) {
    if (row.impressions < CTR_OPPORTUNITY_MIN_IMPRESSIONS) continue;

    const expectedCtr = expectedCtrForPosition(row.position);
    // row.ctr from GSC is already a percentage (e.g., 6.3 for 6.3%)
    // expectedCtrForPosition returns a decimal (e.g., 0.30 for 30%)
    // Normalize both to decimals for comparison
    const actualCtrDecimal = row.ctr / 100;
    if (expectedCtr === 0) continue;

    const ctrRatio = actualCtrDecimal / expectedCtr;
    if (ctrRatio >= CTR_OPPORTUNITY_THRESHOLD_RATIO) continue;

    const severity: InsightSeverity = ctrRatio < 0.3 ? 'critical'
      : ctrRatio < 0.5 ? 'warning'
      : 'opportunity';

    const ctrGap = Math.round((expectedCtr - actualCtrDecimal) * row.impressions);

    results.push({
      insightType: 'ctr_opportunity' as const,
      pageId: `${row.page}::${row.query}`,
      data: {
        query: row.query,
        pageUrl: row.page,
        position: Math.round(row.position * 10) / 10,
        actualCtr: row.ctr, // already a percentage from GSC
        expectedCtr: Math.round(expectedCtr * 100 * 10) / 10, // convert decimal to percentage
        ctrRatio: Math.round(ctrRatio * 100) / 100,
        impressions: row.impressions,
        estimatedClickGap: Math.max(0, ctrGap),
      },
      severity,
    });
  }

  // Sort by estimated click gap descending
  return results
    .sort((a, b) => (b.data.estimatedClickGap as number) - (a.data.estimatedClickGap as number))
    .slice(0, 30);
}

// ── SERP Opportunities ───────────────────────────────────────────

const SERP_OPPORTUNITY_MIN_IMPRESSIONS = 500;

/**
 * Flag high-impression pages that don't have schema markup.
 * These are candidates for rich result eligibility.
 */
export function computeSerpOpportunities(
  gscPages: SearchPage[],
  pagesWithSchema: Set<string>,
): Array<{ insightType: 'serp_opportunity'; pageId: string; data: Record<string, unknown>; severity: InsightSeverity }> {
  const results: Array<{ insightType: 'serp_opportunity'; pageId: string; data: Record<string, unknown>; severity: InsightSeverity }> = [];

  for (const page of gscPages) {
    if (page.impressions < SERP_OPPORTUNITY_MIN_IMPRESSIONS) continue;

    // Normalise URL to pathname for schema lookup
    let pathname: string;
    try {
      pathname = new URL(page.page).pathname;
    } catch {
      pathname = page.page;
    }

    if (pagesWithSchema.has(pathname) || pagesWithSchema.has(page.page)) continue;

    const severity: InsightSeverity = page.impressions >= 5000 ? 'warning' : 'opportunity';

    results.push({
      insightType: 'serp_opportunity' as const,
      pageId: page.page,
      data: {
        pageUrl: page.page,
        impressions: page.impressions,
        clicks: page.clicks,
        position: Math.round(page.position * 10) / 10,
        ctr: page.ctr,
        schemaStatus: 'missing',
      },
      severity,
    });
  }

  return results
    .sort((a, b) => (b.data.impressions as number) - (a.data.impressions as number))
    .slice(0, 20);
}

// ── Orchestrator (lazy evaluation) ───────────────────────────────

const log = createLogger('analytics-intelligence');

/**
 * Get insights for a workspace, computing fresh ones if stale.
 * Lazy evaluation: only recomputes if oldest insight is >6 hours old.
 */
export async function getOrComputeInsights(
  workspaceId: string,
  insightType?: InsightType,
): Promise<AnalyticsInsight[]> {
  // Always check staleness against ALL workspace insights (not filtered),
  // so a computation cycle that legitimately produced zero results for a
  // given type is recognized as fresh.
  const allExisting = getInsights(workspaceId);

  if (allExisting.length > 0) {
    const newestComputedAt = allExisting.reduce(
      (newest, i) => (i.computedAt > newest ? i.computedAt : newest),
      allExisting[0].computedAt,
    );
    if (!isStale(newestComputedAt)) {
      return insightType ? allExisting.filter(i => i.insightType === insightType) : allExisting;
    }
  }

  // Attempt to compute fresh insights
  try {
    await computeAndPersistInsights(workspaceId);
  } catch (err) {
    log.warn({ err, workspaceId }, 'Failed to compute fresh insights, returning stale data');
    // Return stale data if we have it
    if (allExisting.length > 0) return insightType ? allExisting.filter(i => i.insightType === insightType) : allExisting;
  }

  return getInsights(workspaceId, insightType);
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
  const [gscPages, queryPageData, ga4Pages, previousGscPages, previousQueryPageData] = await Promise.all([
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

  log.info(
    { workspaceId, gscPages: gscPages.length, queryRows: queryPageData.length, ga4Pages: ga4Pages.length },
    'Fetched analytics data for intelligence computation',
  );

  // Record cycle start time — after all upserts for a type, delete rows
  // with computed_at older than this to prune insights that dropped out
  // of the current top-N set.
  const cycleStart = new Date().toISOString();

  /** Helper: enrich and upsert a single insight */
  function enrichAndUpsert(insight: {
    insightType: InsightType;
    pageId: string | null;
    data: Record<string, unknown>;
    severity: InsightSeverity;
  }): void {
    const enrichment = enrichInsight(
      { pageId: insight.pageId, insightType: insight.insightType, severity: insight.severity, data: insight.data },
      enrichCtx,
    );
    upsertInsight({
      workspaceId,
      pageId: insight.pageId,
      insightType: insight.insightType,
      data: insight.data,
      severity: insight.severity,
      ...enrichment,
    });
  }

  // Compute each insight type
  if (gscPages.length > 0) {
    const healthInsights = computePageHealthScores(gscPages, ga4Pages);
    for (const insight of healthInsights) {
      enrichAndUpsert({
        insightType: 'page_health',
        pageId: insight.pageId,
        data: insight.data as unknown as Record<string, unknown>,
        severity: insight.severity,
      });
    }
    deleteStaleInsightsByType(workspaceId, 'page_health', cycleStart);
    log.info({ workspaceId, count: healthInsights.length }, 'Computed page health scores');
  }

  if (queryPageData.length > 0) {
    const rankingOpps = computeRankingOpportunities(queryPageData);
    for (const insight of rankingOpps.slice(0, 20)) {
      enrichAndUpsert({
        insightType: 'ranking_opportunity',
        pageId: insight.pageId,
        data: insight.data as unknown as Record<string, unknown>,
        severity: insight.severity,
      });
    }
    deleteStaleInsightsByType(workspaceId, 'ranking_opportunity', cycleStart);
    log.info({ workspaceId, count: Math.min(rankingOpps.length, 20) }, 'Computed ranking opportunities');

    const cannibalization = computeCannibalizationInsights(queryPageData);
    for (const insight of cannibalization.slice(0, 15)) {
      enrichAndUpsert({
        insightType: 'cannibalization',
        pageId: insight.pageId,
        data: insight.data as unknown as Record<string, unknown>,
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
      for (const page of decayAnalysis.decayingPages) {
        const severity: InsightSeverity =
          page.severity === 'critical' ? 'critical'
          : page.severity === 'warning' ? 'warning'
          : 'opportunity';
        enrichAndUpsert({
          insightType: 'content_decay',
          pageId: page.page,
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
      deleteStaleInsightsByType(workspaceId, 'content_decay', cycleStart);
      log.info({ workspaceId, count: decayAnalysis.decayingPages.length }, 'Loaded content decay insights from decay engine');
    }
  }

  // Phase 3A: Keyword clustering
  if (queryPageData.length > 0) {
    const clusterInsights = computeKeywordClusterInsights(queryPageData);
    for (const insight of clusterInsights.slice(0, 20)) {
      enrichAndUpsert({
        insightType: 'keyword_cluster',
        pageId: insight.pageId,
        data: insight.data as unknown as Record<string, unknown>,
        severity: insight.severity,
      });
    }
    deleteStaleInsightsByType(workspaceId, 'keyword_cluster', cycleStart);
    log.info({ workspaceId, count: Math.min(clusterInsights.length, 20) }, 'Computed keyword clusters');
  }

  // Phase 3B: Competitor gap analysis (uses SEMRush/DataForSEO provider)
  if (ws.liveDomain) {
    try {
      const provider = getConfiguredProvider(ws.seoDataProvider as any);
      if (provider?.isConfigured()) {
        const competitors = ws.competitorDomains?.length
          ? ws.competitorDomains
          : await provider.getCompetitors(ws.liveDomain, workspaceId, 3).then(c => c.map(e => e.domain)).catch(() => []);

        if (competitors.length > 0) {
          const gapData = await apiCache.wrap(workspaceId, 'keywordGap', { competitors }, () =>
            provider.getKeywordGap(ws.liveDomain!, competitors, workspaceId, 50),
          );
          if (gapData.length > 0) {
            const gapInsights = computeCompetitorGapInsights(gapData, queryPageData);
            for (const insight of gapInsights.slice(0, 30)) {
              enrichAndUpsert({
                insightType: 'competitor_gap',
                pageId: insight.pageId,
                data: insight.data as unknown as Record<string, unknown>,
                severity: insight.severity,
              });
            }
            deleteStaleInsightsByType(workspaceId, 'competitor_gap', cycleStart);
            log.info({ workspaceId, count: Math.min(gapInsights.length, 30) }, 'Computed competitor gap insights');
          }
        }
      }
    } catch (err) {
      log.warn({ err, workspaceId }, 'Failed to compute competitor gap insights');
    }
  }

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
            data: insight.data as unknown as Record<string, unknown>,
            severity: insight.severity,
          });
        }
        deleteStaleInsightsByType(workspaceId, 'conversion_attribution', cycleStart);
        log.info({ workspaceId, count: Math.min(conversionInsights.length, 20) }, 'Computed conversion attribution insights');
      }
    } catch (err) {
      log.warn({ err, workspaceId }, 'Failed to compute conversion attribution insights');
    }
  }

  // Phase 4: New insight types
  if (queryPageData.length > 0 && previousQueryPageData.length > 0) {
    const movers = computeRankingMovers(queryPageData, previousQueryPageData);
    for (const insight of movers) {
      enrichAndUpsert({
        insightType: 'ranking_mover',
        pageId: insight.pageId,
        data: insight.data,
        severity: insight.severity,
      });
    }
    deleteStaleInsightsByType(workspaceId, 'ranking_mover', cycleStart);
    log.info({ workspaceId, count: movers.length }, 'Computed ranking movers');
  }

  if (queryPageData.length > 0) {
    const ctrOpps = computeCtrOpportunities(queryPageData);
    for (const insight of ctrOpps) {
      enrichAndUpsert({
        insightType: 'ctr_opportunity',
        pageId: insight.pageId,
        data: insight.data,
        severity: insight.severity,
      });
    }
    deleteStaleInsightsByType(workspaceId, 'ctr_opportunity', cycleStart);
    log.info({ workspaceId, count: ctrOpps.length }, 'Computed CTR opportunities');
  }

  if (gscPages.length > 0) {
    // Load pages that already have schema markup from the DB (graceful fallback)
    let pagesWithSchema = new Set<string>();
    try {
      const schemaDb = await import('./db/index.js');
      const rows = schemaDb.default.prepare(
        `SELECT DISTINCT page_path FROM schema_page_types WHERE workspace_id = ?`,
      ).all(workspaceId) as Array<{ page_path: string }>;
      pagesWithSchema = new Set(rows.map(r => r.page_path));
    } catch {
      // schema_page_types table may not exist — proceed with empty set
    }
    const serpOpps = computeSerpOpportunities(gscPages, pagesWithSchema);
    for (const insight of serpOpps) {
      enrichAndUpsert({
        insightType: 'serp_opportunity',
        pageId: insight.pageId,
        data: insight.data,
        severity: insight.severity,
      });
    }
    deleteStaleInsightsByType(workspaceId, 'serp_opportunity', cycleStart);
    log.info({ workspaceId, count: serpOpps.length }, 'Computed SERP opportunities');
  }
}
