import { describe, it, expect } from 'vitest';

function filterDeclinedFromPool(
  keywordPool: Map<string, unknown>,
  declinedKeywords: string[]
): number {
  const declinedSet = new Set(declinedKeywords.map(k => k.toLowerCase()));
  let removed = 0;
  for (const [kw] of keywordPool) {
    if (declinedSet.has(kw)) { keywordPool.delete(kw); removed++; }
  }
  return removed;
}

describe('filterDeclinedFromPool', () => {
  it('removes exact case-insensitive matches', () => {
    const pool = new Map<string, unknown>([
      ['seo agency', {}],
      ['bad keyword', {}],
      ['good term', {}],
    ]);
    const removed = filterDeclinedFromPool(pool, ['Bad Keyword']);
    expect(removed).toBe(1);
    expect(pool.has('bad keyword')).toBe(false);
    expect(pool.has('seo agency')).toBe(true);
  });

  it('returns 0 when no matches', () => {
    const pool = new Map<string, unknown>([['seo', {}]]);
    const removed = filterDeclinedFromPool(pool, ['ppc']);
    expect(removed).toBe(0);
    expect(pool.size).toBe(1);
  });

  it('handles empty declined list gracefully', () => {
    const pool = new Map<string, unknown>([['seo', {}]]);
    const removed = filterDeclinedFromPool(pool, []);
    expect(removed).toBe(0);
  });
});
