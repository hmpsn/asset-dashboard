// tests/unit/intelligence-cache.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LRUCache, singleFlight } from '../../server/intelligence-cache.js';

describe('LRUCache', () => {
  let cache: LRUCache<string>;

  beforeEach(() => {
    cache = new LRUCache<string>(3); // max 3 entries
  });

  it('stores and retrieves values', () => {
    cache.set('a', 'value-a', 60_000);
    expect(cache.get('a')).toEqual({ data: 'value-a', stale: false });
  });

  it('returns null for missing keys', () => {
    expect(cache.get('missing')).toBeNull();
  });

  it('evicts least recently accessed when full', () => {
    cache.set('a', '1', 60_000);
    cache.set('b', '2', 60_000);
    cache.set('c', '3', 60_000);
    // Access 'a' to make it recent
    cache.get('a');
    // Add 'd' — should evict 'b' (least recently accessed)
    cache.set('d', '4', 60_000);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).not.toBeNull();
    expect(cache.get('d')).not.toBeNull();
  });

  it('deletes entries', () => {
    cache.set('a', 'value', 60_000);
    cache.delete('a');
    expect(cache.get('a')).toBeNull();
  });

  it('marks entries as stale and returns them with stale flag', () => {
    cache.set('a', 'value', 60_000);
    cache.markStale('a');
    const result = cache.get('a');
    expect(result).toEqual({ data: 'value', stale: true });
  });

  it('reports size correctly', () => {
    expect(cache.size).toBe(0);
    cache.set('a', '1', 60_000);
    cache.set('b', '2', 60_000);
    expect(cache.size).toBe(2);
  });

  it('deletes entries by prefix', () => {
    cache.set('intelligence:ws-1:all', '1', 60_000);
    cache.set('intelligence:ws-1:seo', '2', 60_000);
    cache.set('intelligence:ws-2:all', '3', 60_000);
    const deleted = cache.deleteByPrefix('intelligence:ws-1:');
    expect(deleted).toBe(2);
    expect(cache.size).toBe(1);
    expect(cache.get('intelligence:ws-2:all')).not.toBeNull();
  });

  it('clears all entries', () => {
    cache.set('a', '1', 60_000);
    cache.set('b', '2', 60_000);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('LRUCache with timers', () => {
  let cache: LRUCache<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new LRUCache<string>(3);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for expired entries', () => {
    cache.set('a', 'value', 1); // 1ms TTL
    vi.advanceTimersByTime(10);
    expect(cache.get('a')).toBeNull();
  });

  it('enforces max staleness of 24 hours', () => {
    cache.set('a', 'value', 60_000);
    cache.markStale('a');
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    expect(cache.get('a')).toBeNull();
  });
});

describe('singleFlight', () => {
  it('deduplicates concurrent calls for the same key', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 50));
      return 'result';
    };

    const [r1, r2, r3] = await Promise.all([
      singleFlight('key1', fn),
      singleFlight('key1', fn),
      singleFlight('key1', fn),
    ]);

    expect(callCount).toBe(1);
    expect(r1).toBe('result');
    expect(r2).toBe('result');
    expect(r3).toBe('result');
  });

  it('allows different keys to run independently', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return 'result';
    };

    await Promise.all([
      singleFlight('key1', fn),
      singleFlight('key2', fn),
    ]);

    expect(callCount).toBe(2);
  });

  it('cleans up after completion so subsequent calls re-execute', async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return 'result';
    };

    await singleFlight('key1', fn);
    await singleFlight('key1', fn);

    expect(callCount).toBe(2);
  });
});
