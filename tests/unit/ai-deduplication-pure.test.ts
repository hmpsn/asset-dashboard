/**
 * Pure unit tests for AIRequestDeduplicator.
 *
 * Covers:
 * - createKey determinism and differentiation
 * - Cache hit / cache miss / TTL expiry
 * - In-flight deduplication (concurrent callers share one promise)
 * - Cache size eviction (>maxCacheSize)
 * - cleanup() for stale pending and expired cache entries
 * - getStats() reporting
 * - skipCache option
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIRequestDeduplicator } from '../../server/ai-deduplication.js';

// ── createKey ────────────────────────────────────────────────────────────────

describe('AIRequestDeduplicator.createKey', () => {
  it('returns a string starting with "ai_"', () => {
    const key = AIRequestDeduplicator.createKey({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(key).toMatch(/^ai_gpt-4_/);
  });

  it('is deterministic for identical inputs', () => {
    const params = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hello world' }],
      temperature: 0.5,
    };
    const k1 = AIRequestDeduplicator.createKey(params);
    const k2 = AIRequestDeduplicator.createKey(params);
    expect(k1).toBe(k2);
  });

  it('differs when model changes', () => {
    const base = { messages: [{ role: 'user', content: 'x' }] };
    const k1 = AIRequestDeduplicator.createKey({ model: 'gpt-4', ...base });
    const k2 = AIRequestDeduplicator.createKey({ model: 'gpt-3.5-turbo', ...base });
    expect(k1).not.toBe(k2);
  });

  it('differs when message content changes', () => {
    const k1 = AIRequestDeduplicator.createKey({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const k2 = AIRequestDeduplicator.createKey({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'goodbye' }],
    });
    expect(k1).not.toBe(k2);
  });

  it('differs when temperature changes', () => {
    const base = { model: 'gpt-4', messages: [{ role: 'user', content: 'q' }] };
    const k1 = AIRequestDeduplicator.createKey({ ...base, temperature: 0.0 });
    const k2 = AIRequestDeduplicator.createKey({ ...base, temperature: 1.0 });
    expect(k1).not.toBe(k2);
  });

  it('defaults missing temperature to 0.7 (two calls without explicit temp match)', () => {
    const base = { model: 'gpt-4', messages: [{ role: 'user', content: 'q' }] };
    const k1 = AIRequestDeduplicator.createKey(base);
    const k2 = AIRequestDeduplicator.createKey({ ...base, temperature: 0.7 });
    expect(k1).toBe(k2);
  });

  it('differs when workspaceId changes', () => {
    const base = { model: 'gpt-4', messages: [{ role: 'user', content: 'q' }] };
    const k1 = AIRequestDeduplicator.createKey({ ...base, workspaceId: 'ws-1' });
    const k2 = AIRequestDeduplicator.createKey({ ...base, workspaceId: 'ws-2' });
    expect(k1).not.toBe(k2);
  });

  it('differs when feature changes', () => {
    const base = { model: 'gpt-4', messages: [{ role: 'user', content: 'q' }] };
    const k1 = AIRequestDeduplicator.createKey({ ...base, feature: 'chat-summary' });
    const k2 = AIRequestDeduplicator.createKey({ ...base, feature: 'seo-audit' });
    expect(k1).not.toBe(k2);
  });

  it('includes a 16-char hex hash suffix', () => {
    const key = AIRequestDeduplicator.createKey({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'test' }],
    });
    // Format: ai_<model>_<16 hex chars>
    const parts = key.split('_');
    const hash = parts[parts.length - 1];
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ── Cache hit / miss ─────────────────────────────────────────────────────────

describe('AIRequestDeduplicator — cache hit / miss', () => {
  let dedup: AIRequestDeduplicator;

  beforeEach(() => {
    dedup = new AIRequestDeduplicator();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the cached value on the second call', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return 'result-a';
    };

    const r1 = await dedup.deduplicate('key-1', fetcher);
    const r2 = await dedup.deduplicate('key-1', fetcher);

    expect(r1).toBe('result-a');
    expect(r2).toBe('result-a');
    expect(callCount).toBe(1); // fetcher called only once
  });

  it('does NOT use cache when skipCache is true', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return 'result-b';
    };

    await dedup.deduplicate('key-2', fetcher);
    await dedup.deduplicate('key-2', fetcher, { skipCache: true });

    expect(callCount).toBe(2);
  });

  it('re-fetches after cache TTL expires', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return 'result-c';
    };

    const shortTtl = 1000; // 1 second
    await dedup.deduplicate('key-3', fetcher, { cacheTtlMs: shortTtl });
    // Advance past TTL
    vi.advanceTimersByTime(shortTtl + 1);
    await dedup.deduplicate('key-3', fetcher, { cacheTtlMs: shortTtl });

    expect(callCount).toBe(2);
  });

  it('different keys get different cached values', async () => {
    const r1 = await dedup.deduplicate('key-a', async () => 'alpha');
    const r2 = await dedup.deduplicate('key-b', async () => 'beta');

    expect(r1).toBe('alpha');
    expect(r2).toBe('beta');
  });
});

// ── In-flight deduplication ──────────────────────────────────────────────────

describe('AIRequestDeduplicator — in-flight deduplication', () => {
  let dedup: AIRequestDeduplicator;

  beforeEach(() => {
    dedup = new AIRequestDeduplicator();
  });

  it('concurrent callers share a single in-flight promise', async () => {
    let callCount = 0;
    let resolveRequest!: (v: string) => void;

    const fetcher = () =>
      new Promise<string>(res => {
        callCount++;
        resolveRequest = res;
      });

    const p1 = dedup.deduplicate('inflight-key', fetcher, { skipCache: true });
    const p2 = dedup.deduplicate('inflight-key', fetcher, { skipCache: true });

    // Only one fetcher invocation at this point
    expect(callCount).toBe(1);

    resolveRequest('shared-result');
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe('shared-result');
    expect(r2).toBe('shared-result');
    expect(callCount).toBe(1);
  });

  it('propagates errors to all in-flight callers', async () => {
    let rejectRequest!: (e: Error) => void;

    const fetcher = () =>
      new Promise<string>((_, rej) => {
        rejectRequest = rej;
      });

    const p1 = dedup.deduplicate('err-key', fetcher, { skipCache: true });
    const p2 = dedup.deduplicate('err-key', fetcher, { skipCache: true });

    rejectRequest(new Error('API failure'));

    await expect(p1).rejects.toThrow('API failure');
    await expect(p2).rejects.toThrow('API failure');
  });
});

// ── getStats() ───────────────────────────────────────────────────────────────

describe('AIRequestDeduplicator.getStats', () => {
  it('starts with zero pending and zero cache', () => {
    const dedup = new AIRequestDeduplicator();
    const stats = dedup.getStats();
    expect(stats.pendingRequests).toBe(0);
    expect(stats.cacheSize).toBe(0);
    expect(stats.oldestPending).toBeNull();
    expect(stats.oldestCache).toBeNull();
  });

  it('reflects a completed request in cacheSize', async () => {
    const dedup = new AIRequestDeduplicator();
    await dedup.deduplicate('stats-key', async () => 42);
    const stats = dedup.getStats();
    expect(stats.cacheSize).toBe(1);
    expect(stats.pendingRequests).toBe(0);
  });

  it('reports oldestCache as a non-negative number after a cache entry exists', async () => {
    const dedup = new AIRequestDeduplicator();
    await dedup.deduplicate('age-key', async () => 'v');
    const stats = dedup.getStats();
    expect(stats.oldestCache).toBeGreaterThanOrEqual(0);
  });
});

describe('AIRequestDeduplicator — policy outcomes and counters', () => {
  it('distinguishes misses, completed cache hits, and inflight coalesces', async () => {
    const dedup = new AIRequestDeduplicator();
    let resolve!: (value: string) => void;
    const fetcher = vi.fn(() => new Promise<string>(r => { resolve = r; }));

    const first = dedup.execute('policy-key', fetcher, { mode: 'ttl', ttlMs: 60_000 });
    const joined = dedup.execute('policy-key', fetcher, { mode: 'ttl', ttlMs: 60_000 });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    resolve('value');

    expect(await first).toEqual({ value: 'value', cacheOutcome: 'miss' });
    expect(await joined).toEqual({ value: 'value', cacheOutcome: 'inflight' });
    expect(await dedup.execute('policy-key', fetcher, { mode: 'ttl', ttlMs: 60_000 }))
      .toEqual({ value: 'value', cacheOutcome: 'hit' });
    expect(dedup.getStats()).toMatchObject({ requests: 3, misses: 1, cacheHits: 1, inflightJoins: 1 });
  });

  it('none executes every request while inflight never replays completion', async () => {
    const dedup = new AIRequestDeduplicator();
    const fetcher = vi.fn(async () => 'value');
    await dedup.execute('none-key', fetcher, { mode: 'none' });
    await dedup.execute('none-key', fetcher, { mode: 'none' });
    await dedup.execute('inflight-key-2', fetcher, { mode: 'inflight' });
    await dedup.execute('inflight-key-2', fetcher, { mode: 'inflight' });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('never expires a live in-flight request into duplicate provider work', async () => {
    vi.useFakeTimers();
    const dedup = new AIRequestDeduplicator();
    let resolve!: (value: string) => void;
    const fetcher = vi.fn(() => new Promise<string>(r => { resolve = r; }));
    const first = dedup.execute('long-running', fetcher, { mode: 'inflight' });
    vi.advanceTimersByTime(10 * 60 * 1000);
    dedup.cleanup();
    const joined = dedup.execute('long-running', fetcher, { mode: 'inflight' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve('done');
    await expect(Promise.all([first, joined])).resolves.toEqual([
      { value: 'done', cacheOutcome: 'miss' },
      { value: 'done', cacheOutcome: 'inflight' },
    ]);
    vi.useRealTimers();
  });
});

// ── cleanup() ────────────────────────────────────────────────────────────────

describe('AIRequestDeduplicator.cleanup', () => {
  it('removes expired cache entries', async () => {
    vi.useFakeTimers();
    const dedup = new AIRequestDeduplicator();

    await dedup.deduplicate('exp-key', async () => 'v', { cacheTtlMs: 500 });
    expect(dedup.getStats().cacheSize).toBe(1);

    vi.advanceTimersByTime(600); // past TTL
    dedup.cleanup();

    expect(dedup.getStats().cacheSize).toBe(0);
    vi.useRealTimers();
  });

  it('does not remove still-valid cache entries', async () => {
    vi.useFakeTimers();
    const dedup = new AIRequestDeduplicator();

    await dedup.deduplicate('valid-key', async () => 'v', { cacheTtlMs: 60_000 });
    vi.advanceTimersByTime(1_000); // well within TTL
    dedup.cleanup();

    expect(dedup.getStats().cacheSize).toBe(1);
    vi.useRealTimers();
  });
});
