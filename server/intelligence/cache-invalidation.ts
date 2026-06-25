import { broadcastToWorkspace } from '../broadcast.js';
import { invalidateSubCachePrefix } from '../bridge-infrastructure.js';
import { createLogger } from '../logger.js';
import { WS_EVENTS } from '../ws-events.js';
import { intelligenceCache } from './cache-state.js';

const log = createLogger('workspace-intelligence');

/** Invalidate all cached intelligence for a workspace */
export function invalidateIntelligenceCache(workspaceId: string): void {
  const deleted = intelligenceCache.deleteByPrefix(`intelligence:${workspaceId}:`);
  try {
    invalidateSubCachePrefix(workspaceId, '');
  } catch { // catch-ok — sub-cache table may not exist on older DBs; non-critical
  }

  try {
    broadcastToWorkspace(workspaceId, WS_EVENTS.INTELLIGENCE_CACHE_UPDATED, {
      workspaceId,
      invalidatedAt: new Date().toISOString(),
    });
  } catch { // catch-ok — broadcasting is best-effort; don't fail cache invalidation
  }

  log.info?.({ workspaceId, entriesDeleted: deleted }, 'Intelligence cache invalidated (in-memory + persistent + broadcast)');
}
