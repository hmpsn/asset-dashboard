/**
 * JSON column helpers — safe parse/stringify for SQLite JSON columns.
 */

/**
 * Parse a JSON column value from SQLite, returning `fallback` if the value is
 * null/undefined or if JSON.parse throws.
 */
export function parseJsonColumn<T>(val: string | null | undefined, fallback: T): T {
  if (val == null) return fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
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
