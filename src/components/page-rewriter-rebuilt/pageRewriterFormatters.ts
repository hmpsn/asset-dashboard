const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  quot: '"',
};

/** Decode the small HTML-entity surface returned by scraped page metadata. */
export function decodePageText(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      } catch {
        return match;
      }
    }
    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[normalized] ?? match;
  });
}
