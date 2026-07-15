import type { AnalyticsInsight } from '../shared/types/analytics.js';
import { isKeywordSearchIntent, type KeywordSearchIntent, type KeywordSourceEvidence } from '../shared/types/keywords.js';
import type { Workspace } from '../shared/types/workspace.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';

export interface KeywordPoolCandidate {
  volume: number;
  difficulty: number;
  source: string;
  /** Provider-grounded CPC. Zero means the provider returned no usable commercial value. */
  cpc?: number;
  cpcSource?: string;
  /** Provider-grounded search intent; preserved independently from demand/source upgrades. */
  intent?: KeywordSearchIntent;
  intentSource?: string;
}

function keywordPoolSourcePriority(source: string): number {
  if (source.startsWith('gap:')) return 6;
  if (source.startsWith('competitor:')) return 5;
  if (source === 'dataforseo' || source === 'semrush' || source === 'seo-provider') return 4;
  if (source.startsWith('discovery:')) return 3;
  if (source === 'related') return 2;
  if (source === 'gsc') return 1;
  if (source === 'client') return 0;
  return 1;
}

export function upsertKeywordPoolCandidate(
  pool: Map<string, KeywordPoolCandidate>,
  keyword: string,
  candidate: KeywordPoolCandidate,
): boolean {
  const normalized = keywordComparisonKey(keyword);
  if (!normalized) return false;
  const usableCpc = candidate.cpc != null && Number.isFinite(candidate.cpc) && candidate.cpc > 0;
  const usableIntent = isKeywordSearchIntent(candidate.intent);
  candidate = {
    ...candidate,
    cpc: usableCpc ? candidate.cpc : undefined,
    cpcSource: usableCpc ? (candidate.cpcSource ?? candidate.source) : undefined,
    intent: usableIntent ? candidate.intent : undefined,
    intentSource: usableIntent ? (candidate.intentSource ?? candidate.source) : undefined,
  };

  const existing = pool.get(normalized);
  if (!existing) {
    pool.set(normalized, candidate);
    return true;
  }

  const existingPriority = keywordPoolSourcePriority(existing.source);
  const candidatePriority = keywordPoolSourcePriority(candidate.source);
  const shouldUpgrade = candidatePriority > existingPriority
    || (candidatePriority === existingPriority && candidate.volume > existing.volume)
    || (existing.source === 'gsc' && candidate.volume > 0 && candidate.source !== 'gsc');

  const candidateHasUsableCpc = candidate.cpc != null && candidate.cpc > 0;
  const existingHasUsableCpc = existing.cpc != null && existing.cpc > 0;
  const mergedCpc = candidateHasUsableCpc
    && (!existingHasUsableCpc || candidatePriority > existingPriority)
    ? candidate.cpc
    : existing.cpc ?? candidate.cpc;
  const mergedIntent = candidate.intent != null
    && (existing.intent == null || candidatePriority > existingPriority)
    ? candidate.intent
    : existing.intent;

  if (!shouldUpgrade) {
    if (mergedCpc !== existing.cpc || mergedIntent !== existing.intent) {
      pool.set(normalized, {
        ...existing,
        cpc: mergedCpc,
        cpcSource: mergedCpc === candidate.cpc ? candidate.cpcSource : existing.cpcSource,
        intent: mergedIntent,
        intentSource: mergedIntent === candidate.intent ? candidate.intentSource : existing.intentSource,
      });
    }
    return false;
  }
  pool.set(normalized, {
    ...candidate,
    cpc: mergedCpc,
    cpcSource: mergedCpc === candidate.cpc ? candidate.cpcSource : existing.cpcSource,
    intent: mergedIntent,
    intentSource: mergedIntent === candidate.intent ? candidate.intentSource : existing.intentSource,
  });
  return true;
}

/**
 * Volume floor for admitting a KD-0 (zero-difficulty) discovery long-tail keyword
 * on the canonical SEO generation-quality path. Mirrors the existing
 * `shouldIncludeKeywordCandidate` provider-volume threshold (>= 10) so a real
 * low-competition long-tail survives but barely-measurable noise does not.
 */
export const STRATEGY_QUALITY_KD_ZERO_VOLUME_FLOOR = 10;

