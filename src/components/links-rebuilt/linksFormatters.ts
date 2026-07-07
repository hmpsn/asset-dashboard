// @ds-rebuilt
import { formatDate, formatDateTime } from '../../utils/formatDates';
import { formatBytes } from '../../utils/formatNumbers';

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

export function numberOrDash(value: number | null | undefined): string {
  return typeof value === 'number' ? NUMBER_FORMAT.format(value) : '—';
}

export function percentOrDash(value: number | null | undefined): string {
  return typeof value === 'number' ? `${Math.round(value)}%` : '—';
}

export function dateOrDash(value: string | Date | null | undefined): string {
  const formatted = formatDate(value);
  return formatted || '—';
}

export function dateTimeOrDash(value: string | Date | null | undefined): string {
  const formatted = formatDateTime(value);
  return formatted || '—';
}

export function bytesOrDash(value: number | null | undefined): string {
  return typeof value === 'number' ? formatBytes(value) : '—';
}

export function cleanUrlLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/^https?:\/\//i, '').replace(/\/$/, '') || value;
}

export function truncateMiddle(value: string, maxLength = 84): string {
  if (value.length <= maxLength) return value;
  const keep = Math.max(10, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

export function csvEscape(value: string | number | null | undefined): string {
  const raw = value == null ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

export function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
