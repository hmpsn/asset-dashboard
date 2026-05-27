// HTML extraction utilities for SEO audit engine
// Extracted from seo-audit.ts for modularity
import {
  extractTag as extractHtmlTag,
  extractMetaContent as extractHtmlMetaContent,
  countWords as countHtmlWords,
  extractLinks as extractHtmlLinks,
  extractImgTags as extractHtmlImgTags,
  extractStyleBlocks as extractHtmlStyleBlocks,
  extractInlineScripts as extractHtmlInlineScripts,
  countExternalResources as countHtmlExternalResources,
} from './html-analysis-utils.js';

/**
 * Strip elements that are hidden via inline styles or Webflow conditional visibility.
 * Removes elements with display:none, visibility:hidden, or the w-condition-invisible class.
 * This prevents false positives from conditional CMS sections (e.g., two hero blocks where only one is visible).
 *
 * Uses a tag-depth-counting approach to find the correct matching closing tag,
 * which handles arbitrarily nested same-type elements (e.g., <div> inside <div>).
 */
export function stripHiddenElements(html: string): string {
  // Pattern to detect a hidden opening tag
  const hiddenOpener = /<(div|section|header|article|aside|main|figure|span|p|ul|ol|li|h[1-6])\b([^>]*?)>/gi;
  const isHiddenAttrs = (attrs: string) =>
    /class\s*=\s*["'][^"']*w-condition-invisible[^"']*["']/i.test(attrs) ||
    /style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["']/i.test(attrs) ||
    /style\s*=\s*["'][^"']*visibility\s*:\s*hidden[^"']*["']/i.test(attrs);

  // Collect ranges to remove (start offset, end offset)
  const removals: [number, number][] = [];
  let match: RegExpExecArray | null;

  while ((match = hiddenOpener.exec(html)) !== null) {
    const attrs = match[2];
    if (!isHiddenAttrs(attrs)) continue;

    const tag = match[1].toLowerCase();
    const startOffset = match.index;

    // Count nested same-type tags to find the matching close
    let depth = 1;
    const openRe = new RegExp(`<${tag}\\b`, 'gi');
    const closeRe = new RegExp(`</${tag}>`, 'gi');
    // Scan forward from after the opening tag
    const scanStart = startOffset + match[0].length;
    const rest = html.slice(scanStart);

    // Merge open/close positions and walk them in order
    const events: { pos: number; type: 'open' | 'close'; len: number }[] = [];
    let m2: RegExpExecArray | null;
    while ((m2 = openRe.exec(rest)) !== null) events.push({ pos: m2.index, type: 'open', len: 0 });
    while ((m2 = closeRe.exec(rest)) !== null) events.push({ pos: m2.index, type: 'close', len: m2[0].length });
    events.sort((a, b) => a.pos - b.pos);

    let endOffset = -1;
    for (const ev of events) {
      if (ev.type === 'open') depth++;
      else {
        depth--;
        if (depth === 0) {
          endOffset = scanStart + ev.pos + ev.len;
          break;
        }
      }
    }

    if (endOffset > startOffset) {
      removals.push([startOffset, endOffset]);
      // Skip past this element to avoid re-scanning its contents
      hiddenOpener.lastIndex = endOffset;
    }
  }

  // Apply removals in reverse order to preserve offsets
  let result = html;
  if (removals.length > 0) {
    for (let i = removals.length - 1; i >= 0; i--) {
      result = result.slice(0, removals[i][0]) + result.slice(removals[i][1]);
    }
  }

  // Also strip void elements (img, input, etc.) with hidden attributes.
  // This must run unconditionally — not guarded by removals.length — so that
  // pages containing only hidden void elements (no block-level hidden elements)
  // are still cleaned correctly.
  return result.replace(/<(?:img|input|hr|br)\b[^>]*(?:style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["']|class\s*=\s*["'][^"']*w-condition-invisible[^"']*["'])[^>]*\/?>/gi, '');
}

export function extractTag(html: string, tag: string): string[] {
  return extractHtmlTag(html, tag);
}

export function extractMetaContent(html: string, nameOrProp: string): string | null {
  return extractHtmlMetaContent(html, nameOrProp);
}

export function countWords(html: string): number {
  return countHtmlWords(html);
}

export function extractLinks(html: string): { href: string; text: string; rel?: string }[] {
  return extractHtmlLinks(html, { includeRel: true });
}

export function extractImgTags(html: string): { src: string; alt: string; hasAlt: boolean; loading?: string; hasWidth: boolean; hasHeight: boolean }[] {
  return extractHtmlImgTags(html);
}

export function extractStyleBlocks(html: string): number {
  return extractHtmlStyleBlocks(html);
}

export function extractInlineScripts(html: string): number {
  return extractHtmlInlineScripts(html);
}

export function countExternalResources(html: string): { stylesheets: number; scripts: number } {
  return countHtmlExternalResources(html);
}
