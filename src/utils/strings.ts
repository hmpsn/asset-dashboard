/**
 * String utilities shared across frontend components.
 * Replaces scattered inline patterns (capitalize, etc.) with single implementations.
 */

const DEFAULT_ACRONYMS = new Set(['ai', 'ui', 'ux', 'seo', 'ctr', 'gsc', 'ga4', 'api', 'url', 'roi', 'cms']);

/**
 * Uppercase the first character of a string, leave the rest unchanged.
 * Returns '' for empty / non-string input.
 */
export function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function capitalizeWord(word: string, acronyms: ReadonlySet<string> = DEFAULT_ACRONYMS): string {
  if (!word) return '';
  return acronyms.has(word.toLowerCase())
    ? word.toUpperCase()
    : capitalize(word);
}
