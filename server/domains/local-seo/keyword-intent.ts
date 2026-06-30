import type {
  LocalSeoKeywordIntent,
  LocalSeoMarket,
} from '../../../shared/types/local-seo.js';
import type { LocalSeoKeywordCandidate } from './types.js';

export function cleanKeywordDisplay(keyword: string | undefined): string | undefined {
  const cleaned = keyword?.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length < 3 || cleaned.length > 90) return undefined;
  return cleaned;
}

/**
 * Returns true if `title` looks like a local service keyword (short enough and
 * matches service vocabulary).
 *
 * When called with a `serviceTermRegex` derived from the workspace via
 * `buildWorkspaceServiceTermRegex`, the match is per-workspace and accurate for
 * any industry. Without it, a broad cross-industry fallback regex is used — this
 * is only appropriate for tests and callers that deliberately have no workspace
 * context (the `iterateLocalCandidateSignals` hot path always passes a regex).
 */
export function titleLooksLikeServiceKeyword(
  title: string | undefined,
  serviceTermRegex?: RegExp,
): boolean {
  const cleaned = cleanKeywordDisplay(title);
  if (!cleaned) return false;
  const tokens = cleaned.split(/\s+/);
  if (tokens.length > 6) return false;
  // Use the provided per-workspace regex, or fall back to the broad cross-industry
  // list. The fallback retains dental/legal/contractor coverage for the test suite
  // and for callers that have no workspace context.
  const regex = serviceTermRegex ?? /dent|dental|implant|invisalign|veneer|whiten|emergency|orthodont|clinic|law|attorney|restaurant|contractor|plumb|roof|med spa|service/i;
  return regex.test(cleaned);
}

export function normalizeText(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function hasMarketModifier(keyword: string, markets: LocalSeoMarket[]): boolean {
  const normalized = normalizeText(keyword);
  if (/\bnear me\b|\blocal\b/.test(normalized)) return true;
  return markets.some(market => {
    const city = normalizeText(market.city);
    const state = normalizeText(market.stateOrRegion);
    return Boolean((city && normalized.includes(city)) || (state && normalized.includes(state)));
  });
}

/**
 * Classify the search intent of a local SEO keyword using regex patterns.
 * Runs in the hot path — no API calls.
 *
 * Priority order: comparison → informational → commercial → transactional (default)
 *
 * Note: 'navigational' is part of the LocalSeoKeywordIntent union but is never
 * returned by this classifier (it requires workspace brand context not available here).
 * It may be pre-assigned by signal iterators that have that context.
 */
export function classifyLocalKeywordIntent(keyword: string): LocalSeoKeywordIntent {
  const kw = keyword.toLowerCase();
  // Comparison: X vs Y, versus, alternatives, compare
  if (/\bvs\b|\bversus\b|\balternative[s]?\b|\bcompare\b|\bcomparison\b/.test(kw)) {
    return 'comparison';
  }
  // Informational: question words, educational patterns, cost/price research
  if (/^(how |what |why |when |where |which |who |can |does |do |is |are )|\bguide\b|\btutorial\b|\btips\b|\bexplained\b|\boverview\b|\bhistory\b|\bfacts\b|\bstatistics\b|\btypes of\b|\bdifference between\b|\bcost of\b|\bprice of\b|\bpros and cons\b|\bbenefits of\b|\bcauses of\b|\bwhat is\b|\bimpact of\b/.test(kw)) {
    return 'informational';
  }
  // Commercial: pre-buying research with quality signals (still useful for local)
  if (/\b(best|top|top-rated|top rated|affordable|cheap|cheapest|discount|deal|coupon|budget|premium|quality)\b/.test(kw)) {
    return 'commercial';
  }
  // Navigational: brand/domain search (hard to detect without workspace context, skip)
  // Default: transactional (local service + city/near-me patterns)
  return 'transactional';
}

/**
 * A locally-modified keyword variant tagged with the market that produced it.
 *
 * City/state variants carry the originating market's `marketId`. The
 * market-agnostic `"<base> near me"` variant carries `marketId: null` — it is
 * not tied to any single market, so do not fabricate one.
 */
export interface LocalVariantKeyword {
  keyword: string;
  marketId: string | null;
}

/**
 * Market-tagged local variant generation. Yields one entry per generated
 * variant, attributing city/state variants to their originating market so the
 * candidate engine can thread `marketId` onto the resulting candidate. The
 * `near me` variant is market-agnostic and carries `marketId: null`.
 *
 * Dedupe is by keyword text: the first market to produce a given variant string
 * wins its attribution (mirrors the `Set`-based dedupe of the flat helper).
 */
export function localVariantKeywordsByMarket(baseKeyword: string, markets: LocalSeoMarket[]): LocalVariantKeyword[] {
  const base = cleanKeywordDisplay(baseKeyword);
  if (!base) return [];
  const variants: LocalVariantKeyword[] = [];
  const seen = new Set<string>();
  // Dedup is first-market-wins by keyword text: if two markets produce the same
  // variant string (e.g. a city name shared by two markets), it is attributed to
  // the first market only. Very low likelihood at LOCAL_SEO_MAX_MARKETS=3;
  // acknowledged as a known, accepted edge case rather than merged across markets.
  const add = (keyword: string, marketId: string | null) => {
    if (seen.has(keyword)) return;
    seen.add(keyword);
    variants.push({ keyword, marketId });
  };
  for (const market of markets) {
    const city = cleanKeywordDisplay(market.city);
    const state = cleanKeywordDisplay(market.stateOrRegion);
    if (city && !normalizeText(base).includes(normalizeText(city))) {
      add(`${base} ${city}`, market.id);
      if (state && state.length <= 3) add(`${base} ${city} ${state}`, market.id);
    }
  }
  if (!/\bnear me\b/i.test(base)) add(`${base} near me`, null);
  return variants;
}

export function localVariantKeywords(baseKeyword: string, markets: LocalSeoMarket[]): string[] {
  return localVariantKeywordsByMarket(baseKeyword, markets).map(v => v.keyword);
}

export function candidateSourceScore(source: LocalSeoKeywordCandidate['source']): number {
  switch (source) {
    case 'explicit': return 120;
    case 'strategy': return 95;
    case 'tracking': return 90;
    case 'page_assignment': return 85;
    case 'content_gap': return 72;
    case 'local_variant': return 62;
  }
}

const LOCAL_SOURCE_PAGE_BUDGET_FRACTION = 0.20;

/**
 * Apply a per-source-page budget cap to prevent a single page from dominating
 * the refresh budget. Explicit keywords are never capped — they are admin-chosen.
 * Non-explicit keywords without a pagePath share a bucket per source type.
 */
export function applySourcePageCap(candidates: LocalSeoKeywordCandidate[], budget: number): LocalSeoKeywordCandidate[] {
  const pageCap = Math.max(1, Math.ceil(budget * LOCAL_SOURCE_PAGE_BUDGET_FRACTION));
  const pageCounts = new Map<string, number>();
  return candidates.filter(c => {
    if (c.source === 'explicit') return true;
    const key = c.pagePath ?? `__no_page__${c.source}`;
    const count = pageCounts.get(key) ?? 0;
    if (count >= pageCap) return false;
    pageCounts.set(key, count + 1);
    return true;
  });
}
