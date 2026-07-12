import { invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { intelligenceCache } from './cache-state.js';

/**
 * Clear all cached intelligence for a workspace without broadcasting.
 * This cycle-safe leaf lets mutation services finish dependent cache writes
 * before their owning domain event is emitted.
 */
export function clearIntelligenceCache(workspaceId: string): number {
  const deleted = intelligenceCache.deleteByPrefix(`intelligence:${workspaceId}:`);
  try {
    invalidateSubCachePrefix(workspaceId, '');
  } catch { // catch-ok — sub-cache table may not exist on older DBs; non-critical
  }
  return deleted;
}
