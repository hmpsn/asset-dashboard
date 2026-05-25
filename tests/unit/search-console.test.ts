import { describe, expect, it } from 'vitest';
import {
  computePercentChange,
  extractGscPagePathname,
  findTopDroppedPage,
  findTopSpikedPage,
  formatGscCtr,
  formatGscPosition,
} from '../../server/search-console.js';

describe('search-console helpers', () => {
  it('formats CTR and position to one decimal place', () => {
    expect(formatGscCtr(0.0634)).toBe(6.3);
    expect(formatGscPosition(7.149)).toBe(7.1);
  });

  it('computes percent changes with zero-baseline guard', () => {
    expect(computePercentChange(120, 100)).toBe(20);
    expect(computePercentChange(0, 0)).toBe(0);
    expect(computePercentChange(10, 0)).toBe(100);
  });

  it('extracts pathname from URL and supports raw path fallback', () => {
    expect(extractGscPagePathname('https://example.com/blog/post?a=1')).toBe('/blog/post');
    expect(extractGscPagePathname('/blog/post')).toBe('/blog/post');
    expect(extractGscPagePathname('not-a-url')).toBeNull();
  });

  it('finds dropped pages, including pages that vanished entirely', () => {
    const cur = [
      { keys: ['https://example.com/a'], clicks: 20 },
      { keys: ['https://example.com/b'], clicks: 5 },
    ];
    const prev = [
      { keys: ['https://example.com/a'], clicks: 35 },
      { keys: ['https://example.com/b'], clicks: 10 },
      { keys: ['https://example.com/c'], clicks: 40 },
    ];

    expect(findTopDroppedPage(cur, prev)).toBe('https://example.com/c');
  });

  it('finds spiked pages with largest absolute click gain', () => {
    const cur = [
      { keys: ['https://example.com/a'], clicks: 90 },
      { keys: ['https://example.com/b'], clicks: 20 },
    ];
    const prev = [
      { keys: ['https://example.com/a'], clicks: 60 },
      { keys: ['https://example.com/b'], clicks: 15 },
    ];

    expect(findTopSpikedPage(cur, prev)).toBe('https://example.com/a');
  });
});
