export function parsePositiveIntQuery(rawValue: unknown, fallback?: number): number | null {
  if (rawValue == null) return fallback ?? null;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function parseNonNegativeIntQuery(rawValue: unknown, fallback?: number): number | null {
  if (rawValue == null) return fallback ?? null;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}
