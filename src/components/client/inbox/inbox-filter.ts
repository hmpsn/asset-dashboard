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
  return value !== null && (INBOX_FILTER_VALUES as readonly string[]).includes(value);
}

export function resolveInboxFilter(
  param: string | null,
  betaMode: boolean,
  initialFilter?: InboxFilter,
): InboxFilter {
  const fallback = initialFilter === 'reviews' && betaMode
    ? 'decisions'
    : (initialFilter ?? 'decisions');

  if (isInboxFilter(param)) {
    if (param === 'reviews' && betaMode) return fallback;
    return param;
  }
  if (param && LEGACY_FILTER_MAP[param]) {
    const mapped = LEGACY_FILTER_MAP[param];
    if (mapped === 'reviews' && betaMode) return fallback;
    return mapped;
  }
  return fallback;
}
