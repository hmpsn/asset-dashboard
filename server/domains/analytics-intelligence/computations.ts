import type { SearchPage, QueryPageRow } from '../../search-console.js';
import type { GA4TopPage, GA4LandingPage } from '../../google-analytics.js';
import type {
  InsightSeverity,
  PageHealthData,
  QuickWinData,
  CannibalizationData,
  ConversionAttributionData,
  CompetitorGapData,
  KeywordClusterData,
  RankingMoverData,
  CtrOpportunityData,
  SerpOpportunityData,
  SerpFeatureOpportunityData,
  FreshnessAlertData,
} from '../../../shared/types/analytics.js';
import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import { extractBrandTokens, isBrandedQuery } from '../../competitor-brand-filter.js';
import { isFeatureEnabled } from '../../feature-flags.js';
import { normalizePageUrl, toInsightPageId } from '../../helpers.js';
import { getLatestSerpSnapshots } from '../../serp-snapshots-store.js';
import { listTrackedKeywordRows } from '../../tracked-keywords-store.js';
import { industryCtr } from '../../scoring/ctr-curve.js';
import type { ComputedInsight } from './types.js';

// ── Expected CTR by position (canonical industry curve) ──────────

export function expectedCtrForPosition(pos: number): number {
  return industryCtr(pos);
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

const FRESHNESS_STALE_DAYS = 90;
const FRESHNESS_CRITICAL_DAYS = 180;
const FRESHNESS_MIN_IMPRESSIONS = 100;

interface FreshnessInputPage {
  pagePath: string;
  analysisGeneratedAt?: string;
  impressions?: number;
  clicks?: number;
}

export function computeFreshnessAlerts(
  pages: FreshnessInputPage[],
  nowMs: number = Date.now(),
): ComputedInsight<FreshnessAlertData>[] {
  const insights: ComputedInsight<FreshnessAlertData>[] = [];
  for (const page of pages) {
    if (!page.analysisGeneratedAt) continue;
    const lastAnalyzedMs = new Date(page.analysisGeneratedAt).getTime();
    if (Number.isNaN(lastAnalyzedMs)) continue;
    const daysSince = Math.floor((nowMs - lastAnalyzedMs) / 86_400_000);
    if (daysSince < FRESHNESS_STALE_DAYS) continue;
    if ((page.impressions ?? 0) < FRESHNESS_MIN_IMPRESSIONS) continue;
    insights.push({
      pageId: page.pagePath,
      insightType: 'freshness_alert',
      data: {
        pagePath: page.pagePath,
        lastAnalyzedAt: page.analysisGeneratedAt,
        daysSinceLastAnalysis: daysSince,
        impressions: page.impressions,
        clicks: page.clicks,
      },
      severity: daysSince > FRESHNESS_CRITICAL_DAYS ? 'critical' : 'warning',
    });
  }
  return insights;
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
    const pagePath = normalizePageUrl(page.page);

    const ga4 = ga4Map.get(pagePath);
    const ga4Available = !!ga4;
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
    const engagementScore = ga4Available
      ? Math.min(25, 25 * Math.min(avgEngagement, 180) / 180)
      : 0;

    const rawScore = posScore + trafficScore + ctrScore + engagementScore;
    const availableMaxScore = ga4Available ? 100 : 75;
    const score = Math.round((rawScore / availableMaxScore) * 100);

    let severity: InsightSeverity;
    if (score >= 70) severity = 'positive';
    else if (score >= 40) severity = 'opportunity';
    else if (score >= 20) severity = 'warning';
    else severity = 'critical';

    return {
      pageId: toInsightPageId(page.page),
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
        ga4Available,
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
    pageId: toInsightPageId(row.page),
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
export function wordJaccard(a: string, b: string): number {
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
        pageId: toInsightPageId(curr.page),
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

// ── SERP Feature Opportunities (P6, national-serp-tracking) ──────────

/**
 * Rough fraction of a keyword's monthly search volume realized as feature
 * captures (AI-Overview citations / featured-snippet clicks) once the client
 * owns the feature. A single sane heuristic — not a calibrated model.
 */
const SERP_FEATURE_CITATION_RATE = 0.15;

/**
 * From the latest national-SERP snapshots, flag tracked keywords whose live SERP
 * shows a high-value feature (AI Overview present-but-not-cited, OR a featured
 * snippet) that the client ranks for but is NOT capturing.
 *
 * Fires ONLY when the snapshot has BOTH a matched (ranking) URL AND a position —
 * the "doesn't rank at all" case stays owned by existing insight types. pageId is
 * the real matchedUrl (never null) so enrichment resolves the page. severity is
 * always 'opportunity'.
 *
 * NO-OP (returns []) when the national-serp-tracking flag is OFF, so OFF is
 * byte-identical to the pre-P6 cycle.
 */
export function computeSerpFeatureOpportunities(
  workspaceId: string,
): Array<{ insightType: 'serp_feature_opportunity'; pageId: string; data: SerpFeatureOpportunityData; severity: InsightSeverity }> {
  // Flag-gated server-side: OFF → no-op (byte-identical to pre-P6).
  if (!isFeatureEnabled('national-serp-tracking', workspaceId)) return [];

  const snapshots = getLatestSerpSnapshots(workspaceId);
  if (snapshots.length === 0) return [];

  // volume lookup by normalized keyword (snapshot.query is already normalized at write).
  const volumeMap = new Map<string, number>();
  for (const kw of listTrackedKeywordRows(workspaceId)) {
    volumeMap.set(keywordComparisonKey(kw.query), kw.volume ?? 0);
  }

  const results: Array<{ insightType: 'serp_feature_opportunity'; pageId: string; data: SerpFeatureOpportunityData; severity: InsightSeverity }> = [];

  for (const snap of snapshots) {
    // Requires a real ranking URL + position — "doesn't rank" stays owned elsewhere.
    if (!snap.matchedUrl || snap.position == null) continue;

    // Fire ONLY on the ownership-guarded flagship signal: an AI Overview is present and does NOT
    // cite the client. A featured-snippet trigger is deliberately NOT used — the parser records
    // snippet PRESENCE but not its owning domain, so presence alone cannot distinguish "a snippet
    // we could win" from "a snippet we already hold", and firing on it produces a false "capture
    // the result you already own" insight. Featured-snippet capture is deferred until the parser
    // tracks snippet ownership (P7); it still surfaces informationally via presentFeatures/badges.
    const aiOverviewOpportunity = snap.aiOverviewPresent === true && snap.aiOverviewCited === false;
    if (!aiOverviewOpportunity) continue;

    const volume = volumeMap.get(keywordComparisonKey(snap.query)) ?? 0;
    results.push({
      insightType: 'serp_feature_opportunity' as const,
      // Normalize to the bare pathname so this insight's page_id matches every other page-keyed
      // insight for the same physical page (grouping/enrichment consistency). Never null here.
      pageId: toInsightPageId(snap.matchedUrl),
      data: {
        keyword: snap.query,
        matchedUrl: snap.matchedUrl,
        currentPosition: snap.position,
        presentFeatures: snap.features,
        aiOverviewPresent: snap.aiOverviewPresent === true,
        aiOverviewCited: !!snap.aiOverviewCited,
        estimatedMonthlyCitations: Math.round(volume * SERP_FEATURE_CITATION_RATE),
      },
      severity: 'opportunity',
    });
  }

  // Highest estimated upside first.
  return results.sort((a, b) => b.data.estimatedMonthlyCitations - a.data.estimatedMonthlyCitations);
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
        pageId: toInsightPageId(row.page),
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
    const pathname = normalizePageUrl(page.page);

    if (pagesWithSchema.has(pathname) || pagesWithSchema.has(page.page)) continue;

    const severity: InsightSeverity = page.impressions >= 5000 ? 'warning' : 'opportunity';

    results.push({
      insightType: 'serp_opportunity' as const,
      pageId: toInsightPageId(page.page),
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
