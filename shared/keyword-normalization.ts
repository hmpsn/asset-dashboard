/**
 * Memoization cache for `normalizeKeywordForComparison`.
 *
 * `normalizeKeywordForComparison` is a PURE function (same input → same output),
 * so caching is provably output-identical. The Keyword Command Center calls it
 * on the order of a million times per `/rows` request (ranks × strategy keys ×
 * tokens, across several redundant passes), re-normalizing the same `(query,
 * key)` pairs dozens of times — the dominant cost of the 10-15s Hub load on a
 * ~1800-keyword workspace. Memoizing collapses that to one regex pass per
 * distinct raw string.
 *
 * Bounded (FIFO eviction at `NORMALIZE_CACHE_MAX`) so a pathological input
 * stream can't grow it without limit; the working set for a single workspace is
 * a few thousand distinct strings, well under the cap.
 */
const NORMALIZE_CACHE_MAX = 50_000;
const normalizeCache = new Map<string, string>();

/**
 * Canonical semantic keyword comparison for the keyword operating loop.
 *
 * Use this for equality, dedupe, feedback joins, strategy/tracking joins, and
 * lifecycle checks. Do not use it for provider request payloads, display text,
 * or provider/cache keys where exact raw keyword text is contract-sensitive.
 */
export function normalizeKeywordForComparison(keyword: string | null | undefined): string {
  const raw = keyword == null ? '' : String(keyword);
  const cached = normalizeCache.get(raw);
  if (cached !== undefined) return cached;
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalizeCache.size >= NORMALIZE_CACHE_MAX) {
    // FIFO eviction: drop the oldest insertion. Cheap and keeps memory bounded;
    // exact eviction policy is irrelevant to correctness (the function is pure).
    const oldest = normalizeCache.keys().next().value;
    if (oldest !== undefined) normalizeCache.delete(oldest);
  }
  normalizeCache.set(raw, normalized);
  return normalized;
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

/**
 * A reusable, query-by-query parent matcher built ONCE over a fixed parent-key
 * set. `lookup(query)` returns the same result as
 * `findBestParent(query, parentKeys, zeroMetricsMap)` for that set, but in
 * ~O(query tokens × parents-sharing-a-token) instead of O(parents) per query.
 *
 * Why this is byte-identical to the brute-force scan: `isVariantOf` matches a
 * parent only when EVERY token of the (≥2-token) parent appears in the query's
 * token set — so any true match necessarily shares at least one token with the
 * query. An inverted `token → parents` index therefore yields a SUPERSET of the
 * true matches; we then run the IDENTICAL winner-selection over that narrowed
 * superset. Parents that share no query token could never have passed
 * `isVariantOf`, so excluding them cannot change the winner. Single-token
 * parents are excluded up front (they never satisfy `isVariantOf`).
 *
 * The impressions tie-breaker is fixed at 0 for every parent, matching
 * `findVariantParentKey`'s `new Map(parentKeys.map(key => [key, 0]))` — the only
 * call site that needs this index. With equal (zero) impressions the tie-break
 * reduces to: more tokens wins, then lexically-smaller key wins.
 */
export interface VariantParentIndex {
  lookup(query: string): string | null;
}

export function createVariantParentIndex(parentKeys: string[]): VariantParentIndex {
  // token -> list of parent keys whose normalized form contains that token.
  const tokenToParents = new Map<string, string[]>();
  // parent key -> { tokens (as a Set, for the every() check), tokenCount }.
  const parentMeta = new Map<string, { tokens: Set<string>; tokenCount: number }>();

  for (const key of parentKeys) {
    if (parentMeta.has(key)) continue; // dedupe (the real call path passes a Set-derived array)
    const normalized = normalizeKeywordForComparison(key);
    if (!normalized) continue;
    const tokens = normalized.split(' ');
    if (tokens.length < 2) continue; // single-token parents never satisfy isVariantOf
    const tokenSet = new Set(tokens);
    parentMeta.set(key, { tokens: tokenSet, tokenCount: tokens.length });
    for (const token of tokenSet) {
      const bucket = tokenToParents.get(token);
      if (bucket) bucket.push(key);
      else tokenToParents.set(token, [key]);
    }
  }

  return {
    lookup(query: string): string | null {
      const normalizedQuery = normalizeKeywordForComparison(query);
      if (!normalizedQuery) return null;
      const queryTokens = new Set(normalizedQuery.split(' '));

      // Gather the candidate parents that share at least one query token.
      // Dedupe via a Set because a parent can be reached through several tokens.
      const candidates = new Set<string>();
      for (const token of queryTokens) {
        const bucket = tokenToParents.get(token);
        if (!bucket) continue;
        for (const key of bucket) candidates.add(key);
      }
      if (candidates.size === 0) return null;

      // IDENTICAL winner-selection to findBestParent (impressions fixed at 0):
      // more tokens wins; equal tokens → lexically-smaller key wins.
      let best: string | null = null;
      let bestTokenCount = 0;
      for (const key of candidates) {
        const meta = parentMeta.get(key);
        if (!meta) continue;
        // isVariantOf: every parent token must be in the query token set.
        let isVariant = true;
        for (const token of meta.tokens) {
          if (!queryTokens.has(token)) { isVariant = false; break; }
        }
        if (!isVariant) continue;
        const tokenCount = meta.tokenCount;
        if (
          tokenCount > bestTokenCount
          || (tokenCount === bestTokenCount && (best === null || key < best))
        ) {
          best = key;
          bestTokenCount = tokenCount;
        }
      }
      return best;
    },
  };
}
