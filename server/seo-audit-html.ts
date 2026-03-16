// HTML extraction utilities for SEO audit engine
// Extracted from seo-audit.ts for modularity

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
  if (removals.length === 0) return html;
  let result = html;
  for (let i = removals.length - 1; i >= 0; i--) {
    result = result.slice(0, removals[i][0]) + result.slice(removals[i][1]);
  }

  // Also strip void elements (img, input, etc.) with hidden attributes
  return result.replace(/<(?:img|input|hr|br)\b[^>]*(?:style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["']|class\s*=\s*["'][^"']*w-condition-invisible[^"']*["'])[^>]*\/?>/gi, '');
}

export function extractTag(html: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const matches: string[] = [];
  let m;
  while ((m = regex.exec(html)) !== null) matches.push(m[1].trim());
  return matches;
}

export function extractMetaContent(html: string, nameOrProp: string): string | null {
  // Match name= or property=
  const r1 = new RegExp(`<meta[^>]*(?:name|property)=["']${nameOrProp}["'][^>]*content=["']([^"']*)["']`, 'i');
  const r2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${nameOrProp}["']`, 'i');
  const m = html.match(r1) || html.match(r2);
  return m ? m[1] : null;
}

export function countWords(html: string): number {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

export function extractLinks(html: string): { href: string; text: string; rel?: string }[] {
  const links: { href: string; text: string; rel?: string }[] = [];
  const regex = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const attrs = m[1];
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/);
    const relMatch = attrs.match(/rel=["']([^"']*)["']/);
    if (hrefMatch) {
      links.push({ href: hrefMatch[1], text, rel: relMatch?.[1] });
    }
  }
  return links;
}

export function extractImgTags(html: string): { src: string; alt: string; hasAlt: boolean; loading?: string; hasWidth: boolean; hasHeight: boolean }[] {
  const imgs: { src: string; alt: string; hasAlt: boolean; loading?: string; hasWidth: boolean; hasHeight: boolean }[] = [];
  const regex = /<img\s+([^>]*)>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const attrs = m[1];
    const src = attrs.match(/src=["']([^"']*)["']/)?.[1] || '';
    const altMatch = attrs.match(/alt=["']([^"']*)["']/);
    const hasAlt = altMatch !== null;
    const alt = altMatch?.[1] || '';
    const loading = attrs.match(/loading=["']([^"']*)["']/)?.[1];
    const hasWidth = /width\s*=/.test(attrs);
    const hasHeight = /height\s*=/.test(attrs);
    imgs.push({ src, alt, hasAlt, loading, hasWidth, hasHeight });
  }
  return imgs;
}

export function extractStyleBlocks(html: string): number {
  const regex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let total = 0;
  let m;
  while ((m = regex.exec(html)) !== null) total += m[1].length;
  return total;
}

export function extractInlineScripts(html: string): number {
  // Count inline scripts (not external src ones)
  const regex = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
  let total = 0;
  let m;
  while ((m = regex.exec(html)) !== null) {
    // Exclude JSON-LD structured data
    if (m[0].includes('application/ld+json')) continue;
    total += m[1].length;
  }
  return total;
}

export function countExternalResources(html: string): { stylesheets: number; scripts: number } {
  const cssRegex = /<link[^>]*rel=["']stylesheet["'][^>]*>/gi;
  const jsRegex = /<script[^>]*src=["'][^"']+["'][^>]*>/gi;
  let stylesheets = 0, scripts = 0;
  while (cssRegex.exec(html)) stylesheets++;
  while (jsRegex.exec(html)) scripts++;
  return { stylesheets, scripts };
}
