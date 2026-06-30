export interface TimeAgoOptions {
  style?: 'short' | 'long' | 'calendar';
  capitalizeJustNow?: boolean;
  dateAfterDays?: number;
  roundUnits?: boolean;
}

function justNow(capitalize: boolean | undefined): string {
  return capitalize ? 'Just now' : 'just now';
}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
}

/**
 * Format a date string as a human-readable relative time.
 * Default output is the compact historical format: `5m ago`, `3h ago`, `yesterday`.
 */
export function timeAgo(dateStr: string, options: TimeAgoOptions = {}): string {
  const style = options.style ?? 'short';
  const diff = Math.max(0, Date.now() - new Date(dateStr).getTime());
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return justNow(options.capitalizeJustNow);

  if (style === 'long') {
    if (mins < 60) return plural(mins, 'minute');
    const hours = Math.floor(mins / 60);
    if (hours < 24) return plural(hours, 'hour');
    return plural(Math.floor(hours / 24), 'day');
  }

  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (style === 'calendar') {
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return plural(days, 'day');
    const months = Math.floor(days / 30.44);
    return plural(Math.max(1, months), 'month');
  }

  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) {
    const roundedHours = options.roundUnits ? Math.max(1, Math.round(diff / 3_600_000)) : hours;
    return `${roundedHours}h ago`;
  }
  if (days === 1) return 'yesterday';
  const dateAfterDays = options.dateAfterDays ?? 30;
  if (days < dateAfterDays) {
    const roundedDays = options.roundUnits ? Math.max(1, Math.round(diff / 86_400_000)) : days;
    return `${roundedDays}d ago`;
  }
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
