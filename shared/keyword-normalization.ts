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