/**
 * @param relaxConservatism Enables the canonical generation-quality relaxation.
 *   `false`: legacy gate `difficulty > 0`.
 *   `true`: `difficulty >= 0` so KD-0 long-tail survives, behind a volume floor
 *   (`STRATEGY_QUALITY_KD_ZERO_VOLUME_FLOOR`) so real low-competition long-tail is kept.
 */
export function isStrategyQualityDiscoveryKeyword(keyword: KeywordSourceEvidence, relaxConservatism = false): boolean {
  if (keyword.keyword.trim().length === 0 || keyword.volume <= 0) return false;
  if (keyword.difficulty > 0) return true;
  // difficulty === 0 (or negative, defensively): legacy path rejects; relaxed mode admits
  // when the keyword clears the volume floor.
  return relaxConservatism && keyword.difficulty >= 0 && keyword.volume >= STRATEGY_QUALITY_KD_ZERO_VOLUME_FLOOR;
}

const PLANNER_GROUPED_VOLUME_FLOOR = 1_000_000;

export function isSuspiciousPlannerGroupedVolume(keyword: string | undefined, volume: number | undefined | null): boolean {
  if (volume == null || volume < PLANNER_GROUPED_VOLUME_FLOOR) return false;
  // DataForSEO Google Ads search-volume lookups can return planner-grouped
  // buckets. A million-volume value on strategy-assigned page keywords is more
  // likely a grouped forecast than a granular SEO signal, so callers should
  // prefer organic/ranking evidence or leave volume unknown.
  return !!keyword?.trim();
}

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

/**
 * SEO Generation Quality P2 — owner-approved soft floor for the deterministic
 * content-gap backfill. After pruning, when flag-ON and the kept gap count falls
 * below this floor, the highest-scoring pruned/penalized candidates are re-admitted
 * (ordered by score) and tagged `backfilled = true` until the floor is met. If
 * fewer than this many real candidates exist, we admit what is available (never
 * fabricate).
 */
export const STRATEGY_CONTENT_GAP_FLOOR = 6;

/** Minimal candidate shape the backfill operates on (subset of StrategyContentGap/ContentGap). */
export interface BackfillContentGapCandidate {
  targetKeyword: string;
  volume?: number;
  difficulty?: number;
  impressions?: number;
  trendDirection?: string;
  opportunityScore?: number;
  backfilled?: boolean;
}

/**
 * Deterministically re-admit pruned/penalized content-gap candidates so a sparse
 * workspace can never silently ship below the soft floor (default 6). No AI.
 *
 * - `kept`: the content gaps that survived pruning (kept order/scores untouched).
 * - `pruned`: candidates removed by the page-coverage prune, ordered here by their
 *   computed opportunity score (highest first) and de-duplicated against kept +
 *   against each other by normalized target keyword.
 * - Re-admits the top candidates (tagged `backfilled: true`) until `floor` is met
 *   or candidates run out — whichever comes first (admits what is available).
 *
 * Returns the combined list and how many were re-admitted; `floorHit` is true when
 * any backfill occurred. The function is pure: callers gate it behind the flag.
 */
export function backfillContentGapsToFloor<T extends BackfillContentGapCandidate>(
  kept: T[],
  pruned: T[],
  floor: number = STRATEGY_CONTENT_GAP_FLOOR,
): { gaps: T[]; backfilledCount: number; floorHit: boolean } {
  if (kept.length >= floor || pruned.length === 0) {
    return { gaps: kept, backfilledCount: 0, floorHit: false };
  }
  const seen = new Set(kept.map(g => keywordComparisonKey(g.targetKeyword)).filter(Boolean));
  const scored = pruned
    .map(candidate => ({
      candidate,
      key: keywordComparisonKey(candidate.targetKeyword),
      score: candidate.opportunityScore ?? computeOpportunityScore(candidate) ?? 0,
    }))
    .filter(entry => entry.key && !seen.has(entry.key))
    // Highest score first; deterministic tiebreak on normalized keyword so the
    // result is stable run-to-run (no Map/insertion-order dependence).
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  const need = floor - kept.length;
  const admitted: T[] = [];
  for (const entry of scored) {
    if (admitted.length >= need) break;
    if (seen.has(entry.key)) continue; // de-dup pruned-vs-pruned
    seen.add(entry.key);
    admitted.push({ ...entry.candidate, backfilled: true });
  }
  return {
    gaps: [...kept, ...admitted],
    backfilledCount: admitted.length,
    floorHit: admitted.length > 0,
  };
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
