// @ds-rebuilt
import { formatDate, formatDateTime } from '../../utils/formatDates';
import { formatBytes } from '../../utils/formatNumbers';

export { formatBytes };

export function dateOrDash(value: string | Date | null | undefined): string {
  return formatDate(value) || 'Never';
}

export function dateTimeOrDash(value: string | Date | null | undefined): string {
  return formatDateTime(value) || formatDate(value) || 'Never';
}

export function formatInteger(value: number | null | undefined): string {
  return Math.round(value ?? 0).toLocaleString();
}

export function formatCompactNumber(value: number | null | undefined): string {
  const next = value ?? 0;
  if (Math.abs(next) >= 1000) {
    return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(next);
  }
  return formatInteger(next);
}

export function formatScore(value: number | null | undefined): string {
  return `${Math.round(value ?? 0)}`;
}
