/**
 * Server-side collection utilities.
 * Replaces scattered deduplication and unique-string logic across keyword
 * strategy, topic cluster, and gap modules.
 */

/**
 * Deduplicate an array using a caller-supplied key function.
 * First occurrence wins — subsequent items with the same key are dropped.
 */
export function dedupeBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Deduplicate an array using a caller-supplied key function.
 * Last occurrence wins — earlier items with the same key are dropped.
 * Use when later entries in the array are considered more authoritative.
 */
export function dedupeByLast<T>(items: T[], keyFn: (item: T) => string): T[] {
  return dedupeBy([...items].reverse(), keyFn).reverse();
}

/**
 * Deduplicate items that have a `keyword` field, using normalized
 * (lowercase + trimmed) keyword as the key.
 */
export function dedupeByNormalizedKeyword<T extends { keyword: string }>(items: T[]): T[] {
  return dedupeBy(items, item => item.keyword.toLowerCase().trim());
}

/**
 * Return unique strings from `values`.
 *
 * Options:
 *  - `caseInsensitive` (default false) — fold to lowercase before comparing;
 *    the returned value preserves the first-seen original case.
 *  - `trim` (default false) — strip leading/trailing whitespace before comparing.
 */
export function uniqStrings(
  values: string[],
  opts?: { caseInsensitive?: boolean; trim?: boolean },
): string[] {
  const ci = opts?.caseInsensitive ?? false;
  const tr = opts?.trim ?? false;
  const seen = new Set<string>();
  return values.filter(v => {
    let key = tr ? v.trim() : v;
    if (ci) key = key.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
