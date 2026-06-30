const DEFAULT_ACRONYMS = new Set(['ai', 'ui', 'ux', 'seo', 'ctr', 'gsc', 'ga4', 'api', 'url', 'roi', 'cms']);

export function titleCaseWord(word: string, acronyms: ReadonlySet<string> = DEFAULT_ACRONYMS): string {
  if (!word) return '';
  return acronyms.has(word.toLowerCase())
    ? word.toUpperCase()
    : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function slugSegmentToTitle(segment: string): string {
  return segment
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(word => titleCaseWord(word))
    .join(' ')
    .trim();
}

export function pathToTitle(pathOrUrl: string | null | undefined, fallback = 'Home'): string {
  if (!pathOrUrl) return fallback;

  try {
    const rawPath = /^https?:\/\//i.test(pathOrUrl)
      ? new URL(pathOrUrl).pathname
      : pathOrUrl;
    const pathname = rawPath.replace(/\/$/, '');
    if (!pathname || pathname === '/') return 'Home';
    const segments = pathname.split('/').filter(Boolean);
    const label = slugSegmentToTitle(segments[segments.length - 1] ?? '');
    return label || fallback;
  } catch {
    return fallback;
  }
}
