/**
 * JSON column helpers — safe parse/stringify for SQLite JSON columns.
 */

/**
 * Parse a JSON column value from SQLite, returning `fallback` if the value is
 * null/undefined or if JSON.parse throws.
 *
 * @deprecated Use `parseJsonSafe` / `parseJsonSafeArray` / `parseJsonFallback`
 * from `server/db/json-validation.ts` instead. Those helpers add Zod schema
 * validation, per-item resilience for arrays, and structured warning logs.
 * This function is retained only because removing it would break the
 * json-column-helpers-pure test suite.
 */
export function parseJsonColumn<T>(val: string | null | undefined, fallback: T): T {
  if (val == null) return fallback;
  try {
    return JSON.parse(val) as T;
  } catch { // catch-ok — JSON parse failure is expected degradation for corrupt column values
    return fallback;
  }
}

/**
 * Stringify a value for storage in a SQLite JSON column.
 * Returns null if `val` is null or undefined.
 */
export function stringifyJsonColumn(val: unknown): string | null {
  if (val == null) return null;
  return JSON.stringify(val);
}
