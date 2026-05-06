import type { AnalyticsInsight } from '../shared/types/analytics.js';
import type { Workspace } from '../shared/types/workspace.js';

/** Composite opportunity score (0–100) for a content gap.
 * Weighted components of the raw score (pre-trend):
 * - volume: vol/10000 capped at 1.0, × 0.45 → up to 0.45
 * - ease: (1 − difficulty/100), × 0.45 → up to 0.45
 * - GSC bonus: impressions/2000 capped at 0.5, × 0.1 → up to 0.05
 * Max raw = 0.95 (the 5% headroom is intentional — GSC signal is an additive
 * bonus on top of volume/ease, not a co-equal component).
 * Trend multiplier: rising ×1.3, declining ×0.7, stable ×1.0.
 * Returns undefined when no signal data is present. */
export function computeOpportunityScore(cg: {
  volume?: number;
  difficulty?: number;
  impressions?: number;
  trendDirection?: string;
}): number | undefined {
  const hasData = (cg.volume != null && cg.volume > 0)
    || cg.difficulty != null
    || (cg.impressions != null && cg.impressions > 0);
  if (!hasData) return undefined;
  const vol = Math.min((cg.volume ?? 0) / 10000, 1);
  const ease = 1 - (cg.difficulty ?? 50) / 100;
  const gscBonus = Math.min((cg.impressions ?? 0) / 2000, 0.5);
  const trendMult =
    cg.trendDirection === 'rising' ? 1.3 :
    cg.trendDirection === 'declining' ? 0.7 : 1.0;
  const raw = (vol * 0.45 + ease * 0.45 + gscBonus * 0.1) * trendMult;
  return Math.min(100, Math.round(raw * 100));
}

export const INCREMENTAL_THRESHOLD_DAYS = 7;
const COMPETITOR_CACHE_DAYS = 7;

/**
 * Split pages into those needing AI analysis vs those with fresh analysis.
 * In full mode all pages go to toAnalyze.
 * In incremental mode only pages with no analysisGeneratedAt or a stale one
 * go to toAnalyze; the rest go to toPreserve.
 */
export function getPagesNeedingAnalysis<T extends { path: string }>(
  allPages: T[],
  mode: 'full' | 'incremental',
  existingByPath: Map<string, { analysisGeneratedAt?: string | null }>,
): { toAnalyze: T[]; toPreserve: T[] } {
  if (mode === 'full') {
    return { toAnalyze: allPages, toPreserve: [] };
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - INCREMENTAL_THRESHOLD_DAYS);
  const cutoffIso = cutoff.toISOString();

  const toAnalyze: T[] = [];
  const toPreserve: T[] = [];
  for (const page of allPages) {
    const existing = existingByPath.get(page.path);
    const genAt = existing?.analysisGeneratedAt;
    if (!genAt || genAt < cutoffIso) {
      toAnalyze.push(page);
    } else {
      toPreserve.push(page);
    }
  }
  return { toAnalyze, toPreserve };
}

export function shouldFetchCompetitorData(ws: Workspace, currentDomains?: string[]): boolean {
  if (!ws.competitorLastFetchedAt) return true;

  if (ws.competitorDomainsAtLastFetch !== null && ws.competitorDomainsAtLastFetch !== undefined) {
    const current = (currentDomains ?? ws.competitorDomains ?? []).slice().sort().join(',');
    const lastFetchDomains = ws.competitorDomainsAtLastFetch.slice().sort().join(',');
    if (current !== lastFetchDomains) return true;
  }

  const cutoff = new Date(Date.now() - COMPETITOR_CACHE_DAYS * 24 * 60 * 60 * 1000);
  if (new Date(ws.competitorLastFetchedAt) < cutoff) return true;

  return false;
}

interface StrategyIntelligenceInput {
  keywordClusters?: Array<{
    label: string;
    queries: string[];
    totalImpressions: number;
    avgPosition: number;
    pillarPage: string | null;
  }>;
  competitorGaps?: Array<{
    keyword: string;
    competitorDomain: string;
    competitorPosition: number;
    ourPosition: number | null;
    volume: number;
    difficulty: number;
  }>;
  performanceDeltas?: Array<{
    query: string;
    positionDelta: number;
    clicksDelta: number;
    currentPosition: number;
  }>;
  conversionPages?: Array<{
    pageUrl: string;
    conversions: number;
    conversionRate: number;
    sessions: number;
  }>;
  contentDecay?: Array<{
    pageId: string;
    clicksDelta: number;
    deltaPercent: number;
  }>;
  cannibalization?: Array<AnalyticsInsight<'cannibalization'>>;
  ctrOpportunities?: Array<AnalyticsInsight<'ctr_opportunity'>>;
  rankingOpportunities?: Array<AnalyticsInsight<'ranking_opportunity'>>;
}

/**
 * Build an intelligence block for the strategy generation prompt.
 * Injects keyword clusters, competitor gaps, performance deltas,
 * and conversion data to improve AI strategy output.
 */
