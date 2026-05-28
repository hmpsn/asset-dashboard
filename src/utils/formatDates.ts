/**
 * Centralized date formatting utilities.
 * Replaces scattered new Date().toLocaleDateString() and Intl.DateTimeFormat calls
 * across components. Handle null/undefined/empty gracefully (return '').
 */

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

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? null : d;
}

/** Format as "Jun 12, 2026" */
export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Format as "Jun 12" (no year) */
export function formatDateShort(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format as "Jun 12, 2026 3:24 PM" */
export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
