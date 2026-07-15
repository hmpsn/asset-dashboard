// @ds-rebuilt
import type { AnnotationCategory } from './types';

export const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
export const PERCENT_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
export const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
export const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export const SERIES = {
  clicks: 'var(--blue)',
  impressions: 'var(--cyan)',
  ctr: 'var(--amber)',
  position: 'var(--red)',
  users: 'var(--blue)',
  sessions: 'var(--cyan)',
  pageviews: 'var(--emerald)',
  duration: 'var(--cyan)',
  previous: 'var(--brand-text-muted)',
} as const;

export const ANNOTATION_CATEGORIES: Array<{ id: AnnotationCategory; label: string; color: string; tone: 'blue' | 'amber' | 'teal' | 'zinc' }> = [
  { id: 'site_change', label: 'Site change', color: 'var(--ann-site)', tone: 'blue' },
  { id: 'algorithm_update', label: 'Algorithm', color: 'var(--ann-algo)', tone: 'amber' },
  { id: 'campaign', label: 'Campaign', color: 'var(--teal)', tone: 'teal' },
  { id: 'other', label: 'Other', color: 'var(--ann-other)', tone: 'zinc' },
];

export function formatNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? NUMBER_FORMAT.format(value) : '—';
}

export function formatPercent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${PERCENT_FORMAT.format(value)}%` : '—';
}

export function formatPosition(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—';
}

export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

export function deltaLabel(value: number | null | undefined, suffix = '%'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}${suffix}`;
}

export function dateRangeLabel(range?: { start: string; end: string }): string {
  if (!range) return 'Provider window unavailable';
  return `${range.start} - ${range.end}`;
}

export function formatScanTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : DATE_TIME_FORMAT.format(parsed);
}

export function safeShare(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

export function buildSparkline<T>(rows: T[], accessor: (row: T) => number | null | undefined): number[] {
  return rows
    .map(accessor)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

export function categoryMeta(category: string) {
  return ANNOTATION_CATEGORIES.find((item) => item.id === category) ?? ANNOTATION_CATEGORIES[3];
}
