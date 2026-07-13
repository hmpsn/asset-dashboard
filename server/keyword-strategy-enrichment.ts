import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { normalizePageUrl } from './utils/page-address.js';
import { z } from 'zod';
import { resolveWorkspaceLocationCode, getLocalSeoPosture, listLocalSeoMarkets } from './domains/local-seo/configuration-service.js';
import { workspaceProviderGeo } from './seo-target-geo.js';
import { trendDirection, hasSerpOpportunity } from './seo-provider-signals.js';
import type { SeoDataProvider, DomainKeyword } from './seo-data-provider.js';
import type { CompetitorKeywordData, QuestionKeywordGroup, KeywordStrategySeoDataMode } from './keyword-strategy-seo-data.js';
import type { KeywordStrategySearchData } from './keyword-strategy-search-data.js';
import {
  callNamedStrategyAI,
  type KeywordStrategyKeywordPool,
  type StrategyPageMapEntry,
  type StrategyContentGap,
  type StrategyOutput,
} from './keyword-strategy-ai-synthesis.js';
import { computeOpportunityScore, isSuspiciousPlannerGroupedVolume } from './keyword-strategy-helpers.js';
import { computeOpportunityValue } from './scoring/opportunity-value.js';
import { computeKeywordValueScore, deriveValueIntent } from './scoring/keyword-value-score.js';
import { matchesQuestionKeyword } from './strategy-filters.js';
import { getWorkspace } from './workspaces.js';
import { METRICS_SOURCE } from '../shared/types/keywords.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { compareContentGapDemandDisplayOrder, compareKeywordOpportunityScoreDesc } from '../shared/keyword-opportunity-projection.js';

const log = createLogger('keyword-strategy:enrichment');
const URL_LEVEL_KEYWORD_PAGE_LIMIT = 12;
const URL_LEVEL_KEYWORD_PER_PAGE_LIMIT = 10;
const URL_LEVEL_KEYWORD_CONCURRENCY = 3;
const topicClusterItemSchema = z.object({
  topic: z.string().trim().min(1),
  keywords: z.array(z.string().trim().min(1)).min(3),
});
const topicClusterCandidateSchema = z.object({}).passthrough();
const topicClusterAiOutputSchema = z.object({
  clusters: z.array(topicClusterCandidateSchema).default([]),
});

export type TopicClusterAiOutput = z.infer<typeof topicClusterItemSchema>[];

export function parseTopicClusterOutput(raw: string): TopicClusterAiOutput {
  const parsed = parseJsonFallback<unknown>(raw, null);
  const envelope = topicClusterAiOutputSchema.safeParse(parsed);
  if (!envelope.success) throw new Error('AI topic clustering returned invalid JSON');
  const clusters: TopicClusterAiOutput = [];
  for (const cluster of envelope.data.clusters) {
    const result = topicClusterItemSchema.safeParse(cluster);
    if (result.success) clusters.push(result.data);
  }
  return clusters;
}

export interface KeywordStrategyTopicCluster {
  topic: string;
  keywords: string[];
  ownedCount: number;
  totalCount: number;
  coveragePercent: number;
  avgPosition?: number;
  topCompetitor?: string;
  topCompetitorCoverage?: number;
  gap: string[];
}

export interface KeywordStrategyCannibalizationIssue {
  keyword: string;
  pages: Array<{ path: string; position?: number; impressions?: number; clicks?: number; source: 'keyword_map' | 'gsc' }>;
  severity: 'high' | 'medium' | 'low';
  recommendation: string;
  canonicalPath?: string;
  canonicalUrl?: string;
  action: 'canonical_tag' | 'redirect_301' | 'differentiate' | 'noindex';
}

export interface KeywordStrategySiteKeywordMetric {
  keyword: string;
  volume: number;
  difficulty: number;
}

export interface EnrichKeywordStrategyOptions {
  workspaceId: string;
  baseUrl: string;
  strategy: StrategyOutput;
  keywordPool: KeywordStrategyKeywordPool;
  businessSection: string;
  searchData: KeywordStrategySearchData;
  domainKeywords: DomainKeyword[];
  questionKeywords: QuestionKeywordGroup[];
  competitorKeywords: CompetitorKeywordData[];
  provider: SeoDataProvider | null;
  seoDataMode: KeywordStrategySeoDataMode;
  /**
   * SEO Generation Quality P2 is now the canonical synthesis path.
   * Computed once per generation and threaded in. When enabled, page-coverage
   * pruning uses token-subset containment instead of substring `.includes()`.
   */
  relaxConservatism?: boolean;
  sendProgress: (step: string, detail: string, progress: number) => void;
}

export interface EnrichKeywordStrategyResult {
  strategy: StrategyOutput;
  siteKeywordMetrics: KeywordStrategySiteKeywordMetric[];
  topicClusters: KeywordStrategyTopicCluster[];
  cannibalization: KeywordStrategyCannibalizationIssue[];
  /**
   * Content gaps pruned by the page-coverage filter (`_removePageCoveredContentGaps`).
   * Surfaced so the P2 deterministic backfill floor (in generation) can re-admit the
   * highest-scoring pruned candidates when the kept list falls below the floor.
   * Empty on flag-OFF behavior is unchanged; the array is always present (additive).
   */
  prunedContentGaps: StrategyContentGap[];
}

function normalizeTopicKeyword(value: string | undefined): string {
  return keywordComparisonKey(value);
}

export function _hasMultiWordTopicSignal(keyword: string): boolean {
  return normalizeTopicKeyword(keyword).split(' ').filter(Boolean).length >= 2;
}

function hasMultiWordTopicSignal(keyword: string): boolean {
  return _hasMultiWordTopicSignal(keyword);
}

