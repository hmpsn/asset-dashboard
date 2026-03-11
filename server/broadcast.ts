/**
 * Broadcast singleton — set once in index.ts, imported by route modules.
 *
 * This avoids passing broadcast functions through every router factory
 * while keeping the WebSocket setup in index.ts.
 */

type BroadcastFn = (event: string, data: unknown) => void;
type WorkspaceBroadcastFn = (workspaceId: string, event: string, data: unknown) => void;

let _broadcast: BroadcastFn = () => {
  throw new Error('broadcast() called before init — call setBroadcast() in index.ts first');
};

let _broadcastToWorkspace: WorkspaceBroadcastFn = () => {
  throw new Error('broadcastToWorkspace() called before init — call setBroadcast() in index.ts first');
};

/** Called once from index.ts after the WebSocket server is created. */
export function setBroadcast(bc: BroadcastFn, bcWs: WorkspaceBroadcastFn) {
  _broadcast = bc;
  _broadcastToWorkspace = bcWs;
}

/** Broadcast to ALL connected clients (global events like jobs, queue). */
export function broadcast(event: string, data: unknown) {
  _broadcast(event, data);
}

/** Broadcast to clients subscribed to a specific workspace. */
export function broadcastToWorkspace(workspaceId: string, event: string, data: unknown) {
  _broadcastToWorkspace(workspaceId, event, data);
}
