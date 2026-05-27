/**
 * Returns the number of whole days elapsed since `iso`.
 * Returns 0 for future dates or invalid input.
 */
export function daysSince(iso: string): number {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
  } catch {
    return 0;
  }
}

/**
 * Format a date string as a human-readable relative time.
 * Superset of all 7 local variants in the codebase (WorkspaceOverview,
 * AnomalyAlerts, ActivityFeed, ActiveRequestsAnnotations, ContentCalendar,
 * CellDetailPanel, and related).
 */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
