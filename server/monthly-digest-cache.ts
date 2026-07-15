import type { MonthlyDigestData } from '../shared/types/narrative.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

const digestCache = new Map<
  string,
  { workspaceId: string; result: MonthlyDigestData; ts: number }
>();
const inflightDigests = new Map<
  string,
  { workspaceId: string; generation: number; promise: Promise<MonthlyDigestData> }
>();
const workspaceCacheGenerations = new Map<string, number>();

function cacheGeneration(workspaceId: string): number {
  return workspaceCacheGenerations.get(workspaceId) ?? 0;
}

function cacheKey(workspaceId: string, cacheIdentity: string): string {
  return JSON.stringify([workspaceId, cacheIdentity]);
}

/**
 * Invalidate every cached digest month for one workspace.
 *
 * Matching in-flight entries are detached so the next read starts a fresh
 * computation immediately. Advancing the workspace generation prevents an older
 * promise from repopulating stale data when it eventually settles.
 */
export function invalidateMonthlyDigestCache(workspaceId: string): void {
  workspaceCacheGenerations.set(workspaceId, cacheGeneration(workspaceId) + 1);
  for (const [key, entry] of digestCache) {
    if (entry.workspaceId === workspaceId) digestCache.delete(key);
  }
  for (const [key, entry] of inflightDigests) {
    if (entry.workspaceId === workspaceId) inflightDigests.delete(key);
  }
}

/**
 * Read through the monthly-digest cache while coalescing concurrent computations.
 * The cache machinery lives here so mutation seams can invalidate digest data
 * without loading AI, analytics-provider, or inbox modules.
 */
export async function getOrComputeMonthlyDigest(
  workspaceId: string,
  cacheIdentity: string,
  nowMs: number,
  compute: () => Promise<MonthlyDigestData>,
): Promise<MonthlyDigestData> {
  const key = cacheKey(workspaceId, cacheIdentity);
  const cached = digestCache.get(key);
  if (cached) {
    if (nowMs - cached.ts < CACHE_TTL_MS) return cached.result;
    digestCache.delete(key);
  }

  const generation = cacheGeneration(workspaceId);
  const inflight = inflightDigests.get(key);
  if (inflight?.generation === generation) return inflight.promise;

  const promise = compute();
  inflightDigests.set(key, { workspaceId, generation, promise });
  try {
    const result = await promise;
    if (cacheGeneration(workspaceId) === generation) {
      if (digestCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = [...digestCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
        for (let index = 0; index < Math.ceil(MAX_CACHE_ENTRIES / 4); index += 1) {
          const entry = oldest[index];
          if (entry) digestCache.delete(entry[0]);
        }
      }
      digestCache.set(key, { workspaceId, result, ts: nowMs });
    }
    return result;
  } finally {
    if (inflightDigests.get(key)?.promise === promise) {
      inflightDigests.delete(key);
    }
  }
}