/**
 * Token-subset containment: every token of `inner` appears (as a whole token) in
 * `outer`. SEO Generation Quality P2(b): the flag-ON containment test, replacing
 * the substring `.includes()` so "dental implants cost" is NOT eaten by a
 * "/dental-implants" page signal (its `cost` token is absent). Both inputs are
 * already topic-normalized whitespace-joined strings.
 */
function isTokenSubset(inner: string, outer: string): boolean {
  const innerTokens = inner.split(' ').filter(Boolean);
  if (innerTokens.length === 0) return false;
  const outerTokens = new Set(outer.split(' ').filter(Boolean));
  return innerTokens.every(token => outerTokens.has(token));
}

export function isTopicKeywordCoveredByPageMap(
  keyword: string,
  pageMap: StrategyPageMapEntry[] | undefined,
  // P2(b): flag-ON → token-subset containment; flag-OFF → legacy substring .includes().
  relaxConservatism = false,
): boolean {
  const normalizedKeyword = normalizeTopicKeyword(keyword);
  if (!normalizedKeyword || !pageMap?.length) return false;
  // On flag-ON the multi-word signal still gates the weaker (title/slug) match, but
  // the containment test itself is token-subset rather than substring.
  const contains = (outer: string): boolean =>
    relaxConservatism ? isTokenSubset(normalizedKeyword, outer) : outer.includes(normalizedKeyword);

  for (const page of pageMap) {
    const assignedKeywords = [
      page.primaryKeyword,
      ...(page.secondaryKeywords ?? []),
    ].map(normalizeTopicKeyword).filter(Boolean);

    if (assignedKeywords.some(assigned =>
      assigned === normalizedKeyword
      || (hasMultiWordTopicSignal(normalizedKeyword) && contains(assigned))
    )) {
      return true;
    }

    // Page titles and slugs are weaker than explicit keyword assignments, so only
    // use phrase matches. This catches service pages like /services/cosmetic-dentistry
    // without claiming broad one-word terms such as "dentist" are fully covered.
    if (hasMultiWordTopicSignal(normalizedKeyword)) {
      const pageSignal = normalizeTopicKeyword(`${page.pageTitle ?? ''} ${page.pagePath}`);
      if (contains(pageSignal)) return true;
    }
  }

  return false;
}

export function _removePageCoveredContentGaps(
  contentGaps: StrategyContentGap[] | undefined,
  pageMap: StrategyPageMapEntry[] | undefined,
  // P2(b): flag-ON → token-subset prune; flag-OFF (default) → byte-identical substring prune.
  relaxConservatism = false,
): { kept: StrategyContentGap[]; removed: StrategyContentGap[] } {
  if (!contentGaps?.length) return { kept: [], removed: [] };
  const kept: StrategyContentGap[] = [];
  const removed: StrategyContentGap[] = [];
  for (const gap of contentGaps) {
    // SEO Generation Quality P3 (M2): gaps marked `requested` were injected by the
    // requested-re-add hard guarantee (the client explicitly asked for this keyword).
    // They MUST survive the covered-topic heuristic — never prune them. The marker is
    // only ever set on the flag-ON synthesis path, so flag-OFF gaps never carry it and
    // this branch is inert there (flag-OFF prune stays byte-identical).
    if (gap.requested) {
      kept.push(gap);
    } else if (isTopicKeywordCoveredByPageMap(gap.targetKeyword, pageMap, relaxConservatism)) {
      removed.push(gap);
    } else {
      kept.push(gap);
    }
  }
  return { kept, removed };
}

