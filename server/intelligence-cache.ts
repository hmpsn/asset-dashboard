// server/intelligence-cache.ts
// LRU cache with TTL, stale marking, and single-flight dedup.
// Spec: docs/superpowers/specs/unified-workspace-intelligence.md §13, §30, §33

const MAX_STALENESS_MS = 24 * 60 * 60 * 1000; // 24 hours — §30

// Monotonic access counter — avoids ties from same-millisecond access
let accessClock = 0;

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
  ttlMs: number;
  /** Monotonic counter; higher = more recently accessed */
  accessOrder: number;
  stale: boolean;
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();

  constructor(private maxEntries: number) {}

  get(key: string): { data: T; stale: boolean } | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    const age = now - entry.cachedAt;

    // Max staleness: never serve data older than 24 hours (§30)
    if (age > MAX_STALENESS_MS) {
      this.cache.delete(key);
      return null;
    }

    // Natural TTL expiry: return null to trigger recompute
    if (!entry.stale && age > entry.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    entry.accessOrder = ++accessClock;
    return { data: entry.value, stale: entry.stale };
  }

  set(key: string, value: T, ttlMs: number): void {
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictLeastRecent();
    }
    this.cache.set(key, {
      value,
      cachedAt: Date.now(),
      ttlMs,
      accessOrder: ++accessClock,
      stale: false,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  /** Mark an entry as stale (invalidated but recomputation pending/failed) */
  markStale(key: string): void {
    const entry = this.cache.get(key);
    if (entry) entry.stale = true;
  }

  /** Delete all entries whose key starts with prefix */
  deleteByPrefix(prefix: string): number {
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * Peek at an entry without TTL enforcement — returns the stored value
   * even if expired, as long as it hasn't exceeded MAX_STALENESS_MS.
   * Does NOT delete expired entries. Use for stale-fallback-on-error paths
   * where serving old data is better than returning nothing.
   */
  peek(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Still respect the hard 24-hour max staleness
    const age = Date.now() - entry.cachedAt;
    if (age > MAX_STALENESS_MS) return null;

    return entry.value;
  }

  /** Returns current cache stats for health endpoint (§18) */
  stats(): { entries: number; maxEntries: number } {
    return { entries: this.cache.size, maxEntries: this.maxEntries };
  }

  private evictLeastRecent(): void {
    let oldestKey: string | null = null;
    let oldestOrder = Infinity;
    for (const [k, v] of this.cache) {
      if (v.accessOrder < oldestOrder) {
        oldestKey = k;
        oldestOrder = v.accessOrder;
      }
    }
    if (oldestKey) this.cache.delete(oldestKey);
  }
}

// ── Single-flight dedup ─────────────────────────────────────────────────

const inflight = new Map<string, Promise<unknown>>();

/**
 * Ensures only one instance of `fn` runs for a given key at a time.
 * Concurrent callers receive the same Promise result.
 * After completion, the key is removed so future calls re-execute.
 */
export async function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fn().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}
