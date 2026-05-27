/**
 * String utilities shared across frontend components.
 * Replaces scattered inline patterns (capitalize, etc.) with single implementations.
 */

/**
 * Uppercase the first character of a string, leave the rest unchanged.
 * Returns '' for empty / non-string input.
 */
export function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
