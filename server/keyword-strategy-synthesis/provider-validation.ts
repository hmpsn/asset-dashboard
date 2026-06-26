import { createLogger } from '../logger.js';
import { listPageKeywords } from '../page-keywords.js';
import { normalizeKeyword } from '../keyword-intelligence/index.js';
import type { DomainKeyword, SeoDataProvider } from '../seo-data-provider.js';
import type { PageMapping } from './types.js';

const log = createLogger('keyword-strategy:synthesis');

export interface ValidatePageMappingsWithProviderOptions {
  workspaceId: string;
  pageMappings: PageMapping[];
  provider: SeoDataProvider | null;
  seoDataMode: 'quick' | 'full' | 'none';
  domainKeywords: DomainKeyword[];
  usedKeywordUniverse: boolean;
  isSuspiciousGroupedVolume: (keyword: string, volume: number) => boolean;
  resolveLocationCode: (workspaceId: string) => number | null;
  resolveLanguageCode: (workspaceId: string) => string | null;
}

export async function validatePageMappingsWithProvider({
  workspaceId,
  pageMappings,
  provider,
  seoDataMode,
  domainKeywords,
  usedKeywordUniverse,
  isSuspiciousGroupedVolume,
  resolveLocationCode,
  resolveLanguageCode,
}: ValidatePageMappingsWithProviderOptions): Promise<void> {
  if (!provider || seoDataMode === 'none') return;

  const domainKwLookup = new Map(domainKeywords.map(k => [normalizeKeyword(k.keyword), k])); // map-dup-ok
  const existingPkLookup = new Map(
    listPageKeywords(workspaceId)
      .filter(pk => pk.volume && pk.volume > 0 && !isSuspiciousGroupedVolume(pk.primaryKeyword, pk.volume))
      .map(pk => [normalizeKeyword(pk.primaryKeyword), pk])
  );

  // First pass: enrich from already-fetched data (no API calls)
  const needsApiLookup: string[] = [];
  let preEnriched = 0;
  for (const pm of pageMappings) {
    const kwLower = normalizeKeyword(pm.primaryKeyword ?? '');
    if (!kwLower) continue;
    const domainHit = domainKwLookup.get(kwLower);
    if (domainHit && domainHit.volume > 0) {
      pm.validated = true;
      pm.volume = domainHit.volume;
      pm.difficulty = domainHit.difficulty;
      preEnriched++;
      continue;
    }
    const pkHit = existingPkLookup.get(kwLower);
    if (pkHit && pkHit.volume && pkHit.volume > 0) {
      pm.validated = true;
      pm.volume = pkHit.volume;
      pm.difficulty = pkHit.difficulty ?? 0;
      preEnriched++;
      continue;
    }
    needsApiLookup.push(pm.primaryKeyword);
  }
  log.info(`Keyword validation: ${preEnriched} pre-enriched from existing data, ${needsApiLookup.length} need API lookup`);

  if (needsApiLookup.length === 0) return;

  try {
    const uniqueNeedsByKey = new Map<string, string>();
    for (const keyword of needsApiLookup) {
      const key = normalizeKeyword(keyword);
      if (key && !uniqueNeedsByKey.has(key)) {
        uniqueNeedsByKey.set(key, keyword);
      }
    }
    const uniqueNeeds = [...uniqueNeedsByKey.values()];
    const locationCode = resolveLocationCode(workspaceId) ?? undefined;
    // On the keyword-universe path validate page keywords in the resolved workspace
    // language; legacy validation leaves language undefined to preserve provider defaults.
    const languageCode = usedKeywordUniverse ? resolveLanguageCode(workspaceId) ?? undefined : undefined;
    const metrics = await provider.getKeywordMetrics(uniqueNeeds.slice(0, 100), workspaceId, undefined, locationCode, languageCode);
    const metricMap = new Map(metrics.map(m => [normalizeKeyword(m.keyword), m])); // map-dup-ok

    let unvalidated = 0;
    for (const pm of pageMappings) {
      if (pm.validated != null) continue;
      const m = metricMap.get(normalizeKeyword(pm.primaryKeyword));
      if (m && m.volume > 0 && !isSuspiciousGroupedVolume(m.keyword, m.volume)) {
        pm.validated = true;
        pm.volume = m.volume;
        pm.difficulty = m.difficulty;
      } else {
        pm.validated = false;
        unvalidated++;
      }
    }
    log.info(`API validation: ${needsApiLookup.length - unvalidated} validated, ${unvalidated} unvalidated`);
  } catch (err) {
    log.error({ err }, 'Post-AI keyword validation error');
  }
}
