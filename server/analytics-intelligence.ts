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
  InsightDataMap,
  PageHealthData,
  QuickWinData,
  CannibalizationData,
  ConversionAttributionData,
  CompetitorGapData,
  KeywordClusterData,
  RankingMoverData,
  CtrOpportunityData,
  SerpOpportunityData,
} from '../shared/types/analytics.js';
import type { GA4LandingPage } from './google-analytics.js';
import { getAllGscPages, getQueryPageData } from './search-console.js';
import type { CustomDateRange } from './google-analytics.js';
import { getGA4TopPages, getGA4LandingPages } from './google-analytics.js';
import { upsertInsight, getInsights, deleteStaleInsightsByType, suppressInsights } from './analytics-insights-store.js';
import { buildEnrichmentContext, enrichInsight } from './insight-enrichment.js';
import { loadDecayAnalysis } from './content-decay.js';
import { runFeedbackLoops } from './insight-feedback.js';
import { apiCache } from './api-cache.js';
import { getWorkspace } from './workspaces.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import { extractBrandTokens, isBrandedQuery } from './competitor-brand-filter.js';
import { listPageKeywords } from './page-keywords.js';
import { createLogger } from './logger.js';
import { isProgrammingError } from './errors.js';

// ── Shared types for computation results ─────────────────────────

interface ComputedInsight<T> {
  pageId: string | null;
  insightType: string;
  data: T;
  severity: InsightSeverity;
}

// ── URL normalization for page deduplication ─────────────────────
// GSC can return multiple URL variants for the same logical page
// (trailing slashes, query params, fragments). Normalize before
// using as grouping keys or DB page_id values.

function normalizePageUrl(url: string): string {
  try {
    const u = new URL(url);
    // Strip query params & fragment — same page content
    let path = u.pathname;
    // Strip trailing slash (keep root '/')
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${u.origin}${path}`;
  } catch (err) {
    // Not a valid URL — strip trailing slash as best-effort
    return url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url;
  }
}

/**
 * Clone + normalize + deduplicate SearchPage arrays.
 * Merges metrics for URL variants of the same page (sum clicks/impressions,
 * weighted-average position/CTR).
 */
function deduplicatePages(pages: SearchPage[]): SearchPage[] {
  const map = new Map<string, SearchPage>();
  for (const p of pages) {
    const key = normalizePageUrl(p.page);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...p, page: key });
    } else {
      const totalImpressions = existing.impressions + p.impressions;
      existing.clicks += p.clicks;
      existing.position = totalImpressions > 0
        ? (existing.position * existing.impressions + p.position * p.impressions) / totalImpressions
        : existing.position;
      existing.ctr = totalImpressions > 0
        ? (existing.ctr * existing.impressions + p.ctr * p.impressions) / totalImpressions
        : existing.ctr;
      existing.impressions = totalImpressions;
    }
  }
  return Array.from(map.values());
}

/**
 * Clone + normalize + deduplicate QueryPageRow arrays.
 * Merges metrics for rows sharing the same (query, normalized page).
 */
function deduplicateQueryPages(rows: QueryPageRow[]): QueryPageRow[] {
  const map = new Map<string, QueryPageRow>();
  for (const r of rows) {
    const normPage = normalizePageUrl(r.page);
    const key = `${r.query}::${normPage}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r, page: normPage });
    } else {
      const totalImpressions = existing.impressions + r.impressions;
      existing.clicks += r.clicks;
      existing.position = totalImpressions > 0
        ? (existing.position * existing.impressions + r.position * r.impressions) / totalImpressions
        : existing.position;
      existing.ctr = totalImpressions > 0
        ? (existing.ctr * existing.impressions + r.ctr * r.impressions) / totalImpressions
        : existing.ctr;
      existing.impressions = totalImpressions;
    }
  }
  return Array.from(map.values());
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

// ── Emerging keyword detection ───────────────────────────────────

/**
 * Returns true if the keyword's trend array indicates net rising volume over
 * the last 6 months. Uses a simple linear regression approach — ≥20% net gain
 * AND positive second-half average qualifies as "emerging".
 */
