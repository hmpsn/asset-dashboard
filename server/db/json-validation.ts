import { type ZodType } from 'zod';
import { createLogger } from '../logger.js';

const log = createLogger('json-validation');

/**
 * Safely parse a JSON string with Zod validation.
 * On parse failure: logs a warning and returns the fallback value.
 * On JSON.parse failure: logs a warning and returns the fallback value.
 * Never throws.
 */
export function parseJsonSafe<T, F extends T | null = T>(
  raw: string | null | undefined,
  schema: ZodType<T>,
  fallback: F,
  context?: { workspaceId?: string; field?: string; table?: string },
): T | F {
  if (raw == null || raw === '') return fallback;
  try {
    const parsed = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
    log.warn(
      { ...context, errors: result.error.issues.slice(0, 3) },
      `JSON validation failed for ${context?.table ?? '?'}.${context?.field ?? '?'}`,
    );
    return fallback;
  } catch (err) {
    log.warn(
      { ...context, err },
      `JSON parse failed for ${context?.table ?? '?'}.${context?.field ?? '?'}`,
    );
    return fallback;
  }
}

/**
 * Safely parse a JSON array column with per-item Zod validation.
 * Validates each item individually — bad items are filtered out (with a warning)
 * instead of dropping the entire array. Use this for DB array columns where
 * partial data is better than no data.
 * Never throws.
 */
export function parseJsonSafeArray<T>(
  raw: string | null | undefined,
  itemSchema: ZodType<T>,
  context?: { workspaceId?: string; field?: string; table?: string },
): T[] {
  if (raw == null || raw === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn(
      { ...context, err },
      `JSON parse failed for ${context?.table ?? '?'}.${context?.field ?? '?'}`,
    );
    return [];
  }
  if (!Array.isArray(parsed)) {
    log.warn(
      { ...context },
      `Expected array for ${context?.table ?? '?'}.${context?.field ?? '?'}, got ${typeof parsed}`,
    );
    return [];
  }
  const valid: T[] = [];
  let dropped = 0;
  for (const item of parsed) {
    const result = itemSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      dropped++;
    }
  }
  if (dropped > 0) {
    log.warn(
      { ...context, dropped, total: parsed.length },
      `Dropped ${dropped}/${parsed.length} invalid items from ${context?.table ?? '?'}.${context?.field ?? '?'}`,
    );
  }
  return valid;
}

/**
 * Parse a JSON string without Zod but with safe fallback.
 * Use only for low-risk fields where a full schema isn't warranted.
 */
export function parseJsonFallback<T>(
  raw: string | null | undefined,
  fallback: T,
): T {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
