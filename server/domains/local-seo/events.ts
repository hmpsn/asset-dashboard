import { broadcastToWorkspace } from '../../broadcast.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { WS_EVENTS } from '../../ws-events.js';

export function notifyLocalSeoUpdated(workspaceId: string, payload: Record<string, unknown>): void {
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.LOCAL_SEO_UPDATED, {
    workspaceId,
    ...payload,
  });
}
