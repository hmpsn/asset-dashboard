/**
 * In-memory TTL cache for GSC/GA4 API responses.
 * Keyed by (workspaceId, functionName, paramsHash).
 * Default TTL: 15 minutes.
 */

const DEFAULT_TTL_MS = 15 * 60 * 1_000;

// Sentinel for caching functions that legitimately return undefined
const CACHED_UNDEFINED = Symbol('CACHED_UNDEFINED');

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export interface ApiCacheOptions {
  ttlMs?: number;
}

export interface ApiCache {
  get(workspaceId: string, functionName: string, params: object): Promise<unknown | undefined>;
  set(workspaceId: string, functionName: string, params: object, value: unknown): void;
  wrap<T>(workspaceId: string, functionName: string, params: object, fn: () => Promise<T>): Promise<T>;
  invalidate(workspaceId: string): void;
}

function hashParams(params: object): string {
  return JSON.stringify(params, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value).sort()) sorted[k] = value[k];
      return sorted;
    }
    return value;
  });
}

function cacheKey(workspaceId: string, functionName: string, params: object): string {
  return `${workspaceId}:${functionName}:${hashParams(params)}`;
}

export function createApiCache(options: ApiCacheOptions = {}): ApiCache {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const store = new Map<string, CacheEntry>();

  return {
    async get(workspaceId, functionName, params) {
      const key = cacheKey(workspaceId, functionName, params);
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },

    set(workspaceId, functionName, params, value) {
      const key = cacheKey(workspaceId, functionName, params);
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },

    async wrap<T>(workspaceId: string, functionName: string, params: object, fn: () => Promise<T>): Promise<T> {
      const cached = await this.get(workspaceId, functionName, params);
      if (cached !== undefined) return (cached === CACHED_UNDEFINED ? undefined : cached) as T;
      const result = await fn();
      this.set(workspaceId, functionName, params, result === undefined ? CACHED_UNDEFINED : result);
      return result;
    },

    invalidate(workspaceId) {
      const prefix = `${workspaceId}:`;
      const toDelete = [...store.keys()].filter(k => k.startsWith(prefix));
      for (const key of toDelete) store.delete(key);
    },
  };
}

/** Singleton cache instance used by GSC/GA4 wrappers. */
export const apiCache = createApiCache();
