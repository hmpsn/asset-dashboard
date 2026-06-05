/**
 * Canonical semantic keyword comparison for the keyword operating loop.
 *
 * Use this for equality, dedupe, feedback joins, strategy/tracking joins, and
 * lifecycle checks. Do not use it for provider request payloads, display text,
 * or provider/cache keys where exact raw keyword text is contract-sensitive.
 */
export function normalizeKeywordForComparison(keyword: string | null | undefined): string {
  return String(keyword ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function keywordComparisonKey(keyword: string | null | undefined): string {
  return normalizeKeywordForComparison(keyword);
}

const JUNK_MAX_CHARS = 150;
const JUNK_MAX_TOKENS = 15;
const JUNK_MIN_NORMALIZED_CHARS = 3;
/** Advanced-search / research operators (`site:`, `intitle:`, etc.) — a query, not a keyword. */
const RESEARCH_SYNTAX = /\b(site|intitle|allintitle|intext|allintext|inurl|allinurl|inanchor|filetype|related|cache):/i;
const BOOLEAN_OPERATOR_TOKENS = new Set(['or', 'and', 'not']);

/**
 * Tier-1 junk gate for the keyword universe: detect MALFORMED strings that are
 * not real keywords — boolean/quoted research queries (the owner-observed
 * `"teeth whitening" "new patient" discount or special or package or offer`),
 * advanced-search syntax, and length outliers. Operates on the RAW string
 * (before normalization) so it can still see the quotes/operators the
 * comparison normalizer would strip.
 *
 * Deliberately conservative — must NOT drop legitimate keywords that merely
 * contain "or"/"and" inside a word (organic, android) or a single conjunction
 * (bed and breakfast). It is applied to EVERY population (ranking, curated,
 * discovery); the relevance heuristic (isStrategyPoolEligibleKeyword) is a
 * separate Tier-2 gate applied to discovery only.
 */
export function isJunkKeywordString(
  keyword: string | null | undefined,
): { isJunk: boolean; reason?: string } {
  const raw = String(keyword ?? '').trim();
  if (raw.length === 0) return { isJunk: true, reason: 'too_short' };
  if (RESEARCH_SYNTAX.test(raw)) return { isJunk: true, reason: 'research_syntax' };
  if (raw.includes('"')) return { isJunk: true, reason: 'quoted_phrases' };

  const tokens = raw.toLowerCase().split(/\s+/);
  const operatorCount = tokens.filter(t => BOOLEAN_OPERATOR_TOKENS.has(t)).length;
  if (operatorCount >= 2) return { isJunk: true, reason: 'boolean_operator' };

  if (raw.length > JUNK_MAX_CHARS || tokens.length > JUNK_MAX_TOKENS) return { isJunk: true, reason: 'too_long' };
  if (normalizeKeywordForComparison(raw).length < JUNK_MIN_NORMALIZED_CHARS) return { isJunk: true, reason: 'too_short' };

  return { isJunk: false };
}

/**
 * Returns true if a GSC query is a meaningful variant of a strategy keyword.
 * All strategy tokens must appear in the query, order-independent. Single-token
 * strategy keywords are too broad to safely parent variants.
 */
export function isVariantOf(gscQuery: string, strategyKeyword: string): boolean {
  const normalizedQuery = normalizeKeywordForComparison(gscQuery);
  const normalizedStrategy = normalizeKeywordForComparison(strategyKeyword);
  if (!normalizedQuery || !normalizedStrategy) return false;

  const keywordTokens = normalizedStrategy.split(' ');
  if (keywordTokens.length < 2) return false;

  const queryTokens = new Set(normalizedQuery.split(' '));
  return keywordTokens.every(token => queryTokens.has(token));
}

/**
 * Returns the best strategy key that can parent a GSC query variant.
 * Longest token match wins; impressions provide a stable tie-breaker.
 */
export function findBestParent(
  gscQuery: string,
  strategyKeys: string[],
  metricsMap: Map<string, number>,
): string | null {
  let best: string | null = null;
  let bestTokenCount = 0;
  let bestImpressions = -1;

  for (const key of strategyKeys) {
    if (!isVariantOf(gscQuery, key)) continue;
    const tokenCount = normalizeKeywordForComparison(key).split(' ').length;
    const impressions = metricsMap.get(key) ?? 0;
    if (
      tokenCount > bestTokenCount
      || (tokenCount === bestTokenCount && impressions > bestImpressions)
      || (tokenCount === bestTokenCount && impressions === bestImpressions && (best === null || key < best))
    ) {
      best = key;
      bestTokenCount = tokenCount;
      bestImpressions = impressions;
    }
  }

  return best;
}
