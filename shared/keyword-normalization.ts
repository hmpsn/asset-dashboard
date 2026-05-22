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
    ) {
      best = key;
      bestTokenCount = tokenCount;
      bestImpressions = impressions;
    }
  }

  return best;
}
