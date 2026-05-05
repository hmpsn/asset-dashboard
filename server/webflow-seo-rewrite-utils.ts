/**
 * Shared helpers for Webflow SEO rewrite routes/workers.
 */

/**
 * Enforce a character limit on SEO text with smart truncation.
 * Prefers cutting at a word boundary, then sentence boundary, within the last
 * 40% of the allowed length. Falls back to a hard cut.
 */
export function enforceSeoTextLimit(text: string, maxLen: number): string {
  const t = text.replace(/^["']|["']$/g, '').trim();
  if (t.length > maxLen) {
    const truncated = t.slice(0, maxLen);
    const lastSpace = truncated.lastIndexOf(' ');
    const lastPeriod = truncated.lastIndexOf('.');
    const lastExclamation = truncated.lastIndexOf('!');

    let cutPoint = maxLen;
    if (lastSpace > maxLen * 0.6) cutPoint = lastSpace;
    else if (lastPeriod > maxLen * 0.6) cutPoint = lastPeriod + 1;
    else if (lastExclamation > maxLen * 0.6) cutPoint = lastExclamation + 1;

    return t.slice(0, cutPoint);
  }
  return t;
}
