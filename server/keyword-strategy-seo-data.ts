import { updateWorkspace } from './workspaces.js';
import { shouldFetchCompetitorData } from './keyword-strategy-helpers.js';
import { filterDiscoveredCompetitors } from './competitor-domain-filter.js';
import { MAX_COMPETITORS } from './constants.js';
import { listKeywordGaps } from './keyword-gaps.js';
import { createLogger } from './logger.js';
import { listProviders } from './seo-data-provider.js';
import { workspaceProviderGeo } from './seo-target-geo.js';
import type { DomainKeyword, KeywordGapEntry, RelatedKeyword, SeoDataProvider } from './seo-data-provider.js';
import type { KeywordSourceEvidence } from '../shared/types/keywords.js';
import type { SeoDataStatus, Workspace } from '../shared/types/workspace.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';

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
  discoveryKeywords: KeywordSourceEvidence[];
  relatedKeywords: RelatedKeyword[];
  questionKeywords: QuestionKeywordGroup[];
  competitorKeywords: CompetitorKeywordData[];
  seoDataStatus: SeoDataStatus;
}

function hasAlternateConfiguredProvider(provider: SeoDataProvider | null): boolean {
  const configured = listProviders().filter(p => p.configured);
  if (!provider) return configured.length > 0;
  return configured.some(p => p.name !== provider.name);
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
  const discoveryKeywords: KeywordSourceEvidence[] = [];
  const relatedKeywords: RelatedKeyword[] = [];
  const questionKeywords: QuestionKeywordGroup[] = [];
  const competitorKeywords: CompetitorKeywordData[] = [];
  const providerReasons = new Set<string>();
  const providerRequested = seoDataMode !== 'none';
  const seoDataStatus: SeoDataStatus = {
    mode: seoDataMode,
    provider: provider?.name,
    status: seoDataMode === 'none' ? 'disabled' : 'available',
    fallbackProviderAvailable: hasAlternateConfiguredProvider(provider),
  };

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
    if (!provider && providerRequested) {
      seoDataStatus.status = 'degraded';
      providerReasons.add('no_configured_provider');
    }
    seoDataStatus.reasons = [...providerReasons];
    return { seoContext, domainKeywords, keywordGaps, discoveryKeywords, relatedKeywords, questionKeywords, competitorKeywords, seoDataStatus };
  }

  sendProgress('seo-data', `Fetching keyword intelligence via ${provider.name}...`, 0.55);
  if (!fetchCompetitors) {
    log.info(`Incremental mode: skipping competitor re-fetch (last fetched ${ws.competitorLastFetchedAt})`);
    sendProgress('seo-data', 'Competitor data still fresh — skipping re-fetch...', 0.58);
  }

  const siteDomain = baseUrl ? new URL(baseUrl).hostname : '';
  if (!siteDomain) {
    seoDataStatus.status = 'degraded';
    providerReasons.add('missing_site_domain');
    seoDataStatus.reasons = [...providerReasons];
    return { seoContext, domainKeywords, keywordGaps, discoveryKeywords, relatedKeywords, questionKeywords, competitorKeywords, seoDataStatus };
  }

  // Geo for this CLIENT workspace's domain/competitor/gap SERP queries. `{}` when
  // the geo-targeting flag is OFF (byte-identical to pre-P4); resolved
  // { locationCode, languageCode } when ON. Competitor-domain calls below also use
  // the CLIENT geo — we want the client's target SERP, not the competitor's. (P4)
  const geo = workspaceProviderGeo(ws.id);

  try {
    log.info(`Fetching domain organic keywords for ${siteDomain}...`);
    domainKeywords = await provider.getDomainKeywords(siteDomain, ws.id, 200, undefined, geo.locationCode, geo.languageCode);
    log.info(`Got ${domainKeywords.length} domain keywords`);

    if (domainKeywords.length > 0) {
      seoContext += `\n\nSEO PROVIDER DOMAIN ORGANIC KEYWORDS (real search volume + difficulty data):\n`;
      seoContext += domainKeywords.slice(0, 100).map(k =>
        `- "${k.keyword}" → ${k.url} (pos: #${k.position}, vol: ${k.volume}/mo, KD: ${k.difficulty}%, CPC: $${k.cpc}, traffic: ${k.traffic})`
      ).join('\n');
    }
  } catch (err) {
    log.error({ err }, 'Domain organic error');
    providerReasons.add('domain_keywords_error');
  }

  if (fetchCompetitors && competitorDomains.length === 0) {
    try {
      sendProgress('seo-data', 'Auto-discovering organic competitors...', 0.57);
      const discovered = await provider.getCompetitors(siteDomain, ws.id, 5, undefined, geo.locationCode, geo.languageCode);
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
      providerReasons.add('competitor_discovery_error');
    }
  }

  if (fetchCompetitors && competitorDomains.length > 0) {
    try {
      const compLimit = seoDataMode === 'full' ? 200 : 50;
      const fetchLimit = compLimit;

      const cappedCompetitorDomains = competitorDomains.slice(0, MAX_COMPETITORS);
      sendProgress('seo-data', `Fetching competitor keywords (${cappedCompetitorDomains.length} competitors)...`, 0.58);
      for (const comp of cappedCompetitorDomains) {
        const cleanComp = comp.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        try {
          const rawKws = await provider.getDomainKeywords(cleanComp, ws.id, fetchLimit, undefined, geo.locationCode, geo.languageCode);
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
          providerReasons.add('competitor_keywords_partial_error');
        }
      }

      if (competitorKeywords.length > 0) {
        seoContext += `\n\nCOMPETITOR KEYWORDS (what your competitors rank for — these are proven industry terms):\n`;
        const seen = new Set<string>();
        const deduped = competitorKeywords
          .filter(k => { const lc = keywordComparisonKey(k.keyword); if (seen.has(lc)) return false; seen.add(lc); return true; })
          .sort((a, b) => b.volume - a.volume);
        seoContext += deduped.slice(0, 50).map(k =>
          `- "${k.keyword}" (vol: ${k.volume}/mo, KD: ${k.difficulty}%) — ${k.domain} ranks #${k.position}`
        ).join('\n');
      }
    } catch (err) {
      log.error({ err }, 'Competitor keywords error');
      providerReasons.add('competitor_keywords_error');
    }
  }

  if (fetchCompetitors && competitorDomains.length > 0) {
    try {
      sendProgress('seo-data', `Running keyword gap analysis vs ${competitorDomains.length} competitors...`, 0.60);
      log.info(`Running keyword gap analysis vs ${competitorDomains.join(', ')}...`);
      keywordGaps = await provider.getKeywordGap(siteDomain, competitorDomains, ws.id, 50, undefined, geo.locationCode, geo.languageCode);
      log.info(`Found ${keywordGaps.length} keyword gaps`);

      if (keywordGaps.length > 0) {
        seoContext += `\n\nCOMPETITOR KEYWORD GAPS (keywords competitors rank for but YOU don't — HIGHEST priority opportunities):\n`;
        seoContext += keywordGaps.slice(0, 30).map(g =>
          `- "${g.keyword}" (vol: ${g.volume}/mo, KD: ${g.difficulty}%) — ${g.competitorDomain} ranks #${g.competitorPosition}`
        ).join('\n');
      }
    } catch (err) {
      log.error({ err }, 'Keyword gap error');
      providerReasons.add('keyword_gap_error');
    }
  }

  if (fetchCompetitors && (competitorKeywords.length > 0 || keywordGaps.length > 0)) {
    updateWorkspace(ws.id, {
      competitorLastFetchedAt: new Date().toISOString(),
      competitorDomainsAtLastFetch: competitorDomains,
    });
  }

  // The keyword-universe assembler is the SOLE owner of the discovery/related/question
  // provider fetches (geo + resolved-language threaded). A legacy en-only prefetch here
  // would double provider credits for non-en workspaces and seed the prompt with en
  // keywords while the pool carries resolved-language ones, so it is intentionally NOT
  // run on this path — discoveryKeywords/relatedKeywords/questionKeywords stay empty and
  // the prompt gets discovery context through the universe-built KEYWORD POOL block.
  // (The retired keyword-universe-full flag previously gated this; the unreachable
  // en-only prefetch branch was removed in the 2026-06-24 simplification audit.)

  if (
    providerRequested
    && domainKeywords.length === 0
    && keywordGaps.length === 0
    && competitorKeywords.length === 0
    && discoveryKeywords.length === 0
    && relatedKeywords.length === 0
    && questionKeywords.length === 0
  ) {
    providerReasons.add('provider_returned_no_keyword_data');
  }
  if (providerReasons.size > 0) {
    seoDataStatus.status = 'degraded';
    seoDataStatus.reasons = [...providerReasons];
  }

  return { seoContext, domainKeywords, keywordGaps, discoveryKeywords, relatedKeywords, questionKeywords, competitorKeywords, seoDataStatus };
}
