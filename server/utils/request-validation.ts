import type { CustomDateRange } from '../google-analytics.js';

/** Validate that a value is one of the allowed options. */
export function validateEnum<T extends string>(val: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(val as T) ? (val as T) : fallback;
}

/** Parse optional startDate/endDate query params into a CustomDateRange (or undefined). */
export function parseDateRange(query: Record<string, unknown>): CustomDateRange | undefined {
  const s = query.startDate as string | undefined;
  const e = query.endDate as string | undefined;
  if (!s || !e) return undefined;
  if (!isCanonicalDateOnly(s) || !isCanonicalDateOnly(e)) return undefined;
  if (s > e) return undefined;
  return { startDate: s, endDate: e };
}

export function parseDateRangeStrict(query: Record<string, unknown>): { dateRange?: CustomDateRange; error?: string } {
  const startRaw = query.startDate;
  const endRaw = query.endDate;
  if (startRaw === undefined && endRaw === undefined) return {};
  if (typeof startRaw !== 'string' || typeof endRaw !== 'string') return { error: 'Invalid date range' };
  const parsed = parseDateRange({ startDate: startRaw, endDate: endRaw });
  return parsed ? { dateRange: parsed } : { error: 'Invalid date range' };
}

function isCanonicalDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
