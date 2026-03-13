import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { setBroadcast } from './broadcast.js';
import { initJobs } from './jobs.js';
import { initActivityBroadcast } from './activity-log.js';
import { initAnomalyBroadcast } from './anomaly-detection.js';
import { initStripeBroadcast } from './stripe.js';
import { startWatcher } from './processor.js';

// --- WebSocket state ---
const clients = new Set<WebSocket>();
const clientWorkspaces = new Map<WebSocket, Set<string>>();

// --- User Presence Tracking ---
interface PresenceInfo {
  userId: string;
  email: string;
  name?: string;
  workspaceId: string;
  role: 'client' | 'admin';
  connectedAt: string;
  lastSeen: string;
}
const clientPresence = new Map<WebSocket, PresenceInfo>();

/** Get all currently online users, grouped by workspace. */
export function getPresence(): Record<string, Array<{ userId: string; email: string; name?: string; role: string; connectedAt: string; lastSeen: string }>> {
  const result: Record<string, Array<{ userId: string; email: string; name?: string; role: string; connectedAt: string; lastSeen: string }>> = {};
  for (const [ws, info] of clientPresence) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (!result[info.workspaceId]) result[info.workspaceId] = [];
    // Deduplicate by userId (user might have multiple tabs)
    if (!result[info.workspaceId].some(u => u.userId === info.userId)) {
      result[info.workspaceId].push({
        userId: info.userId,
        email: info.email,
        name: info.name,
        role: info.role,
        connectedAt: info.connectedAt,
        lastSeen: info.lastSeen,
      });
    }
  }
  return result;
}

/** Broadcast to ALL connected clients. */
function _broadcast(event: string, data: unknown) {
  const msg = JSON.stringify({ event, data });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

/** Broadcast to clients subscribed to a specific workspace. */
function _broadcastToWorkspace(workspaceId: string, event: string, data: unknown) {
  const msg = JSON.stringify({ event, data, workspaceId });
  for (const [ws, subs] of clientWorkspaces) {
    if (ws.readyState === WebSocket.OPEN && subs.has(workspaceId)) {
      ws.send(msg);
    }
  }
}

/** Broadcast presence update to all admin clients. */
function broadcastPresenceUpdate() {
  const presence = getPresence();
  _broadcast('presence:update', presence);
}

/**
 * Create the WebSocket server, wire up broadcast singleton, and
 * initialise subsystems that depend on broadcast (jobs, activity, anomalies, stripe, processor).
 */
export function initWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    clientWorkspaces.set(ws, new Set());

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.action === 'subscribe' && typeof msg.workspaceId === 'string') {
          clientWorkspaces.get(ws)?.add(msg.workspaceId);
        } else if (msg.action === 'unsubscribe' && typeof msg.workspaceId === 'string') {
          clientWorkspaces.get(ws)?.delete(msg.workspaceId);
        } else if (msg.action === 'identify' && typeof msg.userId === 'string' && typeof msg.workspaceId === 'string') {
          const now = new Date().toISOString();
          clientPresence.set(ws, {
            userId: msg.userId,
            email: msg.email || '',
            name: msg.name,
            workspaceId: msg.workspaceId,
            role: msg.role || 'client',
            connectedAt: now,
            lastSeen: now,
          });
          broadcastPresenceUpdate();
        } else if (msg.action === 'heartbeat') {
          const info = clientPresence.get(ws);
          if (info) info.lastSeen = new Date().toISOString();
        }
      } catch { /* ignore malformed messages */ }
    });

    ws.on('close', () => {
      const hadPresence = clientPresence.has(ws);
      clients.delete(ws);
      clientWorkspaces.delete(ws);
      clientPresence.delete(ws);
      if (hadPresence) broadcastPresenceUpdate();
    });
  });

  // Wire up the broadcast singleton so route files use these functions
  setBroadcast(_broadcast, _broadcastToWorkspace);

  // Initialise subsystems that depend on broadcast
  initJobs(_broadcast);
  initActivityBroadcast(_broadcastToWorkspace);
  initAnomalyBroadcast(_broadcastToWorkspace);
  initStripeBroadcast(_broadcastToWorkspace);
  startWatcher(_broadcast);

  return wss;
}
