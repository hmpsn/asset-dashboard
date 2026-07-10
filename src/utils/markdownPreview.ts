/**
 * Derive compact readable prose from Markdown-backed fields without changing
 * the stored value used by the full editor.
 */
export function markdownToPlainTextPreview(value: string | null | undefined): string {
  if (!value) return '';

  return value
    .replace(/!\[([^\]]*)]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/(^|\s)[-*+]\s+/g, '$1')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\s+---+\s+/g, ' · ')
    .replace(/\*\*|__|~~/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
