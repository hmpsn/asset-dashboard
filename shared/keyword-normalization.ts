/**
 * Canonical keyword comparison for command-center and keyword-lifecycle joins.
 *
 * This intentionally stays conservative: it normalizes casing, punctuation,
 * and whitespace without stemming or stripping local modifiers. Broader
 * semantic normalization belongs in the follow-up hardening item.
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
