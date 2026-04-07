/**
 * Western-flavored loading phrases for the client chat AI response indicator.
 *
 * Displayed during AI thinking state when response takes > 4 seconds.
 * Rotate with pickPhrase() — never the same phrase twice in a row.
 */

export const LOADING_PHRASES: readonly string[] = [
  "Hootin'…",
  "Hollerin'…",
  "Rustlin'…",
  "Wranglin'…",
  "Cookin'…",
  "Fetchin'…",
  "Gettin' after it…",
  "Tinkerin'…",
  "Rummagin'…",
] as const;

/**
 * Pick a random phrase from LOADING_PHRASES.
 * Pass the current phrase as `exclude` to guarantee no consecutive repeat.
 */
export function pickPhrase(exclude?: string): string {
  const available = exclude
    ? LOADING_PHRASES.filter(p => p !== exclude)
    : [...LOADING_PHRASES];
  return available[Math.floor(Math.random() * available.length)];
}