export function isKeywordEmerging(kw: { trend?: number[] }): boolean {
  const t = kw.trend;
  if (!t || t.length < 3) return false;
  const recent = t.slice(-6);
  const n = recent.length;
  const first = recent[0];
  const last = recent[n - 1];
  if (first <= 0) return false;
  const netGainPct = (last - first) / first;
  const midpoint = Math.floor(n / 2);
  const firstHalfAvg = recent.slice(0, midpoint).reduce((s, v) => s + v, 0) / midpoint;
  const secondHalfAvg = recent.slice(midpoint).reduce((s, v) => s + v, 0) / (n - midpoint);
  return netGainPct >= 0.20 && secondHalfAvg > firstHalfAvg;
}

// ── Staleness check ──────────────────────────────────────────────

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours — analytics data refreshes at most once per day

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
const PAGE_HEALTH_MIN_IMPRESSIONS = 50; // Skip pages with negligible visibility

export function computePageHealthScores(
  gscPages: SearchPage[],
  ga4Pages: GA4TopPage[],
): ComputedInsight<PageHealthData>[] {
  if (gscPages.length === 0) return [];

  // Filter out pages with negligible traffic — scoring them produces noise
  const significantPages = gscPages.filter(p => p.impressions >= PAGE_HEALTH_MIN_IMPRESSIONS);
  if (significantPages.length === 0) return [];

  const maxClicks = Math.max(...significantPages.map(p => p.clicks), 1);

  // Index GA4 pages by path for O(1) lookup
  const ga4Map = new Map<string, GA4TopPage>();
  for (const p of ga4Pages) {
    ga4Map.set(p.path, p);
  }

  return significantPages.map(page => {
    // Extract path from full URL for GA4 matching
    let pagePath: string;
    try {
      pagePath = new URL(page.page).pathname;
    } catch (err) {
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
  brandTokens?: string[],
): ComputedInsight<QuickWinData>[] {
  const candidates = queryPageData.filter(
    row =>
      row.position >= QUICK_WIN_MIN_POSITION &&
      row.position <= QUICK_WIN_MAX_POSITION &&
      row.impressions >= QUICK_WIN_MIN_IMPRESSIONS &&
      (!brandTokens?.length || !isBrandedQuery(row.query, brandTokens)),
  );

  // Group by page URL — keep only the highest-traffic-gain query per page so the
  // UNIQUE constraint (workspace_id, page_id, insight_type) works as intended and
  // the same page doesn't surface multiple times in the UI.
  const targetCtr = expectedCtrForPosition(3);
  const bestByPage = new Map<string, { row: QueryPageRow; gain: number }>();
  for (const row of candidates) {
    const gain = Math.max(0, Math.round(row.impressions * targetCtr - row.clicks));
    const existing = bestByPage.get(row.page);
    if (!existing || gain > existing.gain) {
      bestByPage.set(row.page, { row, gain });
    }
  }

  const results: ComputedInsight<QuickWinData>[] = Array.from(bestByPage.values()).map(({ row, gain }) => ({
    pageId: row.page, // page URL only — lets DB UNIQUE constraint deduplicate correctly
    insightType: 'ranking_opportunity',
    data: {
      query: row.query,
      currentPosition: row.position,
      impressions: row.impressions,
      estimatedTrafficGain: gain,
      pageUrl: row.page,
    },
    severity: 'opportunity' as const,
  }));

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
  brandTokens?: string[],
): ComputedInsight<CannibalizationData>[] {
  // Group rows by query, keeping only top-20 results
  const byQuery = new Map<string, QueryPageRow[]>();
  for (const row of queryPageData) {
    if (row.position > 20) continue;
    if (brandTokens?.length && isBrandedQuery(row.query, brandTokens)) continue;
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
    if (totalImpressions < 100) continue; // Skip low-visibility cannibalization — not worth acting on

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

  // Build brand token sets for each competitor domain to filter branded queries
  const brandTokensByDomain = new Map<string, string[]>();
  for (const gap of gapData) {
    if (!brandTokensByDomain.has(gap.competitorDomain)) {
      brandTokensByDomain.set(gap.competitorDomain, extractBrandTokens(gap.competitorDomain));
    }
  }

  // Build a map of our best position per query
  const ourPositions = new Map<string, number>();
  for (const row of ourQueryData) {
    const existing = ourPositions.get(row.query);
    if (!existing || row.position < existing) {
      ourPositions.set(row.query, row.position);
    }
  }

  // Filter out branded competitor queries and low-volume keywords — not actionable
  const filteredGapData = gapData.filter(gap => {
    if (gap.volume < 50) return false; // Skip keywords with negligible search volume
    const tokens = brandTokensByDomain.get(gap.competitorDomain) ?? [];
    return !isBrandedQuery(gap.keyword, tokens);
  });

  const results: ComputedInsight<CompetitorGapData>[] = filteredGapData.map(gap => {
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
    if (totalImpressions < 100) continue; // Skip low-visibility clusters — not worth strategic attention
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
): Array<{ insightType: 'ranking_mover'; pageId: string; data: RankingMoverData; severity: InsightSeverity }> {
  const prevMap = new Map<string, QueryPageRow>();
  for (const row of previousQueryPages) {
    prevMap.set(`${row.query}::${row.page}`, row);
  }

  // Collect all significant movers, then deduplicate to one entry per page URL.
  // Keeping the query with the highest impact (|positionChange| × impressions) ensures
  // the DB UNIQUE constraint (workspace_id, page_id, insight_type) works as intended.
  type MoverCandidate = { insightType: 'ranking_mover'; pageId: string; data: RankingMoverData; severity: InsightSeverity; impact: number };
  const bestByPage = new Map<string, MoverCandidate>();

  for (const curr of currentQueryPages) {
    if (curr.impressions < 50) continue; // Skip low-visibility queries — position changes are noise
    const prev = prevMap.get(`${curr.query}::${curr.page}`);
    if (!prev) continue;
    const positionChange = prev.position - curr.position; // positive = improvement
    if (Math.abs(positionChange) < 3) continue;
    const severity: InsightSeverity = positionChange < -5 ? 'critical'
      : positionChange < -3 ? 'warning'
      : positionChange > 5 ? 'positive' : 'opportunity';
    const impact = Math.abs(positionChange) * curr.impressions;
    const existing = bestByPage.get(curr.page);
    if (!existing || impact > existing.impact) {
      bestByPage.set(curr.page, {
        insightType: 'ranking_mover' as const,
        pageId: curr.page, // page URL only — lets DB UNIQUE constraint deduplicate correctly
        data: {
          query: curr.query, pageUrl: curr.page,
          currentPosition: Math.round(curr.position * 10) / 10,
          previousPosition: Math.round(prev.position * 10) / 10,
          positionChange: Math.round(positionChange * 10) / 10,
          currentClicks: curr.clicks, previousClicks: prev.clicks,
          impressions: curr.impressions,
        },
        severity,
        impact,
      });
    }
  }

  const results: Array<{ insightType: 'ranking_mover'; pageId: string; data: RankingMoverData; severity: InsightSeverity }> =
    Array.from(bestByPage.values());

  return results.sort((a, b) => {
    const aI = Math.abs(a.data.positionChange) * a.data.impressions;
    const bI = Math.abs(b.data.positionChange) * b.data.impressions;
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
): Array<{ insightType: 'ctr_opportunity'; pageId: string; data: CtrOpportunityData; severity: InsightSeverity }> {
  // Group by page URL — keep only the highest click-gap query per page so the
  // DB UNIQUE constraint (workspace_id, page_id, insight_type) works as intended.
  type CtrCandidate = { insightType: 'ctr_opportunity'; pageId: string; data: CtrOpportunityData; severity: InsightSeverity; clickGap: number };
  const bestByPage = new Map<string, CtrCandidate>();

  for (const row of queryPageData) {
    if (row.impressions < CTR_OPPORTUNITY_MIN_IMPRESSIONS) continue;
    // Only check page-1 positions (1–10) — positions beyond page 1
    // naturally have very low CTR and would produce false positives
    const roundedPos = Math.round(row.position);
    if (roundedPos < 1 || roundedPos > 10) continue;

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
    const clickGap = Math.max(0, ctrGap);
    const existing = bestByPage.get(row.page);
    if (!existing || clickGap > existing.clickGap) {
      bestByPage.set(row.page, {
        insightType: 'ctr_opportunity' as const,
        pageId: row.page, // page URL only — lets DB UNIQUE constraint deduplicate correctly
        data: {
          query: row.query,
          pageUrl: row.page,
          position: Math.round(row.position * 10) / 10,
          actualCtr: row.ctr, // already a percentage from GSC
          expectedCtr: Math.round(expectedCtr * 100 * 10) / 10, // convert decimal to percentage
          ctrRatio: Math.round(ctrRatio * 100) / 100,
          impressions: row.impressions,
          estimatedClickGap: clickGap,
        },
        severity,
        clickGap,
      });
    }
  }

  const results: Array<{ insightType: 'ctr_opportunity'; pageId: string; data: CtrOpportunityData; severity: InsightSeverity }> =
    Array.from(bestByPage.values());

  // Sort by estimated click gap descending
  return results
    .sort((a, b) => b.data.estimatedClickGap - a.data.estimatedClickGap)
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
): Array<{ insightType: 'serp_opportunity'; pageId: string; data: SerpOpportunityData; severity: InsightSeverity }> {
  const results: Array<{ insightType: 'serp_opportunity'; pageId: string; data: SerpOpportunityData; severity: InsightSeverity }> = [];

  for (const page of gscPages) {
    if (page.impressions < SERP_OPPORTUNITY_MIN_IMPRESSIONS) continue;

    // Normalise URL to pathname for schema lookup
    let pathname: string;
    try {
      pathname = new URL(page.page).pathname;
    } catch (err) {
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
    .sort((a, b) => b.data.impressions - a.data.impressions)
    .slice(0, 20);
}

// ── Orchestrator (lazy evaluation) ───────────────────────────────

const log = createLogger('analytics-intelligence');

/**
 * Get insights for a workspace, computing fresh ones if stale.
 * Lazy evaluation: only recomputes if oldest insight is >6 hours old.
 */
const PUBLIC_CAP = 25;
const MAX_PER_TYPE = 5; // prevent any single insight type from dominating the feed

/**
 * Cap insights with type diversity: at most MAX_PER_TYPE per insight type,
 * then fill remaining slots by impact score. When a specific insightType
 * filter is requested, skip diversity (return up to PUBLIC_CAP of that type).
 */
function capWithDiversity(insights: AnalyticsInsight[], typeFilter?: InsightType): AnalyticsInsight[] {
  if (typeFilter) return insights.slice(0, PUBLIC_CAP);

  // Already sorted by impact_score DESC from the DB query
  const result: AnalyticsInsight[] = [];
  const typeCounts = new Map<string, number>();

  // First pass: take up to MAX_PER_TYPE of each type (highest impact first)
  for (const insight of insights) {
    if (result.length >= PUBLIC_CAP) break;
    const count = typeCounts.get(insight.insightType) ?? 0;
    if (count < MAX_PER_TYPE) {
      result.push(insight);
      typeCounts.set(insight.insightType, count + 1);
    }
  }

  // Second pass: if we still have capacity, backfill from skipped insights
  if (result.length < PUBLIC_CAP) {
    const selected = new Set(result.map(r => r.id));
    for (const insight of insights) {
      if (result.length >= PUBLIC_CAP) break;
      if (!selected.has(insight.id)) {
        result.push(insight);
      }
    }
  }

  return result;
}

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

// ── Content Decay Insight Refresh ────────────────────────────────
// Lightweight refresh of just the content_decay insight type.
// Called after analyzeContentDecay() to immediately sync the insights
// cache with fresh decay data, avoiding the 24-hour staleness window.

const MIN_DECAY_BASELINE_CLICKS = 20;
const MIN_DECAY_ABSOLUTE_LOSS = 5;

export async function refreshContentDecayInsights(workspaceId: string): Promise<void> {
  const decayAnalysis = loadDecayAnalysis(workspaceId);
  const cycleStart = new Date().toISOString();

  if (decayAnalysis && decayAnalysis.decayingPages.length > 0) {
    const enrichCtx = await buildEnrichmentContext(workspaceId);

    const significantDecay = decayAnalysis.decayingPages.filter(p =>
      p.previousClicks >= MIN_DECAY_BASELINE_CLICKS &&
      Math.abs(p.previousClicks - p.currentClicks) >= MIN_DECAY_ABSOLUTE_LOSS
    );

    for (const page of significantDecay) {
      const severity: InsightSeverity =
        page.severity === 'critical' ? 'critical'
        : page.severity === 'warning' ? 'warning'
        : 'opportunity';
      const enrichment = enrichInsight(
        { pageId: page.page, insightType: 'content_decay' as InsightType, severity, data: { baselineClicks: page.previousClicks, currentClicks: page.currentClicks, deltaPercent: page.clickDeclinePct, baselinePeriod: 'previous_30d', currentPeriod: 'current_30d' } },
        enrichCtx,
      );
      const { data: _enrichedData, ...enrichmentRest } = enrichment;
      upsertInsight({
        ...enrichmentRest,
        workspaceId,
        pageId: page.page,
        insightType: 'content_decay',
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

    log.info({ workspaceId, count: significantDecay.length }, 'Refreshed content decay insights from fresh analysis');
  }

  // Prune stale decay insights that were not updated in this cycle
  deleteStaleInsightsByType(workspaceId, 'content_decay', cycleStart);

  // Run the same quality gate as the full computation path to suppress
  // contradictory, duplicate, and low-confidence insights.
  validateInsightBatch(workspaceId);
}

// ── Insight Validation Pass ──────────────────────────────────────
// Deterministic quality gate: suppress contradictory, duplicate, and
// low-confidence insights AFTER computation, BEFORE feedback loops.

/** Severity rank for comparison — higher = stronger signal */
const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  warning: 3,
  opportunity: 2,
  positive: 1,
};

/** Minimum impressions for a ranking_opportunity to be considered actionable */
const MIN_RANKING_OPP_IMPRESSIONS = 100;

/** Minimum absolute click loss for content_decay to be considered actionable */
const MIN_DECAY_CLICK_LOSS = 10;

/** Minimum estimated traffic gain for a ranking_opportunity to survive validation */
const MIN_RANKING_OPP_TRAFFIC_GAIN = 5;

/** Minimum estimated click gap for a ctr_opportunity to survive validation */
const MIN_CTR_OPP_CLICK_GAP = 5;

/**
 * Contradiction pairs: when the same page appears under both insight types,
 * suppress the weaker signal (lower severity, then lower impactScore).
 */
const CONTRADICTION_PAIRS: ReadonlyArray<[InsightType, InsightType]> = [
  ['ranking_opportunity', 'content_decay'],
  ['ctr_opportunity', 'content_decay'],
];

/**
 * Pick the weaker insight from a pair based on severity rank, then impactScore.
 * Returns the id of the insight to suppress, or null if they're equal.
 */
function pickWeaker(a: AnalyticsInsight, b: AnalyticsInsight): string | null {
  const rankA = SEVERITY_RANK[a.severity] ?? 0;
  const rankB = SEVERITY_RANK[b.severity] ?? 0;
  if (rankA !== rankB) return rankA < rankB ? a.id : b.id;
  const scoreA = a.impactScore ?? 0;
  const scoreB = b.impactScore ?? 0;
  if (scoreA !== scoreB) return scoreA < scoreB ? a.id : b.id;
  return null; // truly equal — don't suppress either
}

export function validateInsightBatch(workspaceId: string): number {
  const allInsights = getInsights(workspaceId);
  if (allInsights.length === 0) return 0;

  const toSuppress = new Set<string>();

  // Build lookup: pageId → insights on that page
  // Skip resolved and bridge-sourced insights — they are protected from background cleanup
  // (mirrors the deleteStaleByType guard: resolution_status IS NULL AND bridge_source IS NULL).
  const byPage = new Map<string, AnalyticsInsight[]>();
  const protectedIds = new Set<string>();
  for (const insight of allInsights) {
    if (insight.resolutionStatus === 'resolved' || insight.resolutionStatus === 'in_progress' || insight.bridgeSource) {
      protectedIds.add(insight.id);
      continue;
    }
    if (!insight.pageId) continue;
    const list = byPage.get(insight.pageId);
    if (list) list.push(insight);
    else byPage.set(insight.pageId, [insight]);
  }

  // ── Rule 1: Contradiction suppression ──────────────────────────
  for (const [typeA, typeB] of CONTRADICTION_PAIRS) {
    for (const [, insights] of byPage) {
      const a = insights.find(i => i.insightType === typeA && !toSuppress.has(i.id));
      const b = insights.find(i => i.insightType === typeB && !toSuppress.has(i.id));
      if (a && b) {
        const weakerId = pickWeaker(a, b);
        if (weakerId) toSuppress.add(weakerId);
      }
    }
  }

  // ── Rule 2: Severity clash on same page ────────────────────────
  // If the same page has both a 'positive' and a 'critical' insight,
  // suppress the positive one (the critical signal takes priority).
  for (const [, insights] of byPage) {
    const positives = insights.filter(i => i.severity === 'positive' && !toSuppress.has(i.id));
    const criticals = insights.filter(i => i.severity === 'critical' && !toSuppress.has(i.id));
    if (positives.length > 0 && criticals.length > 0) {
      for (const p of positives) toSuppress.add(p.id);
    }
  }

  // ── Rule 3: Low-confidence suppression ─────────────────────────
  for (const insight of allInsights) {
    if (toSuppress.has(insight.id) || protectedIds.has(insight.id)) continue;

    if (insight.insightType === 'ranking_opportunity') {
      const d = (insight as AnalyticsInsight<'ranking_opportunity'>).data;
      if (d.impressions < MIN_RANKING_OPP_IMPRESSIONS || d.estimatedTrafficGain < MIN_RANKING_OPP_TRAFFIC_GAIN) {
        toSuppress.add(insight.id);
      }
    }

    if (insight.insightType === 'content_decay') {
      const d = (insight as AnalyticsInsight<'content_decay'>).data;
      if (Math.abs(d.baselineClicks - d.currentClicks) < MIN_DECAY_CLICK_LOSS) {
        toSuppress.add(insight.id);
      }
    }

    if (insight.insightType === 'ctr_opportunity') {
      const d = (insight as AnalyticsInsight<'ctr_opportunity'>).data;
      if (d.estimatedClickGap < MIN_CTR_OPP_CLICK_GAP) {
        toSuppress.add(insight.id);
      }
    }
  }

  // ── Execute suppression ────────────────────────────────────────
  const ids = Array.from(toSuppress);
  const deleted = suppressInsights(workspaceId, ids);
  if (deleted > 0) {
    log.info({ workspaceId, suppressed: deleted }, 'Insight validation pass: suppressed contradictory/low-confidence insights');
  }
  return deleted;
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
  const [gscPages, queryPageData, ga4Pages, _previousGscPages, previousQueryPageData] = await Promise.all([
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
          : await provider.getCompetitors(ws.liveDomain, workspaceId, 3).then(c => c.map(e => e.domain)).catch(() => []);

        if (competitors.length > 0) {
          const gapData = await apiCache.wrap(workspaceId, 'keywordGap', { competitors }, () =>
            provider.getKeywordGap(ws.liveDomain!, competitors, workspaceId, 50),
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
            deleteStaleInsightsByType(workspaceId, 'competitor_gap', cycleStart);
            log.info({ workspaceId, count: Math.min(gapInsights.length, 30) }, 'Computed competitor gap insights');
          }
        }
      }
    } catch (err) {
      log.warn({ err, workspaceId }, 'Failed to compute competitor gap insights');
    }
  }

  // Phase 5: Emerging keyword detection (SEMRush trend analysis)
  if (ws.liveDomain) {
    try {
      const provider = getConfiguredProvider(ws.seoDataProvider);
      if (provider?.isConfigured()) {
        const domainKws = await apiCache.wrap(workspaceId, 'domainKeywords_emerging', {}, () =>
          provider.getDomainKeywords(ws.liveDomain!, workspaceId, 200),
        );
        const gscLookup = new Map<string, number>(
          normQueryPageData.map(r => [r.query.toLowerCase(), r.position]),
        );
        const emerging = domainKws.filter(
          kw => kw.volume >= 100 && isKeywordEmerging({ trend: kw.trend }),
        );
        for (const kw of emerging.slice(0, 10)) {
          const currentPosition = gscLookup.get(kw.keyword.toLowerCase());
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
    // Always prune stale emerging_keyword rows — even when the provider is unconfigured
    // (avoids orphaning rows from a previous run when the provider is later removed)
    deleteStaleInsightsByType(workspaceId, 'emerging_keyword', cycleStart);
  }

  // Phase 6: Content freshness alerts — flag pages with stale keyword analysis + meaningful traffic
  {
    const STALE_DAYS = 90;
    const MIN_IMPRESSIONS = 100;
    try {
      const pageKws = listPageKeywords(workspaceId);
      const now = Date.now();
      const stale = pageKws.filter(p => {
        if (!p.analysisGeneratedAt) return false;
        const lastAnalyzedMs = new Date(p.analysisGeneratedAt).getTime();
        if (isNaN(lastAnalyzedMs)) return false;
        const daysSince = Math.floor((now - lastAnalyzedMs) / 86_400_000);
        return daysSince >= STALE_DAYS && (p.impressions ?? 0) >= MIN_IMPRESSIONS;
      });
      for (const p of stale) {
        const lastAnalyzedMs = new Date(p.analysisGeneratedAt!).getTime();
        const daysSince = Math.floor((now - lastAnalyzedMs) / 86_400_000);
        enrichAndUpsert({
          insightType: 'freshness_alert',
          pageId: p.pagePath,
          data: {
            pagePath: p.pagePath,
            lastAnalyzedAt: p.analysisGeneratedAt!,
            daysSinceLastAnalysis: daysSince,
            impressions: p.impressions,
            clicks: p.clicks,
          } satisfies import('../shared/types/analytics.js').FreshnessAlertData,
          severity: daysSince > 180 ? 'critical' : 'warning',
        });
      }
      deleteStaleInsightsByType(workspaceId, 'freshness_alert', cycleStart);
      log.info({ workspaceId, count: stale.length }, 'Computed content freshness alerts');
    } catch (err) {
      log.warn({ err, workspaceId }, 'Failed to compute content freshness alerts');
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
            data: insight.data,
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
    deleteStaleInsightsByType(workspaceId, 'ranking_mover', cycleStart);
    log.info({ workspaceId, count: movers.length }, 'Computed ranking movers');
  }

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
    deleteStaleInsightsByType(workspaceId, 'ctr_opportunity', cycleStart);
    log.info({ workspaceId, count: ctrOpps.length }, 'Computed CTR opportunities');
  }

  if (normGscPages.length > 0) {
    // Load pages that already have schema markup from the DB (graceful fallback)
    let pagesWithSchema = new Set<string>();
    try {
      const schemaDb = await import('./db/index.js'); // dynamic-import-ok — circular dep prevention, default export is typed
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
    deleteStaleInsightsByType(workspaceId, 'serp_opportunity', cycleStart);
    log.info({ workspaceId, count: serpOpps.length }, 'Computed SERP opportunities');
  }

  // Quality gate: suppress contradictory/duplicate/low-confidence insights
  validateInsightBatch(workspaceId);

  // Phase 2 feedback loops: push signals to Strategy & Pipeline
  // Non-fatal — runFeedbackLoops has its own try/catch
  runFeedbackLoops(workspaceId);
}
