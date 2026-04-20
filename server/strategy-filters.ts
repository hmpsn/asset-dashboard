/**
 * Pure filter helpers for keyword strategy post-processing.
 * Extracted as named exports so unit tests can import the production
 * implementations directly — prevents the "testing a local copy" trap.
 */

/**
 * Removes declined keywords from the keyword pool Map in-place.
 * Returns the count of removed entries.
 */
export function filterDeclinedFromPool(
  keywordPool: Map<string, unknown>,
  declinedKeywords: string[]
): number {
  if (declinedKeywords.length === 0) return 0;
  const declinedSet = new Set(declinedKeywords.map(k => k.toLowerCase()));
  let removed = 0;
  for (const [kw] of keywordPool) {
    if (declinedSet.has(kw)) {
      keywordPool.delete(kw);
      removed++;
    }
  }
  return removed;
}

/**
 * Returns true if a question keyword is relevant to a target keyword.
 * Requires at least min(2, targetWords.length) words from the target to appear
 * in the question — avoids single-word false positives for multi-word targets.
 */
export function matchesQuestionKeyword(targetKeyword: string, questionKeyword: string): boolean {
  const targetWords = targetKeyword.toLowerCase().split(/\s+/);
  const qLower = questionKeyword.toLowerCase();
  const matchCount = targetWords.filter(w => qLower.includes(w)).length;
  return matchCount >= Math.min(2, targetWords.length);
}
