import { type ZodType } from 'zod';
import { createLogger } from '../logger.js';

const log = createLogger('json-validation');

/**
 * Safely parse a JSON string with Zod validation.
 * On parse failure: logs a warning and returns the fallback value.
 * On JSON.parse failure: logs a warning and returns the fallback value.
 * Never throws.
 */
export function parseJsonSafe<T>(
  raw: string | null | undefined,
  schema: ZodType<T>,
  fallback: T,
  context?: { workspaceId?: string; field?: string; table?: string },
): T {
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
