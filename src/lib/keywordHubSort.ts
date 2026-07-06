import type { KeywordCommandCenterSort } from '../../shared/types/keyword-command-center';

export type KeywordHubSortKey =
  | 'opportunity'
  | 'keyword'
  | 'position'
  | 'change'
  | 'clicks'
  | 'volume'
  | 'difficulty'
  | 'date';

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

