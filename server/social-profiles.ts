/**
 * Normalizes user-editable social profile URLs:
 * - trims whitespace
 * - drops empty strings
 * - de-duplicates while preserving first-seen order
 *
 * Returns:
 * - `undefined` when input is `undefined`/`null` (no update requested)
 * - `[]` when input was present but all entries were empty/duplicate (explicit clear)
 */
export function normalizeSocialProfiles(
  profiles: string[] | undefined | null,
): string[] | undefined {
  if (profiles == null) return undefined;

  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const value of profiles) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
  }
  return cleaned;
}
