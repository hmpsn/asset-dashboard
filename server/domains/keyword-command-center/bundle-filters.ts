import {
  createVariantParentIndex,
  keywordComparisonKey,
  type VariantParentIndex,
} from '../../../shared/keyword-normalization.js';
import type { ContentGap, KeywordStrategy, PageKeywordMap } from '../../../shared/types/workspace.js';
import type { TrackedKeyword } from '../../../shared/types/rank-tracking.js';
import type { FeedbackRow } from './types.js';

export function addStrategyKeys(target: Set<string>, strategy: KeywordStrategy | null | undefined): void {
  for (const metric of strategy?.siteKeywordMetrics ?? []) {
    const key = keywordComparisonKey(metric.keyword);
    if (key) target.add(key);
  }
  for (const keyword of strategy?.siteKeywords ?? []) {
    const key = keywordComparisonKey(keyword);
    if (key) target.add(key);
  }
}

export function addPageKeys(target: Set<string>, pageMap: PageKeywordMap[]): void {
  for (const page of pageMap) {
    for (const keyword of [page.primaryKeyword, ...(page.secondaryKeywords ?? [])]) {
      const key = keywordComparisonKey(keyword);
      if (key) target.add(key);
    }
  }
}

export function parentableVariantKeys(input: {
  strategy?: KeywordStrategy | null | undefined;
  pageMap: PageKeywordMap[];
  contentGaps: ContentGap[];
  trackedKeywords: TrackedKeyword[];
  feedback: Map<string, FeedbackRow>;
}): string[] {
  const keys = new Set<string>();
  addStrategyKeys(keys, input.strategy);
  addPageKeys(keys, input.pageMap);
  for (const gap of input.contentGaps) {
    const key = keywordComparisonKey(gap.targetKeyword);
    if (key) keys.add(key);
  }
  for (const keyword of input.trackedKeywords) {
    const key = keywordComparisonKey(keyword.query);
    if (key) keys.add(key);
  }
  for (const row of input.feedback.values()) {
    if (row.status === 'declined') continue;
    const key = keywordComparisonKey(row.keyword);
    if (key) keys.add(key);
  }
  return [...keys];
}

/**
 * Per-array memoized parent index. `findVariantParentKey` is called once per GSC
 * rank across several full-universe passes, always against the SAME `parentKeys`
 * array (the one `parentableVariantKeys` returned for that bundle). Building a
 * token-inverted index once per array — instead of an O(parents) brute-force
 * scan per query — turns the dominant O(ranks x parents) variant-matching cost
 * into O(ranks x tokens). Keyed on array IDENTITY via a WeakMap, so callers that
 * already share one `parentKeys` array (every per-rank loop in a request) share
 * one index for free; the entry is GC'd with the array, so there is no lifetime
 * management. The index is byte-identical to the brute-force result (see
 * createVariantParentIndex + its fuzz parity test).
 */
const variantParentIndexCache = new WeakMap<string[], VariantParentIndex>();

export function findVariantParentKey(query: string, parentKeys: string[]): string | null {
  if (parentKeys.length === 0) return null;
  let index = variantParentIndexCache.get(parentKeys);
  if (!index) {
    index = createVariantParentIndex(parentKeys);
    variantParentIndexCache.set(parentKeys, index);
  }
  return index.lookup(query);
}

export function filterStrategyForKeys(strategy: KeywordStrategy | null | undefined, keys: Set<string> | null): KeywordStrategy | null | undefined {
  if (!strategy || !keys) return strategy;
  return {
    ...strategy,
    siteKeywords: (strategy.siteKeywords ?? []).filter(keyword => keys.has(keywordComparisonKey(keyword))),
    siteKeywordMetrics: (strategy.siteKeywordMetrics ?? []).filter(metric => keys.has(keywordComparisonKey(metric.keyword))),
  };
}

/**
 * Restrict a page's primary/secondary keywords to only those in the selected key set.
 *
 * - If `keys` is null, returns the page unchanged.
 * - If neither the primary nor any secondary keyword is in `keys`, returns `null`
 *   (caller should drop the page).
 * - Otherwise returns a trimmed copy: primary preserved if in keys (else promoted
 *   from the first surviving secondary), secondaries filtered to in-keys entries.
 *
 * This is the row-creation boundary for skinny rows. populateDraftRows iterates
 * page.primaryKeyword + page.secondaryKeywords and creates a row per entry, so any
 * keyword left on the page object will produce a row whether or not it was selected.
 */
export function restrictPageToKeys(page: PageKeywordMap, keys: Set<string> | null): PageKeywordMap | null {
  if (!keys) return page;
  const primaryKey = keywordComparisonKey(page.primaryKeyword);
  const primaryInKeys = primaryKey ? keys.has(primaryKey) : false;
  const secondaryFiltered = (page.secondaryKeywords ?? []).filter(keyword => {
    const key = keywordComparisonKey(keyword);
    return key ? keys.has(key) : false;
  });
  if (!primaryInKeys && secondaryFiltered.length === 0) return null;
  if (primaryInKeys) {
    return { ...page, secondaryKeywords: secondaryFiltered };
  }
  const [newPrimary, ...rest] = secondaryFiltered;
  return {
    ...page,
    primaryKeyword: newPrimary,
    secondaryKeywords: rest,
  };
}

export function filterMapByKeys<T>(map: Map<string, T>, keys: Set<string> | null): Map<string, T> {
  if (!keys) return map;
  return new Map([...map.entries()].filter(([key]) => keys.has(key)));
}

export function filterStrategyForSingleKeyword(strategy: KeywordStrategy | null | undefined, normalized: string): KeywordStrategy | null | undefined {
  if (!strategy) return strategy;
  return {
    ...strategy,
    siteKeywords: (strategy.siteKeywords ?? []).filter(keyword => keywordComparisonKey(keyword) === normalized),
    siteKeywordMetrics: (strategy.siteKeywordMetrics ?? []).filter(metric => keywordComparisonKey(metric.keyword) === normalized),
  };
}

export function pageMatchesKeyword(page: PageKeywordMap, normalized: string): boolean {
  return keywordComparisonKey(page.primaryKeyword) === normalized
    || (page.secondaryKeywords ?? []).some(keyword => keywordComparisonKey(keyword) === normalized);
}
