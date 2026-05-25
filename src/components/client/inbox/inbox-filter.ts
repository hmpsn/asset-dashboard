import { isValidTabSearchParam, resolveTabSearchParam } from '../../../lib/tab-search-param';

export type InboxFilter = 'all' | 'decisions' | 'reviews' | 'conversations';

export const INBOX_FILTER_VALUES: readonly InboxFilter[] =
  ['all', 'decisions', 'reviews', 'conversations'] as const;

// inbox-action-queue-strip-ok — JSDoc above documents the migration state, not an import
export const LEGACY_FILTER_MAP: Record<string, InboxFilter> = {
  approvals: 'decisions',
  requests: 'conversations',
  copy: 'reviews',
  'content-plan': 'decisions',
  completed: 'all',
};

export function isInboxFilter(value: string | null): value is InboxFilter {
  return isValidTabSearchParam(value, INBOX_FILTER_VALUES);
}

export function resolveInboxFilter(
  param: string | null,
  betaMode: boolean,
  initialFilter?: InboxFilter,
): InboxFilter {
  const fallback = initialFilter === 'reviews' && betaMode
    ? 'decisions'
    : (initialFilter ?? 'decisions');
  return resolveTabSearchParam<InboxFilter>(param, {
    validValues: INBOX_FILTER_VALUES,
    fallback,
    legacyAliases: LEGACY_FILTER_MAP,
    normalizeResolved: (value) => (value === 'reviews' && betaMode ? fallback : value),
  });
}
