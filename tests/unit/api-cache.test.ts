/**
 * Unit tests for server/api-cache.ts — 15-minute in-memory TTL cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiCache } from '../../server/api-cache.js';

beforeEach(() => {
  vi.useRealTimers();
});

describe('createApiCache', () => {
  it('returns undefined on first call (cache miss)', async () => {
    const cache = createApiCache({ ttlMs: 60_000 });
    const result = await cache.get('ws1', 'getTopQueries', { days: 28 });
    expect(result).toBeUndefined();
  });

  it('returns cached value on subsequent calls within TTL', async () => {
    const cache = createApiCache({ ttlMs: 60_000 });
    const data = { queries: ['seo tips', 'keyword research'] };

    cache.set('ws1', 'getTopQueries', { days: 28 }, data);
    const result = await cache.get('ws1', 'getTopQueries', { days: 28 });

    expect(result).toEqual(data);
  });

  it('returns undefined after TTL expires', async () => {
    vi.useFakeTimers();
    const cache = createApiCache({ ttlMs: 1_000 }); // 1 second TTL
    cache.set('ws1', 'getTopQueries', {}, { data: 'fresh' });

    vi.advanceTimersByTime(1_001);

    const result = await cache.get('ws1', 'getTopQueries', {});
    expect(result).toBeUndefined();
  });

  it('isolates cache entries by workspaceId', async () => {
    const cache = createApiCache({ ttlMs: 60_000 });
    cache.set('wsA', 'getTopQueries', {}, { data: 'A' });
    cache.set('wsB', 'getTopQueries', {}, { data: 'B' });

    expect(await cache.get('wsA', 'getTopQueries', {})).toEqual({ data: 'A' });
    expect(await cache.get('wsB', 'getTopQueries', {})).toEqual({ data: 'B' });
  });

  it('isolates cache entries by functionName', async () => {
    const cache = createApiCache({ ttlMs: 60_000 });
    cache.set('ws1', 'getTopQueries', {}, { queries: 5 });
    cache.set('ws1', 'getTopPages', {}, { pages: 10 });

    expect(await cache.get('ws1', 'getTopQueries', {})).toEqual({ queries: 5 });
    expect(await cache.get('ws1', 'getTopPages', {})).toEqual({ pages: 10 });
  });

  it('isolates cache entries by params hash', async () => {
    const cache = createApiCache({ ttlMs: 60_000 });
    cache.set('ws1', 'getTopQueries', { days: 7 }, { label: '7d' });
    cache.set('ws1', 'getTopQueries', { days: 28 }, { label: '28d' });

    expect(await cache.get('ws1', 'getTopQueries', { days: 7 })).toEqual({ label: '7d' });
    expect(await cache.get('ws1', 'getTopQueries', { days: 28 })).toEqual({ label: '28d' });
  });

  it('invalidates all entries for a workspace', async () => {
    const cache = createApiCache({ ttlMs: 60_000 });
    cache.set('ws1', 'fnA', {}, { a: 1 });
    cache.set('ws1', 'fnB', {}, { b: 2 });
    cache.set('ws2', 'fnA', {}, { c: 3 });

    cache.invalidate('ws1');

    expect(await cache.get('ws1', 'fnA', {})).toBeUndefined();
    expect(await cache.get('ws1', 'fnB', {})).toBeUndefined();
    expect(await cache.get('ws2', 'fnA', {})).toEqual({ c: 3 }); // other workspace untouched
  });

  it('wraps an async function and caches its result', async () => {
    const cache = createApiCache({ ttlMs: 60_000 });
    let callCount = 0;
    const fetchFn = async () => {
      callCount++;
      return { pages: 42 };
    };

    const result1 = await cache.wrap('ws1', 'getPages', {}, fetchFn);
    const result2 = await cache.wrap('ws1', 'getPages', {}, fetchFn);

    expect(result1).toEqual({ pages: 42 });
    expect(result2).toEqual({ pages: 42 });
    expect(callCount).toBe(1); // fetchFn called only once
  });
});
