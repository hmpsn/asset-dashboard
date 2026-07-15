import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { setBroadcast } from './broadcast.js';
import { initJobs } from './jobs.js';
import { initActivityBroadcast } from './activity-log.js';
import { initAnomalyBroadcast } from './anomaly-detection.js';
import { initStripeBroadcast } from './stripe.js';
import { startWatcher } from './processor.js';
import { verifyToken, type JwtPayload } from './auth.js';
import { verifyAdminToken } from './middleware.js';
import { getUserById } from './users.js';
import { recoverStuckDiagnosticReports } from './diagnostic-store.js';
import { reconcileBrandGenerationRunsAfterRestart } from './domains/brand/generation/recovery.js';
import { reconcileMatrixGenerationRunsAfterRestart } from './domains/content/matrix-generation/recovery.js';
import { drainBrandGenerationEffectOutbox } from './domains/brand/generation/effects.js';
import {
  BACKGROUND_JOB_TYPES,
  isSystemJobType,
  toPublicBackgroundJob,
  type BackgroundJobRecord,
} from '../shared/types/background-jobs.js';

// --- WebSocket state ---
const clients = new Set<WebSocket>();
const clientWorkspaces = new Map<WebSocket, Set<string>>();
const authenticatedClients = new Map<WebSocket, JwtPayload & { workspaceIds?: string[] }>();
const CLIENT_VISIBLE_JOB_TYPES = new Set<string>([
  BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION,
]);

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

interface JobSocketDelivery {
  data: BackgroundJobRecord | ReturnType<typeof toPublicBackgroundJob>;
  workspaceId?: string;
}

interface ResolveJobDeliveryArgs {
  job: BackgroundJobRecord;
  auth?: (JwtPayload & { workspaceIds?: string[] }) | null;
  subscribedWorkspaces?: Set<string>;
}

export function resolveSocketAuth(
  token: string,
): (JwtPayload & { workspaceIds?: string[] }) | null {
  const payload = verifyToken(token);
  if (payload) {
    const user = getUserById(payload.userId);
    return { ...payload, workspaceIds: user?.workspaceIds };
  }

  if (verifyAdminToken(token)) {
    return {
      userId: 'admin-hmac',
      email: 'admin@local',
      role: 'owner',
    };
  }

  return null;
}

export function resolveJobDelivery({
  job,
  auth,
  subscribedWorkspaces,
}: ResolveJobDeliveryArgs): JobSocketDelivery | null {
  if (auth) {
    if (!job.workspaceId) {
      return auth.role === 'owner'
        ? { data: job }
        : null;
    }

    const canAccessWorkspace = auth.role === 'owner'
      || Boolean(auth.workspaceIds?.includes(job.workspaceId));
    return canAccessWorkspace
      ? { data: job, workspaceId: job.workspaceId }
      : null;
  }

  // The allow-list opts a type IN to client delivery; isSystemJobType (derived from
  // BACKGROUND_JOB_METADATA[type].class) always wins on top of it — a cron-originated
  // job must never reach an unauthenticated client socket even if a future edit
  // mistakenly adds its type to CLIENT_VISIBLE_JOB_TYPES. Mirrors the same guard in
  // server/routes/jobs.ts isClientVisibleJob (REST /api/public/jobs).
  if (!job.workspaceId || !CLIENT_VISIBLE_JOB_TYPES.has(job.type) || isSystemJobType(job.type)) {
    return null;
  }

  if (!subscribedWorkspaces?.has(job.workspaceId)) {
    return null;
  }

  return {
    data: toPublicBackgroundJob(job),
    workspaceId: job.workspaceId,
  };
}

function resolveJobDeliveryForSocket(
  ws: WebSocket,
  job: BackgroundJobRecord,
): JobSocketDelivery | null {
  return resolveJobDelivery({
    job,
    auth: authenticatedClients.get(ws),
    subscribedWorkspaces: clientWorkspaces.get(ws),
  });
}

function _broadcastJobEvent(event: string, job: BackgroundJobRecord) {
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const delivery = resolveJobDeliveryForSocket(ws, job);
    if (!delivery) continue;
    ws.send(JSON.stringify({
      event,
      data: delivery.data,
      ...(delivery.workspaceId ? { workspaceId: delivery.workspaceId } : {}),
    }));
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
        if (msg.action === 'authenticate' && typeof msg.token === 'string') {
          const payload = resolveSocketAuth(msg.token);
          if (payload) {
            authenticatedClients.set(ws, payload);
            ws.send(JSON.stringify({ action: 'authenticated', ok: true }));
          } else {
            ws.send(JSON.stringify({ action: 'authenticated', ok: false }));
          }
        } else if (msg.action === 'subscribe' && typeof msg.workspaceId === 'string') {
          // If the client authenticated, enforce workspace access
          const auth = authenticatedClients.get(ws);
          if (auth && auth.role !== 'owner' && auth.workspaceIds && !auth.workspaceIds.includes(msg.workspaceId)) {
            ws.send(JSON.stringify({ error: 'Access denied' }));
            return;
          }
          // Allow unauthenticated clients (e.g. client portal users who auth via httpOnly cookies)
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
      authenticatedClients.delete(ws);
      if (hadPresence) broadcastPresenceUpdate();
    });
  });

  // Wire up the broadcast singleton so route files use these functions
  setBroadcast(_broadcast, _broadcastToWorkspace);

  // Initialise subsystems that depend on broadcast
  initJobs(_broadcastJobEvent);
  initActivityBroadcast(_broadcastToWorkspace);
  reconcileMatrixGenerationRunsAfterRestart();
  reconcileBrandGenerationRunsAfterRestart();
  drainBrandGenerationEffectOutbox();
  recoverStuckDiagnosticReports();
  initAnomalyBroadcast(_broadcastToWorkspace);
  initStripeBroadcast(_broadcastToWorkspace);
  // Skip file watchers in test environment — chokidar exhausts open file descriptor
  // limits when multiple test server subprocesses run concurrently (EMFILE errors).
  // SKIP_WATCHERS env var allows local dev to bypass when dirs have thousands of entries.
  if (process.env.NODE_ENV !== 'test' && !process.env.SKIP_WATCHERS) {
    startWatcher(_broadcast);
  }

  return wss;
}
