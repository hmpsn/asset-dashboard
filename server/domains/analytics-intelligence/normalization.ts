import type { SearchPage, QueryPageRow } from '../../search-console.js';
import { normalizePageUrl } from '../../helpers.js';

// ── URL normalization for page deduplication ─────────────────────
// GSC can return multiple URL variants for the same logical page
// (trailing slashes, query params, fragments). Normalize before
// using as grouping keys or DB page_id values.

export function normalizePageUrlWithOrigin(url: string): string {
  try {
    const u = new URL(url);
    const normalizedPath = normalizePageUrl(u.pathname);
    return normalizedPath === '/' ? `${u.origin}/` : `${u.origin}${normalizedPath}`;
  } catch { // catch-ok - external/relative URL input preserves legacy best-effort normalization.
    // Not a valid URL — preserve legacy best-effort behavior.
    return url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url;
  }
}

/**
 * Clone + normalize + deduplicate SearchPage arrays.
 * Merges metrics for URL variants of the same page (sum clicks/impressions,
 * weighted-average position/CTR).
 */
export function deduplicatePages(pages: SearchPage[]): SearchPage[] {
  const map = new Map<string, SearchPage>();
  for (const p of pages) {
    const key = normalizePageUrlWithOrigin(p.page);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...p, page: key });
    } else {
      const totalImpressions = existing.impressions + p.impressions;
      existing.clicks += p.clicks;
      existing.position = totalImpressions > 0
        ? (existing.position * existing.impressions + p.position * p.impressions) / totalImpressions
        : existing.position;
      existing.ctr = totalImpressions > 0
        ? (existing.ctr * existing.impressions + p.ctr * p.impressions) / totalImpressions
        : existing.ctr;
      existing.impressions = totalImpressions;
    }
  }
  return Array.from(map.values());
}

/**
 * Clone + normalize + deduplicate QueryPageRow arrays.
 * Merges metrics for rows sharing the same (query, normalized page).
 */
export function deduplicateQueryPages(rows: QueryPageRow[]): QueryPageRow[] {
  const map = new Map<string, QueryPageRow>();
  for (const r of rows) {
    const normPage = normalizePageUrlWithOrigin(r.page);
    const key = `${r.query}::${normPage}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r, page: normPage });
    } else {
      const totalImpressions = existing.impressions + r.impressions;
      existing.clicks += r.clicks;
      existing.position = totalImpressions > 0
        ? (existing.position * existing.impressions + r.position * r.impressions) / totalImpressions
        : existing.position;
      existing.ctr = totalImpressions > 0
        ? (existing.ctr * existing.impressions + r.ctr * r.impressions) / totalImpressions
        : existing.ctr;
      existing.impressions = totalImpressions;
    }
  }
  return Array.from(map.values());
}
