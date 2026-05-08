import { updateWorkspace } from './workspaces.js';
import { shouldFetchCompetitorData } from './keyword-strategy-helpers.js';
import { filterDiscoveredCompetitors } from './competitor-domain-filter.js';
import { MAX_COMPETITORS } from './constants.js';
import { listKeywordGaps } from './keyword-gaps.js';
import { createLogger } from './logger.js';
import type { DomainKeyword, KeywordGapEntry, RelatedKeyword, SeoDataProvider } from './seo-data-provider.js';
import type { Workspace } from '../shared/types/workspace.js';

const log = createLogger('keyword-strategy');

export type KeywordStrategySeoDataMode = 'quick' | 'full' | 'none';
export type KeywordStrategyMode = 'full' | 'incremental';

export interface KeywordStrategySeoProgress {
  (step: string, detail: string, progress: number): void;
}

export interface CompetitorKeywordData {
  keyword: string;
  volume: number;
  difficulty: number;
  domain: string;
  position: number;
  serpFeatures?: string;
}

export interface QuestionKeywordGroup {
  seed: string;
  questions: { keyword: string; volume: number }[];
}

export interface FetchAndCacheKeywordStrategySeoDataOptions {
  ws: Workspace;
  provider: SeoDataProvider | null;
  baseUrl: string;
  strategyMode: KeywordStrategyMode;
  seoDataMode: KeywordStrategySeoDataMode;
  competitorDomains: string[];
  sendProgress: KeywordStrategySeoProgress;
}

export interface FetchAndCacheKeywordStrategySeoDataResult {
  seoContext: string;
  domainKeywords: DomainKeyword[];
  keywordGaps: KeywordGapEntry[];
  relatedKeywords: RelatedKeyword[];
  questionKeywords: QuestionKeywordGroup[];
  competitorKeywords: CompetitorKeywordData[];
}

/**
 * Fetch provider-backed keyword strategy inputs and preserve the legacy cache
 * side effects from the monolith: auto-discovered competitors and competitor
 * freshness metadata are written back to the workspace when provider data is refreshed.
 */
