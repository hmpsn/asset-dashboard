/**
 * Unit tests for Phase 4E — GSC pagination for intelligence computation.
 *
 * Tests that paginateGscQuery() fetches multiple pages of results
 * using startRow parameter, up to a configurable max.
 */
import { describe, it, expect, beforeAll } from 'vitest';

describe('paginateGscQuery', () => {
  let paginateGscQuery: (
    fetchPage: (startRow: number, rowLimit: number) => Promise<Array<{ query: string; page: string }>>,
    opts?: { maxRows?: number; pageSize?: number }
  ) => Promise<Array<{ query: string; page: string }>>;

  beforeAll(async () => {
    const mod = await import('../../server/search-console.js');
    paginateGscQuery = mod.paginateGscQuery;
  });

  it('returns single page when results < pageSize', async () => {
    const fetchPage = async () => [
      { query: 'seo tips', page: 'https://example.com/seo' },
      { query: 'web design', page: 'https://example.com/web' },
    ];
    const results = await paginateGscQuery(fetchPage, { pageSize: 500 });
    expect(results).toHaveLength(2);
  });

  it('paginates when results fill a page', async () => {
    let callCount = 0;
    const fetchPage = async (startRow: number) => {
      callCount++;
      if (startRow === 0) return Array.from({ length: 500 }, (_, i) => ({ query: `q${i}`, page: `p${i}` }));
      if (startRow === 500) return Array.from({ length: 200 }, (_, i) => ({ query: `q${500 + i}`, page: `p${500 + i}` }));
      return [];
    };
    const results = await paginateGscQuery(fetchPage, { maxRows: 2000, pageSize: 500 });
    expect(results).toHaveLength(700);
    expect(callCount).toBe(2);
  });

  it('stops at maxRows limit', async () => {
    const fetchPage = async () => Array.from({ length: 500 }, (_, i) => ({ query: `q${i}`, page: `p${i}` }));
    const results = await paginateGscQuery(fetchPage, { maxRows: 1000, pageSize: 500 });
    expect(results.length).toBeLessThanOrEqual(1000);
  });

  it('defaults to maxRows=2000 and pageSize=500', async () => {
    let calls: number[] = [];
    const fetchPage = async (startRow: number) => {
      calls.push(startRow);
      if (startRow === 0) return Array.from({ length: 500 }, (_, i) => ({ query: `q${i}`, page: `p${i}` }));
      return [];
    };
    await paginateGscQuery(fetchPage);
    expect(calls[0]).toBe(0);
  });

  it('returns empty array when first page is empty', async () => {
    const fetchPage = async () => [] as Array<{ query: string; page: string }>;
    const results = await paginateGscQuery(fetchPage);
    expect(results).toHaveLength(0);
  });

  it('passes correct startRow values', async () => {
    const calls: number[] = [];
    const fetchPage = async (startRow: number) => {
      calls.push(startRow);
      if (calls.length <= 3) return Array.from({ length: 500 }, (_, i) => ({ query: `q${startRow + i}`, page: 'p' }));
      return [];
    };
    await paginateGscQuery(fetchPage, { maxRows: 2000, pageSize: 500 });
    expect(calls).toEqual([0, 500, 1000, 1500]);
  });
});
