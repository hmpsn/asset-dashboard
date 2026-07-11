import { broadcastToWorkspace } from '../broadcast.js';
import { createLogger } from '../logger.js';
import { WS_EVENTS } from '../ws-events.js';
import { clearIntelligenceCache } from './cache-clear.js';

const log = createLogger('workspace-intelligence');

/** Invalidate all cached intelligence for a workspace and notify subscribers. */
export function invalidateIntelligenceCache(workspaceId: string): void {
  const deleted = clearIntelligenceCache(workspaceId);

  try {
    broadcastToWorkspace(workspaceId, WS_EVENTS.INTELLIGENCE_CACHE_UPDATED, {
      workspaceId,
      invalidatedAt: new Date().toISOString(),
    });
  } catch { // catch-ok — broadcasting is best-effort; don't fail cache invalidation
  }

  log.info?.({ workspaceId, entriesDeleted: deleted }, 'Intelligence cache invalidated (in-memory + persistent + broadcast)');
}
