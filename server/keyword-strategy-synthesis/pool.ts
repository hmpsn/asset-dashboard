import type { KeywordSourceEvidence } from '../../shared/types/keywords.js';
import type { CompetitorKeywordData } from '../keyword-strategy-seo-data.js';
import type { DomainKeyword, KeywordGapEntry, RelatedKeyword } from '../seo-data-provider.js';
import { normalizePageUrl } from '../../shared/page-address-utils.js';
import { filterBrandedKeywords } from '../competitor-brand-filter.js';
import { normalizeKeyword } from '../keyword-intelligence/index.js';
import { isStrategyQualityDiscoveryKeyword, upsertKeywordPoolCandidate } from '../keyword-strategy-helpers.js';
import { filterDeclinedFromPool } from '../strategy-filters.js';
import type { KeywordStrategyKeywordPool } from './types.js';

export interface BuildLegacyKeywordPoolOptions {
  /** Canonical pool Map (mutated in place; same Map the caller reads). */
  keywordPool: KeywordStrategyKeywordPool;
  /** Per-page provider-keyword lookup (mutated in place for page assignment). */
  semrushByPath: Map<string, DomainKeyword[]>;
  domainKeywords: DomainKeyword[];
  gscData: Array<{ query: string; impressions: number }>;
  competitorKeywords: CompetitorKeywordData[];
  keywordGaps: KeywordGapEntry[];
  discoveryKeywords: KeywordSourceEvidence[];
  relatedKeywords: RelatedKeyword[];
  /** Already-resolved client-tracked rows; caller owns the DB read. */
  clientTracked: Array<{ query: string }>;
  requestedKeywords: string[];
  competitorDomains: string[];
  declinedKeywords: string[];
  providerName?: string;
  /** Shared admission predicate, closed over the workspace evaluation context. */
  isEligible: (k: { keyword: string; volume?: number; difficulty?: number; cpc?: number; source?: string; sourceKind?: string }) => boolean;
}

export interface BuildLegacyKeywordPoolResult {
  /** Pre-filter client increment count; this is part of legacy prompt parity. */
  clientKeywordsAdded: number;
  brandedRemoved: number;
  declinedPoolRemoved: number;
}

export function buildLegacyKeywordPool(opts: BuildLegacyKeywordPoolOptions): BuildLegacyKeywordPoolResult {
  const {
    keywordPool, semrushByPath, domainKeywords, gscData, competitorKeywords,
    keywordGaps, discoveryKeywords, relatedKeywords, clientTracked,
    requestedKeywords, competitorDomains, declinedKeywords, providerName, isEligible,
  } = opts;

  if (domainKeywords.length > 0) {
    for (const k of domainKeywords) {
      const eligible = isEligible({ keyword: k.keyword, volume: k.volume, difficulty: k.difficulty, source: providerName ?? 'seo-provider' });
      if (!eligible) continue;
      const p = normalizePageUrl(k.url);
      if (!semrushByPath.has(p)) semrushByPath.set(p, []);
      semrushByPath.get(p)!.push(k);
      upsertKeywordPoolCandidate(keywordPool, k.keyword, { volume: k.volume, difficulty: k.difficulty, cpc: k.cpc, source: providerName ?? 'seo-provider' });
    }
  }

  for (const r of gscData) {
    const q = normalizeKeyword(r.query);
    if (q.length > 3 && q.split(' ').length >= 2) {
      upsertKeywordPoolCandidate(keywordPool, q, { volume: r.impressions, difficulty: 0, source: 'gsc' });
    }
  }

  for (const ck of competitorKeywords) {
    const kw = normalizeKeyword(ck.keyword);
    if (ck.volume > 0 && isEligible({ keyword: kw, volume: ck.volume, difficulty: ck.difficulty, source: `competitor:${ck.domain}` })) {
      upsertKeywordPoolCandidate(keywordPool, kw, { volume: ck.volume, difficulty: ck.difficulty, cpc: ck.cpc ?? undefined, source: `competitor:${ck.domain}` });
    }
  }

  for (const gap of keywordGaps) {
    const kw = normalizeKeyword(gap.keyword);
    if (gap.volume > 0 && isEligible({ keyword: kw, volume: gap.volume, difficulty: gap.difficulty, source: `gap:${gap.competitorDomain}` })) {
      upsertKeywordPoolCandidate(keywordPool, kw, { volume: gap.volume, difficulty: gap.difficulty, source: `gap:${gap.competitorDomain}` });
    }
  }

  for (const dk of discoveryKeywords) {
    const kw = normalizeKeyword(dk.keyword);
    if (isStrategyQualityDiscoveryKeyword(dk) && isEligible(dk)) {
      upsertKeywordPoolCandidate(keywordPool, kw, { volume: dk.volume, difficulty: dk.difficulty, cpc: dk.cpc, intent: dk.intent, source: `discovery:${dk.sourceKind}` });
    }
  }

  for (const rk of relatedKeywords) {
    const kw = normalizeKeyword(rk.keyword);
    if (rk.volume > 0 && isEligible({ keyword: kw, volume: rk.volume, difficulty: rk.difficulty, cpc: rk.cpc, source: 'related' })) {
      upsertKeywordPoolCandidate(keywordPool, kw, { volume: rk.volume, difficulty: rk.difficulty, cpc: rk.cpc, source: 'related' });
    }
  }

  let clientKeywordsAdded = 0;
  for (const tk of clientTracked) {
    const kw = normalizeKeyword(tk.query);
    if (kw.length > 1) {
      const added = upsertKeywordPoolCandidate(keywordPool, kw, { volume: 0, difficulty: 0, source: 'client' });
      if (!added) continue;
      clientKeywordsAdded++;
    }
  }

  for (const kw of requestedKeywords) {
    const added = upsertKeywordPoolCandidate(keywordPool, kw, { volume: 0, difficulty: 0, source: 'client' });
    if (added) {
      clientKeywordsAdded++;
    }
  }

  const brandedRemoved = filterBrandedKeywords(keywordPool, competitorDomains);
  const declinedPoolRemoved = filterDeclinedFromPool(keywordPool, declinedKeywords);
  return { clientKeywordsAdded, brandedRemoved, declinedPoolRemoved };
}

export function buildKeywordPoolSection(
  pool: KeywordStrategyKeywordPool,
  maxKeywords = 200,
): string {
  if (pool.size === 0) return '';
  const poolList = [...pool.entries()]
    .sort((a, b) => b[1].volume - a[1].volume)
    .slice(0, maxKeywords)
    .map(([kw, m]) => `"${kw}" (${m.volume}/mo${m.difficulty ? ` KD:${m.difficulty}%` : ''})`)
    .join(', ');
  const clientKws = [...pool.entries()]
    .filter(([, m]) => m.source === 'client')
    .map(([kw]) => `"${kw}"`);
  const clientNote =
    clientKws.length > 0
      ? `\n\nCLIENT-REQUESTED KEYWORDS — The client specifically wants to target these keywords. Give them PRIORITY when assigning to relevant pages, and ensure they appear in content gap suggestions if no existing page covers them:\n${clientKws.join(', ')}`
      : '';
  return `\n\nKEYWORD POOL — VERIFIED search terms with real volume. You MUST pick primaryKeyword from this list when a reasonable match exists for the page topic. Only invent a new keyword if NONE of these are relevant:\n${poolList}${clientNote}`;
}