export function _resolvePageUrl(baseUrl: string, pagePath: string): string | null {
  if (!baseUrl || !pagePath) return null;
  try {
    return new URL(normalizePageUrl(pagePath), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  } catch { // catch-ok: workspace URL/page path can be malformed; URL-level enrichment degrades safely.
    return null;
  }
}

export function _chooseUrlLevelKeyword(keywords: DomainKeyword[]): DomainKeyword | undefined {
  return keywords
    .filter(k => k.keyword?.trim())
    .sort((a, b) =>
      (b.traffic ?? 0) - (a.traffic ?? 0) ||
      (b.volume ?? 0) - (a.volume ?? 0) ||
      (a.position || 999) - (b.position || 999)
    )[0];
}

async function applyUrlLevelKeywordIntelligence(options: {
  workspaceId: string;
  baseUrl: string;
  strategy: StrategyOutput;
  provider: SeoDataProvider;
}): Promise<number> {
  const getUrlKeywords = options.provider.getUrlKeywords;
  if (!getUrlKeywords || !options.strategy.pageMap?.length) return 0;

  // CLIENT-workspace SERP geo for the per-URL ranked-keyword queries — `{}` when the
  // geo-targeting flag is OFF (byte-identical to pre-P4), resolved geo when ON. (P4)
  const geo = workspaceProviderGeo(options.workspaceId);

  const candidates = options.strategy.pageMap
    .filter(pm => !!pm.pagePath)
    .slice(0, URL_LEVEL_KEYWORD_PAGE_LIMIT);

  let enriched = 0;
  let nextIndex = 0;
  const enrichCandidate = async (pm: StrategyPageMapEntry): Promise<boolean> => {
    const pageUrl = _resolvePageUrl(options.baseUrl, pm.pagePath);
    if (!pageUrl) return false;
    try {
      const urlKeywords = await getUrlKeywords(pageUrl, options.workspaceId, URL_LEVEL_KEYWORD_PER_PAGE_LIMIT, undefined, geo.locationCode, geo.languageCode);
      const top = _chooseUrlLevelKeyword(urlKeywords);
      if (!top) return false;
      pm.urlLevelKeywords = urlKeywords.slice(0, URL_LEVEL_KEYWORD_PER_PAGE_LIMIT).map(k => ({
        keyword: k.keyword,
        position: k.position,
        volume: k.volume,
        difficulty: k.difficulty,
        cpc: k.cpc,
        traffic: k.traffic,
        url: k.url,
      }));
      pm.urlLevelKeywordSource = options.provider.name === 'semrush' ? 'semrush' : 'dataforseo';

      // URL-level provider data is page-specific, so it is a stronger assignment
      // signal than domain-level organic fallback. GSC exact-query data still wins
      // above this block when it exists.
      if (!pm.gscKeywords?.length || !pm.primaryKeyword) {
        pm.primaryKeyword = top.keyword;
      }
      pm.currentPosition = top.position || pm.currentPosition;
      pm.volume = top.volume;
      pm.difficulty = top.difficulty;
      pm.cpc = top.cpc;
      pm.metricsSource = METRICS_SOURCE.URL_LEVEL;
      return true;
    } catch (err) {
      log.warn({ err, pagePath: pm.pagePath }, 'URL-level keyword enrichment failed for page');
      return false;
    }
  };

  const workers = Array.from(
    { length: Math.min(URL_LEVEL_KEYWORD_CONCURRENCY, candidates.length) },
    async () => {
      while (nextIndex < candidates.length) {
        const pm = candidates[nextIndex++];
        if (await enrichCandidate(pm)) enriched++;
      }
    },
  );
  await Promise.all(workers);
  return enriched;
}

export async function enrichKeywordStrategy(options: EnrichKeywordStrategyOptions): Promise<EnrichKeywordStrategyResult> {
  const {
    workspaceId,
    baseUrl,
    strategy,
    keywordPool,
    businessSection,
    searchData,
    domainKeywords,
    questionKeywords,
    competitorKeywords,
    provider,
    seoDataMode,
    relaxConservatism = false,
    sendProgress,
  } = options;
  const { gscData } = searchData;
  // P2: pruned-by-page-coverage gaps, surfaced for the deterministic backfill floor.
  let prunedContentGaps: StrategyContentGap[] = [];

  // Enrich pageMap with GSC metrics if available
  sendProgress('enrichment', 'Enriching strategy with ranking data...', 0.90);
  if (gscData.length > 0) {
    for (const pm of strategy.pageMap ?? []) {
      const matchingRows = gscData.filter(r => normalizePageUrl(r.page) === pm.pagePath);
      if (matchingRows.length > 0) {
        const primaryKeyword = keywordComparisonKey(pm.primaryKeyword);
        if (primaryKeyword) {
          const kwMatch = matchingRows.find(r => keywordComparisonKey(r.query).includes(primaryKeyword));
          if (kwMatch) {
            pm.currentPosition = kwMatch.position;
          }
        }
        // Don't set currentPosition from a non-matching query — it's misleading

        // Page-level aggregates are still correct:
        pm.impressions = matchingRows.reduce((s, r) => s + r.impressions, 0);
        pm.clicks = matchingRows.reduce((s, r) => s + r.clicks, 0);
        pm.gscKeywords = matchingRows
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 20)
          .map(r => ({ query: r.query, clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 }));
      }
    }
  }

  if (provider && seoDataMode === 'full') {
    sendProgress('enrichment', 'Checking URL-level keyword intelligence...', 0.91);
    const enriched = await applyUrlLevelKeywordIntelligence({ workspaceId, baseUrl, strategy, provider });
    if (enriched > 0) {
      log.info(`URL-level keyword enrichment applied to ${enriched} page${enriched === 1 ? '' : 's'}`);
    }
  }

  // Enrich pageMap with SEO provider volume/difficulty data
  if (domainKeywords.length > 0) {
    // Build lookup: keyword → metrics
    const kwLookup = new Map(domainKeywords.map(k => [keywordComparisonKey(k.keyword), k])); // map-dup-ok
    for (const pm of strategy.pageMap ?? []) {
      if (pm.metricsSource === METRICS_SOURCE.URL_LEVEL) continue;
      // Skip pages with no primary keyword (declined filter may have cleared it, or AI omitted it)
      if (!pm.primaryKeyword) continue;
      const match = kwLookup.get(keywordComparisonKey(pm.primaryKeyword));
      if (match) {
        pm.volume = match.volume;
        pm.difficulty = match.difficulty;
        pm.cpc = match.cpc;
        pm.metricsSource = METRICS_SOURCE.EXACT;
        // Capture SERP features for this page's primary keyword — stored per-page and
        // later aggregated into workspace-level SerpFeatures counts in assembleSeoContext()
        const serp = hasSerpOpportunity(match.serpFeatures);
        const features: string[] = [];
        if (serp.featuredSnippet) features.push('featured_snippet');
        if (serp.paa) features.push('people_also_ask');
        if (serp.video) features.push('video');
        if (serp.localPack) features.push('local_pack');
        if (serp.aiOverview) features.push('ai_overview');
        // Always write serpFeatures for exact matches (even empty) so COALESCE overwrites
        // stale features if provider data changed. Pages with no exact match are left
        // undefined → null → COALESCE keeps previous value (correct for unmatched pages).
        pm.serpFeatures = features;
      } else {
        // Try word-overlap match (requires >=80% word overlap and at least 2 words)
        const partial = domainKeywords.find(k => {
          const kwWords = new Set(keywordComparisonKey(k.keyword).split(/\s+/));
          const pmWords = keywordComparisonKey(pm.primaryKeyword).split(/\s+/);
          const overlap = pmWords.filter((w: string) => kwWords.has(w)).length;
          return overlap / pmWords.length >= 0.8 && pmWords.length >= 2;
        });
        if (partial) {
          pm.volume = partial.volume;
          pm.difficulty = partial.difficulty;
          pm.cpc = partial.cpc;
          pm.metricsSource = METRICS_SOURCE.PARTIAL_MATCH;
        }
      }
      // Enrich secondary keywords
      if (pm.secondaryKeywords?.length) {
        pm.secondaryMetrics = pm.secondaryKeywords
          .map((sk: string) => {
            const m = kwLookup.get(keywordComparisonKey(sk));
            return m ? { keyword: sk, volume: m.volume, difficulty: m.difficulty } : null;
          })
          .filter(Boolean) as { keyword: string; volume: number; difficulty: number }[];
      }
    }
  }

  // If we still have keywords without volume data and a provider is available, bulk-fetch them.
  // Only look up keywords NOT already in the pool (those are "invented" by the AI).
  // Cap at 30 to avoid burning credits on keywords that will mostly return NOTHING FOUND.
  if (provider && seoDataMode !== 'none') {
    const pagesNeedingVolume = (strategy.pageMap ?? [])
      .filter((pm: { volume?: number; primaryKeyword: string }) => !pm.volume && pm.primaryKeyword);
    // Filter to reasonable keywords only (≤5 words, not too specific)
    const lookupCandidates = pagesNeedingVolume
      .filter((pm: { primaryKeyword: string }) => pm.primaryKeyword.split(/\s+/).length <= 5)
      .map((pm: { primaryKeyword: string }) => pm.primaryKeyword);
    // Deduplicate semantically, but preserve the first raw representative for provider requests.
    const uniqueNeedsByKey = new Map<string, string>();
    for (const keyword of lookupCandidates) {
      const key = keywordComparisonKey(keyword);
      if (key && !uniqueNeedsByKey.has(key)) {
        uniqueNeedsByKey.set(key, keyword);
      }
    }
    const uniqueNeeds = [...uniqueNeedsByKey.values()];
    log.info(`Enrichment: ${strategy.pageMap?.length ?? 0} pages total, ${pagesNeedingVolume.length} need volume, ${uniqueNeeds.length} unique keywords to look up (capped at 30)`);
    const needsVolume = uniqueNeeds.slice(0, 30);
    if (needsVolume.length > 0) {
      try {
        const locationCode = resolveWorkspaceLocationCode(workspaceId) ?? undefined;
        const metrics = await provider.getKeywordMetrics(needsVolume as string[], workspaceId, undefined, locationCode);
        const metricMap = new Map(metrics.map(m => [keywordComparisonKey(m.keyword), m])); // map-dup-ok
        for (const pm of strategy.pageMap ?? []) {
          if (!pm.volume) {
            const m = metricMap.get(keywordComparisonKey(pm.primaryKeyword));
            if (m && !isSuspiciousPlannerGroupedVolume(m.keyword, m.volume)) {
              pm.volume = m.volume;
              pm.difficulty = m.difficulty;
              pm.cpc = m.cpc;
              pm.metricsSource = METRICS_SOURCE.BULK_LOOKUP;
            }
          }
        }
      } catch (err) {
        log.error({ err: err }, 'Keyword overview enrichment error');
      }
    }
  }

  // Enrich contentGaps with SEO provider volume/difficulty + GSC impressions
  if (strategy.contentGaps && strategy.contentGaps.length > 0) {
    // Enrich content gaps with volume/KD from the keyword pool first (has data from
    // competitor gaps, competitor keywords, GSC, related keywords), then domain organic
    // data, then bulk API fetch as last resort. The keyword pool is the richest source
    // because it aggregates all data gathered during this strategy run.
    const domainKwLookup = new Map(domainKeywords.map(k => [keywordComparisonKey(k.keyword), k])); // map-dup-ok
    const missingCgKws: string[] = [];
    let poolEnriched = 0;
    for (const cg of strategy.contentGaps) {
      const kwLower = keywordComparisonKey(cg.targetKeyword);
      // Priority 1: keyword pool (competitor gaps, competitor keywords, related keywords).
      // SKIP GSC-sourced entries — their "volume" is actually GSC impressions, not real
      // search volume. Using impressions would severely undervalue high-volume keywords
      // and set difficulty to 0 (hardcoded for GSC entries), misleading downstream sorts.
      const poolHit = keywordPool.get(kwLower);
      if (poolHit && poolHit.volume > 0 && poolHit.source !== 'gsc') {
        cg.volume = poolHit.volume;
        cg.difficulty = poolHit.difficulty;
        cg.cpc = poolHit.cpc;
        cg.cpcSource = poolHit.cpcSource;
        cg.intent = poolHit.intent ?? cg.intent;
        cg.intentSource = poolHit.intent ? poolHit.intentSource : cg.intentSource;
        poolEnriched++;
        continue;
      }
      // Priority 2: domain organic data
      const domainHit = domainKwLookup.get(kwLower);
      if (domainHit) {
        cg.volume = domainHit.volume;
        cg.difficulty = domainHit.difficulty;
        cg.cpc = domainHit.cpc;
        cg.cpcSource = domainHit.cpc > 0 ? 'domain' : undefined;
        continue;
      }
      missingCgKws.push(cg.targetKeyword);
    }
    log.info(`Content gap enrichment: ${poolEnriched} from keyword pool, ${strategy.contentGaps.length - poolEnriched - missingCgKws.length} from domain data, ${missingCgKws.length} need API lookup`);
    if (missingCgKws.length > 0 && provider && seoDataMode !== 'none') {
      try {
        const locationCode = resolveWorkspaceLocationCode(workspaceId) ?? undefined;
        const cgMetrics = await provider.getKeywordMetrics(missingCgKws.slice(0, 30), workspaceId, undefined, locationCode);
        const cgMap = new Map(cgMetrics.map(m => [keywordComparisonKey(m.keyword), m])); // map-dup-ok
        for (const cg of strategy.contentGaps) {
          if (cg.volume == null) {
            const m = cgMap.get(keywordComparisonKey(cg.targetKeyword));
            if (m && !isSuspiciousPlannerGroupedVolume(m.keyword, m.volume)) {
              cg.volume = m.volume;
              cg.difficulty = m.difficulty;
              cg.cpc = m.cpc;
            }
          }
        }
      } catch (err) {
        log.error({ err }, 'Content gap keyword enrichment error');
      }
    }
    // GSC: check if the site already gets impressions for content gap keywords
    if (gscData.length > 0) {
      const gscByQuery = new Map<string, { impressions: number }>();
      for (const row of gscData) {
        const q = keywordComparisonKey(row.query);
        const existing = gscByQuery.get(q);
        if (existing) {
          existing.impressions += row.impressions;
        } else {
          gscByQuery.set(q, { impressions: row.impressions });
        }
      }
      for (const cg of strategy.contentGaps) {
        const exact = gscByQuery.get(keywordComparisonKey(cg.targetKeyword));
        if (exact) {
          cg.impressions = exact.impressions;
        } else {
          // Word-level match: sum impressions from queries where all target words appear
          const targetWords = keywordComparisonKey(cg.targetKeyword).split(/\s+/);
          if (targetWords.length >= 2) {
            let totalImpr = 0;
            for (const [q, data] of gscByQuery) {
              const qWords = q.split(/\s+/);
              const allMatch = targetWords.every((tw: string) => qWords.includes(tw));
              if (allMatch) totalImpr += data.impressions;
            }
            if (totalImpr > 0) cg.impressions = totalImpr;
          }
        }
      }
    }
  }

  // Enrich content gaps with trend direction + SERP features from domain data
  if (strategy.contentGaps?.length && domainKeywords.length > 0) {
    const domainLookup = new Map(domainKeywords.map(k => [keywordComparisonKey(k.keyword), k])); // map-dup-ok
    for (const cg of strategy.contentGaps) {
      const match = domainLookup.get(keywordComparisonKey(cg.targetKeyword));
      if (match) {
        cg.trendDirection = trendDirection(match.trend);
        const serp = hasSerpOpportunity(match.serpFeatures);
        const features: string[] = [];
        if (serp.featuredSnippet) features.push('featured_snippet');
        if (serp.paa) features.push('people_also_ask');
        if (serp.video) features.push('video');
        if (serp.localPack) features.push('local_pack');
        if (serp.aiOverview) features.push('ai_overview');
        if (features.length > 0) cg.serpFeatures = features;
      }
      // Attach related question keywords to each gap
      if (questionKeywords.length > 0) {
        const relatedQs = questionKeywords.flatMap(q => q.questions)
          .filter(q => matchesQuestionKeyword(cg.targetKeyword, q.keyword))
          .slice(0, 3)
          .map(q => q.keyword);
        if (relatedQs.length > 0) cg.questionKeywords = relatedQs;
      }
    }
  }

  // ── SERP Feature Targeting Recommendations ───────────────────
  if (strategy.contentGaps?.length) {
    for (const cg of strategy.contentGaps) {
      if (!cg.serpFeatures?.length) continue;
      const recs: string[] = [];
      for (const feat of cg.serpFeatures) {
        switch (feat) {
          case 'featured_snippet':
            recs.push('Structure content with a clear definition or step-by-step list in the first 100 words to target the featured snippet');
            break;
          case 'people_also_ask':
            recs.push('Include FAQ sections with concise 2-3 sentence answers to target People Also Ask boxes');
            break;
          case 'video':
            recs.push('Embed a relevant video or create video content to compete for the video carousel');
            break;
          case 'local_pack':
            recs.push('Include location-specific content, NAP details, and LocalBusiness schema markup');
            break;
        }
      }
      if (recs.length > 0) cg.serpTargeting = recs;
    }
  }

  if (strategy.contentGaps?.length) {
    const { kept, removed } = _removePageCoveredContentGaps(strategy.contentGaps, strategy.pageMap, relaxConservatism);
    if (removed.length > 0) {
      log.info({
        workspaceId,
        removed: removed.map(gap => gap.targetKeyword),
      }, 'Removed content gaps already covered by strategy page map');
      strategy.contentGaps = kept;
      // P2: retain the pruned gaps so the deterministic backfill floor can re-admit
      // the highest-scoring ones when the kept list is below the floor (flag-ON).
      prunedContentGaps = removed;
    }
  }

  // Compute composite opportunity score — all enrichment (volume, KD, impressions, trend) is now done.
  // SEO Gen-Quality P4 (Contract 3, flag-ON via relaxConservatism): recompute opportunity_score
  // from the SAME OV basis the recommendation queue and gain string use, so briefing-candidates,
  // the upsell badge, and the rec layer all order content gaps by one figure. We store the OV
  // `value` (0..100) — itself a normalized read of the EMV/ROI economic quantity (downstream of
  // emvPerWeek), so it: (a) shares the OV/EMV basis (owner decision), (b) stays in the column's
  // existing 0..100 range, and (c) keeps the rec content_gap branch's grounded spine valid (it
  // reads cg.opportunityScore back as a 0..100 composite — feeding it an unbounded EMV would
  // break the `opportunityScore/100` math).
  //
  // Build the value-first base score ONCE at the top of the per-gap loop so the spine input
  // and the OV fallback use the same value. computeKeywordValueScore is the base; the legacy
  // computeOpportunityScore is the signal-gate fallback. Value-first scoring is unconditional
  // (the keyword-value-scoring flag was retired in SEO Decision Engine P1). ctx is built once
  // per enrichment run, never per gap.
  if (strategy.contentGaps?.length) {
    // Build the value-scoring ctx once per enrichment run.
    const ws = getWorkspace(workspaceId);
    const scoringCtx = {
      posture: getLocalSeoPosture(workspaceId),
      markets: listLocalSeoMarkets(workspaceId),
      city: ws?.businessProfile?.address?.city?.toLowerCase(),
      state: ws?.businessProfile?.address?.state?.toLowerCase(),
    };

    for (const cg of strategy.contentGaps) {
      // Value-first score; computeKeywordValueScore may return undefined (signal
      // gate) — fall back to computeOpportunityScore so a gap is never silently dropped.
      const base: number | undefined =
        computeKeywordValueScore(
          { keyword: cg.targetKeyword, volume: cg.volume, difficulty: cg.difficulty, cpc: cg.cpc, intent: cg.intent },
          scoringCtx,
        ) ?? computeOpportunityScore(cg);

      if (relaxConservatism) {
        const ov = computeOpportunityValue({
          branch: 'content_gap',
          opportunityScore: base ?? null, // grounded composite spine (was: computeOpportunityScore(cg))
          volume: cg.volume ?? null,
          difficulty: cg.difficulty ?? null,
          cpc: cg.cpc ?? null,
          trendDirection: (cg.trendDirection as 'rising' | 'declining' | 'stable' | undefined) ?? null,
          intent: deriveValueIntent(cg.targetKeyword, cg.intent),
          llmLabel: cg.priority === 'high' || cg.priority === 'medium' || cg.priority === 'low' ? cg.priority : null,
        });
        // OV value is 0..100 and EMV-derived; undefined when the gap had no signal at all.
        // M2 (intentional re-compression): overwriting cg.opportunityScore with the OV `value`
        // means the rec content_gap branch (recommendations.ts) re-feeds this OV value back as
        // its `opportunityScore` composite spine into computeOpportunityValue — an f(f(x))
        // re-compression vs the flag-OFF magnitude basis. This is deliberate and safe: the value
        // stays in 0..100, ordering is preserved, and nothing breaks (the served tier/gain/badge
        // all share the one OV basis — Contract 3). Flag-OFF keeps the single-pass legacy score.
        cg.opportunityScore = ov.value > 0 ? ov.value : base; // was: computeOpportunityScore(cg)
      } else {
        cg.opportunityScore = base; // was: computeOpportunityScore(cg)
      }
    }
    // Sort descending so highest-value gaps surface first in the UI
    strategy.contentGaps.sort(compareKeywordOpportunityScoreDesc);
    log.info({ workspaceId, count: strategy.contentGaps.length, basis: relaxConservatism ? 'ov-emv' : 'legacy' }, 'Computed content gap opportunity scores');
  }

  // ── Cannibalization Detection + Canonical Recommender ────────
  // Find keywords assigned to multiple pages, recommend canonical URLs and specific actions
  const cannibalization: KeywordStrategyCannibalizationIssue[] = [];
  {
    const kwPages = new Map<string, Array<{ path: string; source: 'keyword_map' | 'gsc' }>>();
    for (const pm of strategy.pageMap ?? []) {
      const kw = keywordComparisonKey(pm.primaryKeyword);
      if (!kw) continue;
      if (!kwPages.has(kw)) kwPages.set(kw, []);
      kwPages.get(kw)!.push({ path: pm.pagePath, source: 'keyword_map' });
    }

    // GSC enrichment is optional: gscByQuery stays empty without a Search Console
    // connection, so the detection loop below still runs on keyword-map duplicates
    // alone (two pages assigned the same primaryKeyword). Previously the loop was
    // nested inside this guard, making cannibalization dead code for non-GSC
    // workspaces (2026-06-09 audit, strategy-keywords finding).
    const gscByQuery = new Map<string, Array<{ page: string; position: number; impressions: number; clicks: number }>>();
    if (gscData.length > 0) {
      for (const r of gscData) {
        const q = keywordComparisonKey(r.query);
        if (!gscByQuery.has(q)) gscByQuery.set(q, []);
        gscByQuery.get(q)!.push({ page: normalizePageUrl(r.page), position: r.position, impressions: r.impressions, clicks: r.clicks });
      }
      for (const [query, pages] of gscByQuery) {
        if (pages.length >= 2 && pages.some(p => p.impressions > 10)) {
          const existing = kwPages.get(query);
          if (existing) {
            for (const p of pages) {
              if (!existing.find(e => e.path === p.page)) {
                existing.push({ path: p.page, source: 'gsc' });
              }
            }
          } else {
            kwPages.set(query, pages.map(p => ({ path: p.page, source: 'gsc' as const })));
          }
        }
      }
    }

    {
      for (const [kw, pages] of kwPages) {
        if (pages.length < 2) continue;
        const gscQueryData = gscByQuery.get(kw);
        const enrichedPages = pages.map(p => {
          const gscMatch = gscQueryData?.find(g => g.page === p.path);
          return {
            path: p.path,
            position: gscMatch?.position,
            impressions: gscMatch?.impressions,
            clicks: gscMatch?.clicks,
            source: p.source,
          };
        });
        const severity = pages.length >= 3 ? 'high' as const
          : enrichedPages.filter(p => p.position && p.position < 20).length >= 2 ? 'high' as const
          : 'medium' as const;

        // Rank pages by composite score: best position → most clicks → most impressions
        const scored = [...enrichedPages].sort((a, b) => {
          const posA = a.position ?? 100, posB = b.position ?? 100;
          if (posA !== posB) return posA - posB;
          const clickA = a.clicks ?? 0, clickB = b.clicks ?? 0;
          if (clickA !== clickB) return clickB - clickA;
          return (b.impressions ?? 0) - (a.impressions ?? 0);
        });
        const bestPage = scored[0];
        const otherPages = scored.slice(1);
        const canonicalPath = bestPage.path;
        const canonicalUrl = baseUrl ? `${baseUrl}${canonicalPath === '/' ? '' : canonicalPath}` : undefined;

        // Determine action type:
        // - Both pages have traffic + similar position → differentiate content
        // - Secondary page has no traffic → safe to redirect or noindex
        // - Secondary page has some traffic → canonical tag (preserves the page)
        const secondaryHasTraffic = otherPages.some(p => (p.clicks ?? 0) > 5);
        const positionsClose = otherPages.some(p =>
          p.position && bestPage.position && Math.abs(p.position - bestPage.position) < 10
        );
        let action: 'canonical_tag' | 'redirect_301' | 'differentiate' | 'noindex';
        let recommendation: string;

        if (positionsClose && secondaryHasTraffic) {
          action = 'differentiate';
          recommendation = `Both ${canonicalPath} and ${otherPages.map(p => p.path).join(', ')} rank competitively for "${kw}". Differentiate content: retarget ${otherPages.length === 1 ? otherPages[0].path : 'secondary pages'} to a more specific long-tail variant of this keyword.`;
        } else if (secondaryHasTraffic) {
          action = 'canonical_tag';
          recommendation = `Add <link rel="canonical" href="${canonicalUrl || canonicalPath}"> to ${otherPages.map(p => p.path).join(', ')}. This tells Google that ${canonicalPath} is the primary page for "${kw}" while preserving the secondary pages for users.`;
        } else if (gscData.length > 0 && otherPages.every(p => !p.clicks && (p.impressions ?? 0) < 50)) {
          // The "no meaningful traffic" claim requires GSC evidence — without a GSC
          // connection the absence of clicks is absence of DATA, not of traffic, so
          // the no-GSC case falls through to the generic canonical recommendation.
          action = 'redirect_301';
          recommendation = `301 redirect ${otherPages.map(p => p.path).join(', ')} → ${canonicalPath}. The secondary page(s) have no meaningful traffic and are diluting ranking authority for "${kw}".`;
        } else {
          action = 'canonical_tag';
          recommendation = `Set ${canonicalPath} as the canonical URL for "${kw}". Add <link rel="canonical" href="${canonicalUrl || canonicalPath}"> to ${otherPages.map(p => p.path).join(', ')}.`;
        }

        cannibalization.push({
          keyword: kw,
          pages: enrichedPages,
          severity,
          recommendation,
          canonicalPath,
          canonicalUrl,
          action,
        });
      }
    }
    if (cannibalization.length > 0) {
      cannibalization.sort((a, b) => (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1));
      log.info(`Found ${cannibalization.length} cannibalization issues (${cannibalization.filter(c => c.severity === 'high').length} high, actions: ${cannibalization.map(c => c.action).join(', ')})`);
    }
  }

  // ── Topical Authority Clustering (AI-powered) ───────────────
  // Use AI to semantically group keywords into business-relevant topic areas,
  // then measure coverage against owned keywords
  const topicClusters: KeywordStrategyTopicCluster[] = [];
  if (keywordPool.size >= 10) {
    try {
      sendProgress('enrichment', 'Building topical authority clusters...', 0.92);
      const ownedRankingKws = new Set(domainKeywords.map(k => keywordComparisonKey(k.keyword)));

      // Top keywords by volume for AI clustering
      const poolForClustering = [...keywordPool.entries()]
        .sort((a, b) => b[1].volume - a[1].volume)
        .slice(0, 150)
        .map(([kw, m]) => `"${kw}" (${m.volume}/mo)`);

      const clusterPrompt = `You are a topical authority analyst. Group these keywords into 5-10 BUSINESS-RELEVANT topic clusters.
${businessSection}
KEYWORD POOL (${poolForClustering.length} keywords with search volume):
${poolForClustering.join(', ')}

Return a JSON object:
{
  "clusters": [
    {
      "topic": "Short descriptive topic name (2-4 words, specific to THIS business)",
      "keywords": ["keyword1", "keyword2", "keyword3"]
    }
  ]
}

Rules:
- Each cluster must represent a distinct business capability, service area, product category, or content pillar that THIS business actually serves
- Topic names must be specific — NOT generic phrases like "how to", "what is", "best tools"
- Use the BUSINESS CONTEXT above to determine what matters to this business. If no context, infer from the keywords themselves
- Every keyword should appear in exactly ONE cluster. Skip keywords that don't fit any meaningful business topic
- Clusters should have 3-15 keywords each
- Order clusters by strategic importance to the business
- Return ONLY a valid JSON object with a "clusters" array, no markdown`;

      const clusterRaw = await callNamedStrategyAI(workspaceId, 'keyword-topic-clusters', [
        { role: 'system', content: 'You are a topical authority analyst. Return valid JSON only.' },
        { role: 'user', content: clusterPrompt },
      ], 2000);

      const aiClusters = parseTopicClusterOutput(clusterRaw);
      for (const cluster of aiClusters) {
        const normalizedKws = cluster.keywords
          .map((k: string) => keywordComparisonKey(k))
          .filter((k: string) => keywordPool.has(k));
        if (normalizedKws.length < 3) continue;

        const owned = normalizedKws.filter((k: string) =>
          ownedRankingKws.has(k) || isTopicKeywordCoveredByPageMap(k, strategy.pageMap)
        );
        const gap = normalizedKws.filter((k: string) => !owned.includes(k));
        const coverage = Math.round((owned.length / normalizedKws.length) * 100);

        let avgPos: number | undefined;
        if (owned.length > 0) {
          const positions = owned.map((k: string) => domainKeywords.find(d => keywordComparisonKey(d.keyword) === k)?.position).filter(Boolean) as number[];
          if (positions.length > 0) avgPos = Math.round(positions.reduce((s, p) => s + p, 0) / positions.length);
        }

        let topComp: string | undefined;
        let topCompCov: number | undefined;
        if (competitorKeywords.length > 0) {
          const compCoverage = new Map<string, number>();
          for (const ck of competitorKeywords) {
            if (normalizedKws.includes(keywordComparisonKey(ck.keyword))) {
              compCoverage.set(ck.domain, (compCoverage.get(ck.domain) || 0) + 1);
            }
          }
          const best = [...compCoverage.entries()].sort((a, b) => b[1] - a[1])[0];
          if (best && best[1] > owned.length) {
            topComp = best[0];
            topCompCov = Math.round((best[1] / normalizedKws.length) * 100);
          }
        }

        topicClusters.push({
          topic: cluster.topic,
          keywords: normalizedKws,
          ownedCount: owned.length,
          totalCount: normalizedKws.length,
          coveragePercent: coverage,
          avgPosition: avgPos,
          topCompetitor: topComp,
          topCompetitorCoverage: topCompCov,
          gap,
        });
      }
      if (topicClusters.length > 0) {
        topicClusters.sort((a, b) => a.coveragePercent - b.coveragePercent);
        log.info(`Built ${topicClusters.length} AI topic clusters (lowest coverage: ${topicClusters[0].topic} at ${topicClusters[0].coveragePercent}%)`);
      }
    } catch (err) {
      log.warn({ err }, 'AI topic clustering failed — skipping');
    }
  }

  // Enrich siteKeywords with volume/difficulty
  let siteKeywordMetrics: KeywordStrategySiteKeywordMetric[] = [];
  if (provider && seoDataMode !== 'none' && strategy.siteKeywords?.length) {
    const kwLookup = new Map(domainKeywords.map(k => [keywordComparisonKey(k.keyword), k])); // map-dup-ok
    const found: typeof siteKeywordMetrics = [];
    const missing: string[] = [];
    for (const kw of strategy.siteKeywords) {
      const m = kwLookup.get(keywordComparisonKey(kw));
      if (m) {
        found.push({ keyword: kw, volume: m.volume, difficulty: m.difficulty });
      } else {
        missing.push(kw);
      }
    }
    if (missing.length > 0) {
      try {
        const locationCode = resolveWorkspaceLocationCode(workspaceId) ?? undefined;
        const extra = await provider.getKeywordMetrics(missing.slice(0, 30), workspaceId, undefined, locationCode);
        for (const m of extra) {
          if (isSuspiciousPlannerGroupedVolume(m.keyword, m.volume)) continue;
          found.push({ keyword: m.keyword, volume: m.volume, difficulty: m.difficulty });
        }
    } catch (err) {
      log.warn({ err }, 'Site keyword metrics enrichment error');
    }
    }
    siteKeywordMetrics = found;
  }

  // ── Impact-based sorting (no filtering — keep all keywords including volume=0) ──
  // Previously dropped volume=0 keywords, but that silently removed AI-identified
  // opportunities after enrichment. Now we keep all and sort: positive-volume first,
  // then unenriched (no data yet), then confirmed-zero-volume at bottom.
  if (strategy.contentGaps?.length) {
    strategy.contentGaps = [...strategy.contentGaps].sort(compareContentGapDemandDisplayOrder);
    log.info(`Content gaps: ${strategy.contentGaps.length} total (sorted, none dropped)`);
  }

  // ── Quick Win ROI Scoring ──────────────────────────────────
  if (strategy.quickWins?.length) {
    // Compute ROI score: (volume × (1 - difficulty/100)) / max(currentPosition, 1)
    // Fall back to impact-based scoring if no volume data
    for (const qw of strategy.quickWins) {
      const pageData = strategy.pageMap?.find((p: { pagePath: string }) => p.pagePath === qw.pagePath);
      if (pageData?.volume && pageData?.currentPosition) {
        const difficulty = pageData.difficulty ?? 50;
        qw.roiScore = Math.round((pageData.volume * (1 - difficulty / 100)) / Math.max(pageData.currentPosition, 1));
      } else {
        // Fallback: estimate from impact level
        qw.roiScore = qw.estimatedImpact === 'high' ? 100 : qw.estimatedImpact === 'medium' ? 50 : 20;
      }
    }
    strategy.quickWins.sort((a: { roiScore?: number }, b: { roiScore?: number }) => (b.roiScore || 0) - (a.roiScore || 0));
  }

  // Sort pageMap by volume (highest impact first)
  if (strategy.pageMap?.length) {
    strategy.pageMap.sort((a: { volume?: number; impressions?: number }, b: { volume?: number; impressions?: number }) =>
      ((b.volume || 0) + (b.impressions || 0)) - ((a.volume || 0) + (a.impressions || 0))
    );
  }

  // Sort siteKeywordMetrics by volume
  if (siteKeywordMetrics.length > 0) {
    siteKeywordMetrics.sort((a, b) => b.volume - a.volume);
  }

  return {
    strategy,
    siteKeywordMetrics,
    topicClusters,
    cannibalization,
    prunedContentGaps,
  };
}
