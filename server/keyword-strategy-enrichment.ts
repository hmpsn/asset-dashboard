import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { isProgrammingError } from './errors.js';
import { trendDirection, hasSerpOpportunity } from './seo-provider-signals.js';
import type { SeoDataProvider, DomainKeyword } from './seo-data-provider.js';
import type { CompetitorKeywordData, QuestionKeywordGroup, KeywordStrategySeoDataMode } from './keyword-strategy-seo-data.js';
import type { KeywordStrategySearchData } from './keyword-strategy-search-data.js';
import {
  callKeywordStrategyAI,
  type KeywordStrategyKeywordPool,
  type StrategyContentGap,
  type StrategyOutput,
} from './keyword-strategy-ai-synthesis.js';
import { computeOpportunityScore } from './keyword-strategy-helpers.js';
import { matchesQuestionKeyword } from './strategy-filters.js';
import { METRICS_SOURCE } from '../shared/types/keywords.js';

const log = createLogger('keyword-strategy:enrichment');

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
  sendProgress: (step: string, detail: string, progress: number) => void;
}

export interface EnrichKeywordStrategyResult {
  strategy: StrategyOutput;
  siteKeywordMetrics: KeywordStrategySiteKeywordMetric[];
  topicClusters: KeywordStrategyTopicCluster[];
  cannibalization: KeywordStrategyCannibalizationIssue[];
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
    sendProgress,
  } = options;
  const { gscData } = searchData;

  // Enrich pageMap with GSC metrics if available
  sendProgress('enrichment', 'Enriching strategy with ranking data...', 0.90);
  if (gscData.length > 0) {
    for (const pm of strategy.pageMap ?? []) {
      const matchingRows = gscData.filter(r => {
        try { return new URL(r.page).pathname === pm.pagePath; } catch { return false; }
      });
      if (matchingRows.length > 0) {
        const kwMatch = matchingRows.find(r => r.query.toLowerCase().includes(pm.primaryKeyword.toLowerCase()));
        if (kwMatch) {
          pm.currentPosition = kwMatch.position;
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

  // Enrich pageMap with SEO provider volume/difficulty data
  if (domainKeywords.length > 0) {
    // Build lookup: keyword → metrics
    const kwLookup = new Map(domainKeywords.map(k => [k.keyword.toLowerCase(), k])); // map-dup-ok
    for (const pm of strategy.pageMap ?? []) {
      // Skip pages with no primary keyword (declined filter may have cleared it, or AI omitted it)
      if (!pm.primaryKeyword) continue;
      const match = kwLookup.get(pm.primaryKeyword.toLowerCase());
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
        // Always write serpFeatures for exact matches (even empty) so COALESCE overwrites
        // stale features if provider data changed. Pages with no exact match are left
        // undefined → null → COALESCE keeps previous value (correct for unmatched pages).
        pm.serpFeatures = features;
      } else {
        // Try word-overlap match (requires >=80% word overlap and at least 2 words)
        const partial = domainKeywords.find(k => {
          const kwWords = new Set(k.keyword.toLowerCase().split(/\s+/));
          const pmWords = pm.primaryKeyword.toLowerCase().split(/\s+/);
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
            const m = kwLookup.get(sk.toLowerCase());
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
    // Deduplicate
    const uniqueNeeds = [...new Set(lookupCandidates.map((k: string) => k.toLowerCase()))];
    log.info(`Enrichment: ${strategy.pageMap?.length ?? 0} pages total, ${pagesNeedingVolume.length} need volume, ${uniqueNeeds.length} unique keywords to look up (capped at 30)`);
    const needsVolume = uniqueNeeds.slice(0, 30);
    if (needsVolume.length > 0) {
      try {
        const metrics = await provider.getKeywordMetrics(needsVolume as string[], workspaceId);
        const metricMap = new Map(metrics.map(m => [m.keyword.toLowerCase(), m])); // map-dup-ok
        for (const pm of strategy.pageMap ?? []) {
          if (!pm.volume) {
            const m = metricMap.get(pm.primaryKeyword.toLowerCase());
            if (m) {
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
    const domainKwLookup = new Map(domainKeywords.map(k => [k.keyword.toLowerCase(), k])); // map-dup-ok
    const missingCgKws: string[] = [];
    let poolEnriched = 0;
    for (const cg of strategy.contentGaps) {
      const kwLower = cg.targetKeyword.toLowerCase();
      // Priority 1: keyword pool (competitor gaps, competitor keywords, related keywords).
      // SKIP GSC-sourced entries — their "volume" is actually GSC impressions, not real
      // search volume. Using impressions would severely undervalue high-volume keywords
      // and set difficulty to 0 (hardcoded for GSC entries), misleading downstream sorts.
      const poolHit = keywordPool.get(kwLower);
      if (poolHit && poolHit.volume > 0 && poolHit.source !== 'gsc') {
        cg.volume = poolHit.volume;
        cg.difficulty = poolHit.difficulty;
        poolEnriched++;
        continue;
      }
      // Priority 2: domain organic data
      const domainHit = domainKwLookup.get(kwLower);
      if (domainHit) {
        cg.volume = domainHit.volume;
        cg.difficulty = domainHit.difficulty;
        continue;
      }
      missingCgKws.push(cg.targetKeyword);
    }
    log.info(`Content gap enrichment: ${poolEnriched} from keyword pool, ${strategy.contentGaps.length - poolEnriched - missingCgKws.length} from domain data, ${missingCgKws.length} need API lookup`);
    if (missingCgKws.length > 0 && provider && seoDataMode !== 'none') {
      try {
        const cgMetrics = await provider.getKeywordMetrics(missingCgKws.slice(0, 30), workspaceId);
        const cgMap = new Map(cgMetrics.map(m => [m.keyword.toLowerCase(), m])); // map-dup-ok
        for (const cg of strategy.contentGaps) {
          if (cg.volume == null) {
            const m = cgMap.get(cg.targetKeyword.toLowerCase());
            if (m) {
              cg.volume = m.volume;
              cg.difficulty = m.difficulty;
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
        const q = row.query.toLowerCase();
        const existing = gscByQuery.get(q);
        if (existing) {
          existing.impressions += row.impressions;
        } else {
          gscByQuery.set(q, { impressions: row.impressions });
        }
      }
      for (const cg of strategy.contentGaps) {
        const exact = gscByQuery.get(cg.targetKeyword.toLowerCase());
        if (exact) {
          cg.impressions = exact.impressions;
        } else {
          // Word-level match: sum impressions from queries where all target words appear
          const targetWords = cg.targetKeyword.toLowerCase().split(/\s+/);
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
    const domainLookup = new Map(domainKeywords.map(k => [k.keyword.toLowerCase(), k])); // map-dup-ok
    for (const cg of strategy.contentGaps) {
      const match = domainLookup.get(cg.targetKeyword.toLowerCase());
      if (match) {
        cg.trendDirection = trendDirection(match.trend);
        const serp = hasSerpOpportunity(match.serpFeatures);
        const features: string[] = [];
        if (serp.featuredSnippet) features.push('featured_snippet');
        if (serp.paa) features.push('people_also_ask');
        if (serp.video) features.push('video');
        if (serp.localPack) features.push('local_pack');
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

  // Compute composite opportunity score — all enrichment (volume, KD, impressions, trend) is now done
  if (strategy.contentGaps?.length) {
    for (const cg of strategy.contentGaps) {
      cg.opportunityScore = computeOpportunityScore(cg);
    }
    // Sort descending so highest-value gaps surface first in the UI
    strategy.contentGaps.sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0));
    log.info({ workspaceId, count: strategy.contentGaps.length }, 'Computed content gap opportunity scores');
  }

  // ── Cannibalization Detection + Canonical Recommender ────────
  // Find keywords assigned to multiple pages, recommend canonical URLs and specific actions
  const cannibalization: KeywordStrategyCannibalizationIssue[] = [];
  {
    const kwPages = new Map<string, Array<{ path: string; source: 'keyword_map' | 'gsc' }>>();
    for (const pm of strategy.pageMap ?? []) {
      const kw = pm.primaryKeyword.toLowerCase();
      if (!kwPages.has(kw)) kwPages.set(kw, []);
      kwPages.get(kw)!.push({ path: pm.pagePath, source: 'keyword_map' });
    }

    if (gscData.length > 0) {
      const gscByQuery = new Map<string, Array<{ page: string; position: number; impressions: number; clicks: number }>>();
      for (const r of gscData) {
        const q = r.query.toLowerCase();
        if (!gscByQuery.has(q)) gscByQuery.set(q, []);
        try {
          gscByQuery.get(q)!.push({ page: new URL(r.page).pathname, position: r.position, impressions: r.impressions, clicks: r.clicks });
        } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'keyword-strategy: programming error'); /* skip */ } // url-fetch-ok
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
        } else if (otherPages.every(p => !p.clicks && (p.impressions ?? 0) < 50)) {
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
      const ownedKws = new Set(domainKeywords.map(k => k.keyword.toLowerCase()));

      // Top keywords by volume for AI clustering
      const poolForClustering = [...keywordPool.entries()]
        .sort((a, b) => b[1].volume - a[1].volume)
        .slice(0, 150)
        .map(([kw, m]) => `"${kw}" (${m.volume}/mo)`);

      const clusterPrompt = `You are a topical authority analyst. Group these keywords into 5-10 BUSINESS-RELEVANT topic clusters.
${businessSection}
KEYWORD POOL (${poolForClustering.length} keywords with search volume):
${poolForClustering.join(', ')}

Return JSON array:
[
  {
    "topic": "Short descriptive topic name (2-4 words, specific to THIS business)",
    "keywords": ["keyword1", "keyword2"]
  }
]

Rules:
- Each cluster must represent a distinct business capability, service area, product category, or content pillar that THIS business actually serves
- Topic names must be specific — NOT generic phrases like "how to", "what is", "best tools"
- Use the BUSINESS CONTEXT above to determine what matters to this business. If no context, infer from the keywords themselves
- Every keyword should appear in exactly ONE cluster. Skip keywords that don't fit any meaningful business topic
- Clusters should have 3-15 keywords each
- Order clusters by strategic importance to the business
- Return ONLY valid JSON array, no markdown`;

      const clusterRaw = await callKeywordStrategyAI(workspaceId, [
        { role: 'system', content: 'You are a topical authority analyst. Return valid JSON only.' },
        { role: 'user', content: clusterPrompt },
      ], 2000, 'topic-clusters');

      const aiClusters = parseJsonFallback<Array<{ topic?: string; keywords?: string[] }> | null>(clusterRaw, null);
      if (!Array.isArray(aiClusters)) throw new Error('AI topic clustering returned invalid JSON');
      if (Array.isArray(aiClusters)) {
        for (const cluster of aiClusters) {
          if (!cluster.topic || !Array.isArray(cluster.keywords) || cluster.keywords.length < 3) continue;

          const normalizedKws = cluster.keywords
            .map((k: string) => k.toLowerCase().trim())
            .filter((k: string) => keywordPool.has(k));
          if (normalizedKws.length < 3) continue;

          const owned = normalizedKws.filter((k: string) => ownedKws.has(k));
          const gap = normalizedKws.filter((k: string) => !ownedKws.has(k));
          const coverage = Math.round((owned.length / normalizedKws.length) * 100);

          let avgPos: number | undefined;
          if (owned.length > 0) {
            const positions = owned.map((k: string) => domainKeywords.find(d => d.keyword.toLowerCase() === k)?.position).filter(Boolean) as number[];
            if (positions.length > 0) avgPos = Math.round(positions.reduce((s, p) => s + p, 0) / positions.length);
          }

          let topComp: string | undefined;
          let topCompCov: number | undefined;
          if (competitorKeywords.length > 0) {
            const compCoverage = new Map<string, number>();
            for (const ck of competitorKeywords) {
              if (normalizedKws.includes(ck.keyword.toLowerCase())) {
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
    const kwLookup = new Map(domainKeywords.map(k => [k.keyword.toLowerCase(), k])); // map-dup-ok
    const found: typeof siteKeywordMetrics = [];
    const missing: string[] = [];
    for (const kw of strategy.siteKeywords) {
      const m = kwLookup.get(kw.toLowerCase());
      if (m) {
        found.push({ keyword: kw, volume: m.volume, difficulty: m.difficulty });
      } else {
        missing.push(kw);
      }
    }
    if (missing.length > 0) {
      try {
        const extra = await provider.getKeywordMetrics(missing.slice(0, 30), workspaceId);
        for (const m of extra) {
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
    const prioWeight = (p: string) => p === 'high' ? 3 : p === 'medium' ? 2 : 1;
    strategy.contentGaps = [...strategy.contentGaps].sort(
      (a: StrategyContentGap, b: StrategyContentGap) => {
        // Bucket values (higher = sorted first, descending):
        //   2 = Positive volume (>0) OR GSC-proven impressions — confirmed demand
        //   1 = Unenriched (null/undefined) — not yet checked, potential
        //   0 = Zero volume with no impressions — enriched but no proven demand
        const getBundle = (gap: StrategyContentGap) => {
          if (gap.volume == null) return { bucket: 1, vol: 0 };  // unenriched bucket 1 (null OR undefined)
          if (gap.volume > 0) return { bucket: 2, vol: gap.volume };   // positive volume bucket 2
          if ((gap.impressions ?? 0) > 0) return { bucket: 2, vol: gap.impressions! }; // GSC-proven demand even at volume=0
          return { bucket: 0, vol: 0 };                                 // confirmed zero demand bucket 0
        };
        const aBundle = getBundle(a);
        const bBundle = getBundle(b);

        // Sort by bucket desc, then by volume desc within bucket, then by priority desc
        return bBundle.bucket - aBundle.bucket ||
               bBundle.vol - aBundle.vol ||
               prioWeight(b.priority ?? '') - prioWeight(a.priority ?? '');
      }
    );
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
  };
}