export function buildStrategyIntelligenceBlock(opts: StrategyIntelligenceInput): string {
  const sections: string[] = [];

  if (opts.keywordClusters && opts.keywordClusters.length > 0) {
    const lines = opts.keywordClusters.slice(0, 10).map(c => {
      let pillar = '';
      if (c.pillarPage) {
        try { pillar = ` → pillar: ${new URL(c.pillarPage).pathname}`; } catch (err) { pillar = ` → pillar: ${c.pillarPage}`; }
      }
      return `  "${c.label}" (${c.queries.length} queries, ${c.totalImpressions} imp, avg pos ${Math.round(c.avgPosition)})${pillar}`;
    });
    sections.push(`KEYWORD CLUSTERS (topic groups discovered from GSC queries — use these to inform site keyword themes and content gap topics):\n${lines.join('\n')}`);
  }

  if (opts.competitorGaps && opts.competitorGaps.length > 0) {
    const lines = opts.competitorGaps.slice(0, 15).map(g => {
      const ours = g.ourPosition != null ? `our pos ${Math.round(g.ourPosition)}` : 'not ranking';
      return `  "${g.keyword}" — ${g.competitorDomain} pos ${g.competitorPosition}, vol ${g.volume}, diff ${g.difficulty} (${ours})`;
    });
    sections.push(`COMPETITOR GAPS (high-priority keywords competitors rank for — prioritize these in contentGaps):\n${lines.join('\n')}`);
  }

  if (opts.performanceDeltas && opts.performanceDeltas.length > 0) {
    const lines = opts.performanceDeltas.slice(0, 10).map(d => {
      const posDir = d.positionDelta > 0 ? `↓${d.positionDelta} pos` : `↑${Math.abs(d.positionDelta)} pos`;
      return `  "${d.query}": ${posDir}, ${d.clicksDelta > 0 ? '+' : ''}${d.clicksDelta} clicks (now pos ${Math.round(d.currentPosition)})`;
    });
    sections.push(`PERFORMANCE CHANGES (keywords with significant position/click changes — declining keywords need defensive strategy):\n${lines.join('\n')}`);
  }

  if (opts.contentDecay && opts.contentDecay.length > 0) {
    const lines = opts.contentDecay.slice(0, 10).map(d => {
      const pctStr = d.deltaPercent != null ? ` (${d.deltaPercent > 0 ? '+' : ''}${Math.round(d.deltaPercent)}%)` : '';
      return `  ${d.pageId}: ${d.clicksDelta > 0 ? '+' : ''}${d.clicksDelta} clicks${pctStr}`;
    });
    sections.push(`CONTENT DECAY (pages losing organic clicks — consider refreshing content or updating keyword targeting):\n${lines.join('\n')}`);
  }

  if (opts.cannibalization && opts.cannibalization.length > 0) {
    const lines = opts.cannibalization.slice(0, 8).map(i => {
      const pages = i.data.pages.length > 0 ? i.data.pages.join(' vs ') : (i.pageId ?? 'unknown pages');
      return `  "${i.data.query}" → ${pages} (${i.data.totalImpressions} imp)`;
    });
    sections.push(`CANNIBALIZATION WARNINGS (multiple pages competing for the same query — avoid creating new overlapping content):\n${lines.join('\n')}`);
  }

  if (opts.ctrOpportunities && opts.ctrOpportunities.length > 0) {
    const lines = opts.ctrOpportunities.slice(0, 8).map(i => {
      return `  "${i.data.query}" → ${i.data.pageUrl}: CTR ${i.data.actualCtr}% vs expected ${i.data.expectedCtr}% (${Math.round(i.data.estimatedClickGap)} click gap)`;
    });
    sections.push(`CTR OPPORTUNITIES (below-expected click-through rate — quick wins via title/meta optimization):\n${lines.join('\n')}`);
  }

  if (opts.rankingOpportunities && opts.rankingOpportunities.length > 0) {
    const lines = opts.rankingOpportunities.slice(0, 8).map(i => {
      return `  "${i.data.query}" → ${i.data.pageUrl}: position ${Math.round(i.data.currentPosition)}, estimated gain ${Math.round(i.data.estimatedTrafficGain)} clicks`;
    });
    sections.push(`RANKING OPPORTUNITIES (positions 4-20 — small improvements could reach page 1):\n${lines.join('\n')}`);
  }

  if (opts.conversionPages && opts.conversionPages.length > 0) {
    const lines = opts.conversionPages.slice(0, 10).map(c => {
      let path: string;
      try { path = new URL(c.pageUrl).pathname; } catch (err) { path = c.pageUrl; }
      return `  ${path}: ${c.conversionRate.toFixed(1)}% CVR, ${c.conversions} conversions (${c.sessions} sessions)`;
    });
    sections.push(`CONVERSION DATA (pages driving business outcomes — protect and prioritize keywords for these "money pages"):\n${lines.join('\n')}`);
  }

  if (sections.length === 0) return '';
  return `\nANALYTICS INTELLIGENCE (from computed intelligence layer — use to inform strategy decisions):\n\n${sections.join('\n\n')}\n`;
}
