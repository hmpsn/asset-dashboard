// src/lib/keywordHubDeepLink.ts
//
// Keyword Hub (Wave 4 P4) — the shared deep-link contract.
//
// Cross-surface keyword links carry keyword identity (`?q=`) and an optional
// segment (`?tab=`). The `q` param is ALWAYS `keywordTrackingKey`-normalized on
// BOTH halves (sender + receiver) so identity matches regardless of casing /
// whitespace. The `tab` param is a `KeywordCommandCenterFilter` so the receiver
// can init the right segment pill. Any keyword deep-link MUST use these helpers.
//
// Two-halves contract: the sender appends the query (via `buildHubDeepLinkQuery`);
// the receiver reads it (via `readHubDeepLink(useSearchParams())`). Neither half
// alone is sufficient.

import {
  KEYWORD_COMMAND_CENTER_FILTERS,
  type KeywordCommandCenterFilter,
} from '../../shared/types/keyword-command-center';
import { keywordTrackingKey } from './keywordTracking';

/** The query-param names used by the Keyword Hub deep-link contract. */
export const HUB_DEEP_LINK_PARAMS = {
  /** Normalized keyword identity (keywordTrackingKey). */
  query: 'q',
  /** Segment / filter to init (a KeywordCommandCenterFilter). */
  segment: 'tab',
} as const satisfies { readonly query: 'q'; readonly segment: 'tab' };

const HUB_SEGMENT_VALUES = new Set<string>(
  Object.values(KEYWORD_COMMAND_CENTER_FILTERS),
);

/**
 * Type guard: is `value` a valid `KeywordCommandCenterFilter`? Tolerates
 * `null`/`undefined` (returns false) so callers can pass `searchParams.get(...)`
 * directly. Unknown values are ignored, never thrown.
 */
export function isKeywordHubSegment(
  value: string | null | undefined,
): value is KeywordCommandCenterFilter {
  return typeof value === 'string' && HUB_SEGMENT_VALUES.has(value);
}

/**
 * Build the deep-link query string for a keyword (and optional segment).
 * The keyword is normalized via `keywordTrackingKey`. Returns
 * `"?q=...&tab=..."` when a valid segment is supplied, else just `"?q=..."`.
 */
export function buildHubDeepLinkQuery(input: {
  keyword: string;
  segment?: KeywordCommandCenterFilter;
}): string {
  const params = new URLSearchParams();
  params.set(HUB_DEEP_LINK_PARAMS.query, keywordTrackingKey(input.keyword));
  if (isKeywordHubSegment(input.segment)) {
    params.set(HUB_DEEP_LINK_PARAMS.segment, input.segment);
  }
  return `?${params.toString()}`;
}

/**
 * Read the Keyword Hub deep-link params from a `URLSearchParams`. Returns the
 * normalized `query` (or `null` when absent) and the `segment` (a valid
 * `KeywordCommandCenterFilter`, or `undefined` when absent / unknown — an
 * unknown `tab` is silently ignored, never thrown).
 */
export function readHubDeepLink(params: URLSearchParams): {
  query: string | null;
  segment: KeywordCommandCenterFilter | undefined;
} {
  const rawSegment = params.get(HUB_DEEP_LINK_PARAMS.segment);
  return {
    query: params.get(HUB_DEEP_LINK_PARAMS.query),
    segment: isKeywordHubSegment(rawSegment) ? rawSegment : undefined,
  };
}