export async function fetchAndCacheKeywordStrategySeoData({
  ws,
  provider,
  baseUrl,
  strategyMode,
  seoDataMode,
  competitorDomains,
  sendProgress,
}: FetchAndCacheKeywordStrategySeoDataOptions): Promise<FetchAndCacheKeywordStrategySeoDataResult> {
  let seoContext = '';
  let domainKeywords: DomainKeyword[] = [];
  let keywordGaps: KeywordGapEntry[] = [];
  const relatedKeywords: RelatedKeyword[] = [];
  const questionKeywords: QuestionKeywordGroup[] = [];
  const competitorKeywords: CompetitorKeywordData[] = [];

  const fetchCompetitors = strategyMode !== 'incremental' || shouldFetchCompetitorData(ws, competitorDomains);

  if (!fetchCompetitors) {
    const keywordGapsFromTable = listKeywordGaps(ws.id);
    if (keywordGapsFromTable.length > 0 || ws.keywordStrategy?.keywordGaps?.length) {
      keywordGaps = keywordGapsFromTable.length > 0
        ? keywordGapsFromTable
        : (ws.keywordStrategy?.keywordGaps || []);
      if (keywordGaps.length > 0) {
        seoContext += `\n\nCOMPETITOR KEYWORD GAPS (cached — last fetched ${ws.competitorLastFetchedAt ?? 'unknown'}):\n`;
        seoContext += keywordGaps.slice(0, 30).map(g =>
          `- "${g.keyword}" (vol: ${g.volume}/mo, KD: ${g.difficulty}%) — ${g.competitorDomain} ranks #${g.competitorPosition}`
        ).join('\n');
      }
    }
    if (ws.keywordStrategy?.competitorKeywordData?.length) {
      competitorKeywords.push(...ws.keywordStrategy.competitorKeywordData);
      log.info(`Incremental mode: restored ${competitorKeywords.length} cached competitor keywords into pool`);
    }
  }

  if (seoDataMode === 'none' || !provider) {
    return { seoContext, domainKeywords, keywordGaps, relatedKeywords, questionKeywords, competitorKeywords };
  }

  sendProgress('seo-data', `Fetching keyword intelligence via ${provider.name}...`, 0.55);
  if (!fetchCompetitors) {
    log.info(`Incremental mode: skipping competitor re-fetch (last fetched ${ws.competitorLastFetchedAt})`);
    sendProgress('seo-data', 'Competitor data still fresh — skipping re-fetch...', 0.58);
  }

  const siteDomain = baseUrl ? new URL(baseUrl).hostname : '';
  if (!siteDomain) {
    return { seoContext, domainKeywords, keywordGaps, relatedKeywords, questionKeywords, competitorKeywords };
  }

  try {
    log.info(`Fetching domain organic keywords for ${siteDomain}...`);
    domainKeywords = await provider.getDomainKeywords(siteDomain, ws.id, 200);
    log.info(`Got ${domainKeywords.length} domain keywords`);

    if (domainKeywords.length > 0) {
      seoContext += `\n\nSEO PROVIDER DOMAIN ORGANIC KEYWORDS (real search volume + difficulty data):\n`;
      seoContext += domainKeywords.slice(0, 100).map(k =>
        `- "${k.keyword}" → ${k.url} (pos: #${k.position}, vol: ${k.volume}/mo, KD: ${k.difficulty}%, CPC: $${k.cpc}, traffic: ${k.traffic})`
      ).join('\n');
    }
  } catch (err) {
    log.error({ err }, 'Domain organic error');
  }

  if (fetchCompetitors && competitorDomains.length === 0) {
    try {
      sendProgress('seo-data', 'Auto-discovering organic competitors...', 0.57);
      const discovered = await provider.getCompetitors(siteDomain, ws.id, 5);
      const autoCompetitors = filterDiscoveredCompetitors(discovered, siteDomain)
        .slice(0, MAX_COMPETITORS)
        .map(c => c.domain);
      if (autoCompetitors.length > 0) {
        competitorDomains.push(...autoCompetitors);
        log.info(`Auto-discovered ${autoCompetitors.length} competitors: ${autoCompetitors.join(', ')}`);
        updateWorkspace(ws.id, { competitorDomains });
      }
    } catch (err) {
      log.error({ err }, 'Competitor auto-discovery error');
    }
  }

  if (fetchCompetitors && competitorDomains.length > 0) {
    try {
      const compLimit = seoDataMode === 'full' ? 200 : 50;
      const fetchMultiplier = provider.name === 'semrush' ? 2 : 1;
      const fetchLimit = compLimit * fetchMultiplier;

      const cappedCompetitorDomains = competitorDomains.slice(0, MAX_COMPETITORS);
      sendProgress('seo-data', `Fetching competitor keywords (${cappedCompetitorDomains.length} competitors)...`, 0.58);
      for (const comp of cappedCompetitorDomains) {
        const cleanComp = comp.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        try {
          // cache-miss-ok: fetchLimit intentionally differs from compLimit for SEMRush overfetch.
          const rawKws = await provider.getDomainKeywords(cleanComp, ws.id, fetchLimit);
          const compKws = [...rawKws]
            .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
            .slice(0, compLimit);
          for (const ck of compKws) {
            competitorKeywords.push({
              keyword: ck.keyword,
              volume: ck.volume,
              difficulty: ck.difficulty,
              domain: cleanComp,
              position: ck.position,
              serpFeatures: ck.serpFeatures,
            });
          }
          log.info(`Got ${compKws.length} keywords from competitor ${cleanComp} (fetched ${rawKws.length})`);
        } catch (err) {
          log.warn({ err }, `Failed to fetch keywords for competitor ${cleanComp}`);
        }
      }

      if (competitorKeywords.length > 0) {
        seoContext += `\n\nCOMPETITOR KEYWORDS (what your competitors rank for — these are proven industry terms):\n`;
        const seen = new Set<string>();
        const deduped = competitorKeywords
          .filter(k => { const lc = k.keyword.toLowerCase(); if (seen.has(lc)) return false; seen.add(lc); return true; })
          .sort((a, b) => b.volume - a.volume);
        seoContext += deduped.slice(0, 50).map(k =>
          `- "${k.keyword}" (vol: ${k.volume}/mo, KD: ${k.difficulty}%) — ${k.domain} ranks #${k.position}`
        ).join('\n');
      }
    } catch (err) {
      log.error({ err }, 'Competitor keywords error');
    }
  }

  if (fetchCompetitors && competitorDomains.length > 0) {
    try {
      sendProgress('seo-data', `Running keyword gap analysis vs ${competitorDomains.length} competitors...`, 0.60);
      log.info(`Running keyword gap analysis vs ${competitorDomains.join(', ')}...`);
      keywordGaps = await provider.getKeywordGap(siteDomain, competitorDomains, ws.id, 50);
      log.info(`Found ${keywordGaps.length} keyword gaps`);

      if (keywordGaps.length > 0) {
        seoContext += `\n\nCOMPETITOR KEYWORD GAPS (keywords competitors rank for but YOU don't — HIGHEST priority opportunities):\n`;
        seoContext += keywordGaps.slice(0, 30).map(g =>
          `- "${g.keyword}" (vol: ${g.volume}/mo, KD: ${g.difficulty}%) — ${g.competitorDomain} ranks #${g.competitorPosition}`
        ).join('\n');
      }
    } catch (err) {
      log.error({ err }, 'Keyword gap error');
    }
  }

  if (fetchCompetitors && (competitorKeywords.length > 0 || keywordGaps.length > 0)) {
    updateWorkspace(ws.id, {
      competitorLastFetchedAt: new Date().toISOString(),
      competitorDomainsAtLastFetch: competitorDomains,
    });
  }

  if (seoDataMode === 'full') {
    try {
      sendProgress('seo-data', 'Fetching related keyword ideas...', 0.65);
      const seedKeywords = domainKeywords.filter(k => k.keyword?.trim()).slice(0, 5).map(k => k.keyword);
      for (const seed of seedKeywords) {
        const related = await provider.getRelatedKeywords(seed, ws.id, 10);
        relatedKeywords.push(...related);
      }
      if (relatedKeywords.length > 0) {
        const unique = relatedKeywords.filter((k, i, arr) => arr.findIndex(x => x.keyword === k.keyword) === i);
        seoContext += `\n\nSEO PROVIDER RELATED KEYWORDS (expansion ideas with real volume):\n`;
        seoContext += unique.slice(0, 30).map(k =>
          `- "${k.keyword}" (vol: ${k.volume}/mo, KD: ${k.difficulty}%)`
        ).join('\n');
      }
    } catch (err) {
      log.error({ err }, 'Related keywords error');
    }

    try {
      sendProgress('seo-data', 'Fetching question-based keywords for FAQ/AEO...', 0.67);
      const qSeeds = domainKeywords.filter(k => k.keyword?.trim() && k.volume > 100).slice(0, 5).map(k => k.keyword);
      for (const seed of qSeeds) {
        const questions = await provider.getQuestionKeywords(seed, ws.id, 10);
        if (questions.length > 0) {
          questionKeywords.push({ seed, questions: questions.map(q => ({ keyword: q.keyword, volume: q.volume })) });
        }
      }
      const allQs = questionKeywords.flatMap(q => q.questions);
      if (allQs.length > 0) {
        const uniqueQs = allQs.filter((q, i, arr) => arr.findIndex(x => x.keyword === q.keyword) === i)
          .sort((a, b) => b.volume - a.volume);
        seoContext += `\n\nQUESTION KEYWORDS (real questions people search — use for FAQ sections, AEO, featured snippets):\n`;
        seoContext += uniqueQs.slice(0, 20).map(q =>
          `- "${q.keyword}" (${q.volume}/mo)`
        ).join('\n');
        log.info(`Found ${uniqueQs.length} unique question keywords from ${qSeeds.length} seeds`);
      }
    } catch (err) {
      log.error({ err }, 'Question keywords error');
    }
  }

  return { seoContext, domainKeywords, keywordGaps, relatedKeywords, questionKeywords, competitorKeywords };
}
