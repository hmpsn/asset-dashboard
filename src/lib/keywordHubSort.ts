import type { KeywordCommandCenterSort } from '../../shared/types/keyword-command-center';

// Single source of truth for the Hub sort keys — the type DERIVES from this array so the
// runtime membership check (SORT_VALUES) can never drift from the union (a 9th key added to
// one but not the other would silently drop a valid ?sort= deep-link).
export const KEYWORD_HUB_SORT_KEYS = [
  'opportunity',
  'keyword',
  'position',
  'change',
  'clicks',
  'volume',
  'difficulty',
  'date',
] as const;

export type KeywordHubSortKey = (typeof KEYWORD_HUB_SORT_KEYS)[number];

export interface KeywordHubSortState {
  key: KeywordHubSortKey;
  direction: 'asc' | 'desc';
}

/**
 * Maps Hub column keys to the server's Keyword Command Center sort contract.
 * Kept in a small shared adapter so rebuilt surfaces consume the same mapping
 * as the legacy Hub without guessing server field names.
 */
export function hubSortToKccSort(key: KeywordHubSortKey): KeywordCommandCenterSort {
  switch (key) {
    case 'opportunity':
      return 'opportunity';
    case 'keyword':
      return 'keyword';
    case 'position':
      return 'rank';
    case 'clicks':
      return 'clicks';
    case 'volume':
      return 'demand';
    case 'difficulty':
      return 'difficulty';
    case 'change':
    case 'date':
    default:
      return 'priority';
  }
}

