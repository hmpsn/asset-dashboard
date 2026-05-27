export interface HtmlLink {
  href: string;
  text: string;
  rel?: string;
}

export interface HtmlLinkExtractionOptions {
  includeRel?: boolean;
  includeOnclickUrls?: boolean;
  includeFormActions?: boolean;
  dedupeByHref?: boolean;
  excludeHashAnchors?: boolean;
  requireNonEmptyHref?: boolean;
  filterHref?: (href: string) => boolean;
  maxTextLength?: number;
  onclickFallbackText?: string;
  formActionText?: string;
}

export interface HtmlImage {
  src: string;
  alt: string;
  hasAlt: boolean;
  loading?: string;
  hasWidth: boolean;
  hasHeight: boolean;
}

export function extractTag(html: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) matches.push(m[1].trim());
  return matches;
}

export function extractMetaContent(html: string, nameOrProp: string): string | null {
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

export function extractLinks(html: string, opts: HtmlLinkExtractionOptions = {}): HtmlLink[] {
  const includeRel = opts.includeRel === true;
  const includeOnclickUrls = opts.includeOnclickUrls === true;
  const includeFormActions = opts.includeFormActions === true;
  const dedupeByHref = opts.dedupeByHref === true;
  const excludeHashAnchors = opts.excludeHashAnchors === true;
  const requireNonEmptyHref = opts.requireNonEmptyHref === true;
  const filterHref = opts.filterHref;
  const maxTextLength = opts.maxTextLength;
  const onclickFallbackText = opts.onclickFallbackText ?? '[button/onclick]';
  const formActionText = opts.formActionText ?? '[form action]';

  const links: HtmlLink[] = [];
  const seen = dedupeByHref ? new Set<string>() : null;

  const addLink = (href: string, text: string, rel?: string) => {
    const trimmedHref = href.trim();
    if (requireNonEmptyHref && !trimmedHref) return;
    if (excludeHashAnchors && trimmedHref.startsWith('#')) return;
    if (filterHref && !filterHref(trimmedHref)) return;
    if (seen?.has(trimmedHref)) return;
    seen?.add(trimmedHref);

    const cleanedText = text.trim();
    const normalizedText = typeof maxTextLength === 'number' && maxTextLength >= 0
      ? cleanedText.slice(0, maxTextLength)
      : cleanedText;

    if (includeRel) {
      links.push({ href: trimmedHref, text: normalizedText, rel });
      return;
    }
    links.push({ href: trimmedHref, text: normalizedText });
  };

  const anchorRegex = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null) {
    const attrs = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/);
    const relMatch = attrs.match(/rel=["']([^"']*)["']/);
    if (!hrefMatch) continue;
    addLink(hrefMatch[1], text, relMatch?.[1]);
  }

  if (includeOnclickUrls) {
    const onclickRegex = /onclick=["'][^"']*(?:window\.(?:location(?:\.href)?|open)\s*[=(]\s*['"])([^'"]+)['"]/gi;
    while ((match = onclickRegex.exec(html)) !== null) {
      const pos = match.index;
      const surrounding = html.slice(Math.max(0, pos - 200), pos + match[0].length + 200);
      const textMatch = surrounding.match(/>([^<]{1,100})</);
      addLink(match[1], textMatch ? textMatch[1].trim() : onclickFallbackText);
    }
  }

  if (includeFormActions) {
    const formRegex = /<form\s[^>]*action=["']([^"'#][^"']*)["']/gi;
    while ((match = formRegex.exec(html)) !== null) {
      addLink(match[1], formActionText);
    }
  }

  return links;
}

export function extractImgTags(html: string): HtmlImage[] {
  const imgs: HtmlImage[] = [];
  const regex = /<img\s+([^>]*)>/gi;
  let m: RegExpExecArray | null;
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
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) total += m[1].length;
  return total;
}

export function extractInlineScripts(html: string): number {
  const regex = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    if (m[0].includes('application/ld+json')) continue;
    total += m[1].length;
  }
  return total;
}

export function countExternalResources(html: string): { stylesheets: number; scripts: number } {
  const cssRegex = /<link[^>]*rel=["']stylesheet["'][^>]*>/gi;
  const jsRegex = /<script[^>]*src=["'][^"']+["'][^>]*>/gi;
  let stylesheets = 0;
  let scripts = 0;
  while (cssRegex.exec(html)) stylesheets++;
  while (jsRegex.exec(html)) scripts++;
  return { stylesheets, scripts };
}
