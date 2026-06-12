import { describe, it, expect } from 'vitest';
import { compactStrings, dedupeBy, dedupeByNormalizedKeyword, uniqStrings } from '../../server/utils/collections.js';

describe('dedupeBy', () => {
  it('removes duplicates by key', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'a' }];
    expect(dedupeBy(items, i => i.id)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('preserves first occurrence', () => {
    const items = [{ id: 'x', v: 1 }, { id: 'x', v: 2 }];
    expect(dedupeBy(items, i => i.id)[0].v).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(dedupeBy([], i => (i as { id: string }).id)).toEqual([]);
  });
});

describe('dedupeByNormalizedKeyword', () => {
  it('deduplicates case-insensitively', () => {
    const items = [
      { keyword: 'SEO Tools', score: 1 },
      { keyword: 'seo tools', score: 2 },
      { keyword: 'PPC', score: 3 },
    ];
    const result = dedupeByNormalizedKeyword(items);
    expect(result).toHaveLength(2);
    expect(result[0].keyword).toBe('SEO Tools');
  });

  it('trims whitespace before comparing', () => {
    const items = [{ keyword: ' hello ' }, { keyword: 'hello' }];
    expect(dedupeByNormalizedKeyword(items)).toHaveLength(1);
  });
});

describe('uniqStrings', () => {
  it('deduplicates exact strings', () => {
    expect(uniqStrings(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('is case-sensitive by default', () => {
    expect(uniqStrings(['A', 'a'])).toHaveLength(2);
  });

  it('folds case with caseInsensitive option', () => {
    const result = uniqStrings(['A', 'a', 'B'], { caseInsensitive: true });
    expect(result).toHaveLength(2);
    // first occurrence (A) is preserved
    expect(result[0]).toBe('A');
  });

  it('trims strings with trim option', () => {
    expect(uniqStrings([' foo ', 'foo'], { trim: true })).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(uniqStrings([])).toEqual([]);
  });
});

describe('compactStrings', () => {
  it('trims strings and removes empty values', () => {
    expect(compactStrings([' one ', '', '  ', 'two'])).toEqual(['one', 'two']);
  });

  it('drops nullish and false values', () => {
    expect(compactStrings(['one', null, undefined, false, 'two'])).toEqual(['one', 'two']);
  });
});
