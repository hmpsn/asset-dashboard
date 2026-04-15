/**
 * AI Request Deduplication System
 * 
 * Prevents duplicate AI API calls by caching in-flight requests and recent results.
 * Identical requests (same prompt, model, temperature, etc.) share the same response.
 * 
 * Benefits:
 * - Eliminates duplicate API calls
 * - Reduces token usage and costs
 * - Improves response times for cached results
 * - Smoother rate limit usage
 */

import { createLogger } from './logger.js';
import crypto from 'crypto';

const log = createLogger('ai-deduplication');

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

interface CachedResult<T> {
  data: T;
  timestamp: number;
  expiry: number;
}

class AIRequestDeduplicator {
  // In-flight requests (prevents duplicate calls for same request)
  private pending = new Map<string, PendingRequest<unknown>>();
  
  // Completed requests with TTL (allows cache hits for recent identical requests)
  private cache = new Map<string, CachedResult<unknown>>();
  
  // Configuration
  private readonly maxPendingAge = 120 * 1000; // 120 seconds (must exceed API timeout + retry budget)
  private readonly defaultCacheTtl = 5 * 60 * 1000; // 5 minutes
  private readonly maxCacheSize = 1000; // Prevent memory bloat
  
  /**
   * Execute an AI request with deduplication
   * 
   * If an identical request is already in flight, returns the same promise
   * If a recent identical result exists in cache, returns cached result
   * Otherwise executes the request and caches the result
   */
  async deduplicate<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: {
      cacheTtlMs?: number;
      skipCache?: boolean;
    }
  ): Promise<T> {
    const cacheTtlMs = options?.cacheTtlMs ?? this.defaultCacheTtl;
    
    // Check cache first (unless skipped)
    if (!options?.skipCache) {
      const cached = this.getFromCache<T>(key);
      if (cached) {
        log.debug({ key }, 'AI request cache hit');
        return cached;
      }
    }
    
    // Check if same request is already in flight
    const existing = this.getPendingRequest<T>(key);
    if (existing) {
      log.debug({ key }, 'AI request deduplication hit (in-flight)');
      return existing;
    }
    
    // Create new request
    const promise = this.createPendingRequest<T>(key, fetcher);
    
    try {
      const result = await promise;
      
      // Cache successful result
      if (!options?.skipCache) {
        this.setCache(key, result, cacheTtlMs);
      }
      
      log.debug({ key }, 'AI request completed and cached');
      return result;
      
    } catch (error) {
      log.warn({ key, error: error instanceof Error ? error.message : String(error) }, 'AI request failed');
      throw error;
    } finally {
      // Clean up pending request
      this.pending.delete(key);
    }
  }
  
  /**
   * Create a cache key from request parameters
   */
  static createKey(params: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: string };
    workspaceId?: string;
    feature?: string;
  }): string {
    const keyData = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens,
      responseFormat: params.responseFormat,
      workspaceId: params.workspaceId,
      feature: params.feature,
    };
    
    // Create deterministic hash
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(keyData))
      .digest('hex');
    
    return `ai_${params.model}_${hash.slice(0, 16)}`;
  }
  
  /**
   * Get statistics for monitoring
   */
  getStats() {
    return {
      pendingRequests: this.pending.size,
      cacheSize: this.cache.size,
      oldestPending: this.getOldestPendingAge(),
      oldestCache: this.getOldestCacheAge(),
    };
  }
  
  /**
   * Clear expired entries
   */
  cleanup() {
    const now = Date.now();
    
    // Clean up expired pending requests
    for (const [key, pending] of this.pending.entries()) {
      if (now - pending.timestamp > this.maxPendingAge) {
        pending.reject(new Error('Request timed out'));
        this.pending.delete(key);
      }
    }
    
    // Clean up expired cache entries
    for (const [key, cached] of this.cache.entries()) {
      if (now > cached.expiry) {
        this.cache.delete(key);
      }
    }
    
    // Prevent cache from growing too large
    if (this.cache.size > this.maxCacheSize) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      // Remove oldest 25% of entries
      const toRemove = Math.floor(entries.length * 0.25);
      for (let i = 0; i < toRemove; i++) {
        this.cache.delete(entries[i][0]);
      }
    }
  }
  
  // Private methods
  
  private getFromCache<T>(key: string): T | null {
    const cached = this.cache.get(key) as CachedResult<T> | undefined;
    if (!cached) return null;
    
    if (Date.now() > cached.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data as T;
  }
  
  private getPendingRequest<T>(key: string): Promise<T> | null {
    const pending = this.pending.get(key) as PendingRequest<T> | undefined;
    if (!pending) return null;
    
    // Clean up stale pending requests
    if (Date.now() - pending.timestamp > this.maxPendingAge) {
      pending.reject(new Error('Request timed out'));
      this.pending.delete(key);
      return null;
    }
    
    return pending.promise as Promise<T>;
  }
  
  private createPendingRequest<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    let resolve: (value: T) => void;
    let reject: (error: Error) => void;
    
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    
    // Fire-and-forget: pipe fetcher result into the deferred promise.
    // Do NOT store fetchPromise — .then(resolve) resolves to undefined (the
    // return value of resolve()), so concurrent callers would get undefined back.
    // Store `promise` (the real deferred) so getPendingRequest returns the correct T.
    fetcher().then(resolve!).catch(reject!);

    this.pending.set(key, {
      promise,
      timestamp: Date.now(),
      resolve: resolve!,
      reject: reject!,
    } as PendingRequest<unknown>);
    
    return promise;
  }
  
  private setCache<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiry: Date.now() + ttlMs,
    });
  }
  
  private getOldestPendingAge(): number | null {
    if (this.pending.size === 0) return null;
    
    let oldest = Date.now();
    for (const pending of this.pending.values()) {
      if (pending.timestamp < oldest) {
        oldest = pending.timestamp;
      }
    }
    
    return Date.now() - oldest;
  }
  
  private getOldestCacheAge(): number | null {
    if (this.cache.size === 0) return null;
    
    let oldest = Date.now();
    for (const cached of this.cache.values()) {
      if (cached.timestamp < oldest) {
        oldest = cached.timestamp;
      }
    }
    
    return Date.now() - oldest;
  }
}

// Global instance
export const aiDeduplicator = new AIRequestDeduplicator();

// Cleanup expired entries every minute
setInterval(() => {
  aiDeduplicator.cleanup();
}, 60 * 1000);

// Export for testing
export { AIRequestDeduplicator };
