/** Known acronyms that should be fully uppercased in title-cased text. */
const DEFAULT_ACRONYMS = new Set(['ai', 'ui', 'ux', 'seo', 'ctr', 'gsc', 'ga4', 'api', 'url', 'roi', 'cms']);

/** Title-case a single word, uppercasing known acronyms. */
export function capitalizeWord(word: string, acronyms: ReadonlySet<string> = DEFAULT_ACRONYMS): string {
  if (!word) return '';
  return acronyms.has(word.toLowerCase())
    ? word.toUpperCase()
    : word.charAt(0).toUpperCase() + word.slice(1);
}
