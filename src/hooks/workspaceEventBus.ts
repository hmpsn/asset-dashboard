export interface WsIdentity {
  userId: string;
  email: string;
  name?: string;
  role?: 'client' | 'admin';
}

type RawWsMessage = {
  action?: string;
  ok?: boolean;
  event?: string;
  data?: unknown;
  workspaceId?: string;
};

interface WorkspaceEventListener {
  onMessage: (msg: RawWsMessage) => void;
  getIdentity?: () => WsIdentity | undefined;
}

interface WorkspaceEventConnection {
  workspaceId: string;
  ws: WebSocket | null;
  listeners: Set<WorkspaceEventListener>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  disposed: boolean;
  subscribed: boolean;
}

const workspaceConnections = new Map<string, WorkspaceEventConnection>();

function createWorkspaceConnection(workspaceId: string): WorkspaceEventConnection {
  return {
    workspaceId,
    ws: null,
    listeners: new Set(),
    disposed: false,
    subscribed: false,
  };
}

function sendJson(conn: WorkspaceEventConnection, msg: Record<string, unknown>) {
  if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) return;
  conn.ws.send(JSON.stringify(msg));
}

function resolveIdentity(conn: WorkspaceEventConnection): WsIdentity | undefined {
  for (const listener of conn.listeners) {
    const identity = listener.getIdentity?.();
    if (identity) return identity;
  }
  return undefined;
}

function sendSubscribe(conn: WorkspaceEventConnection) {
  sendJson(conn, { action: 'subscribe', workspaceId: conn.workspaceId });
  conn.subscribed = true;
}

function sendIdentify(conn: WorkspaceEventConnection) {
  const identity = resolveIdentity(conn);
  if (identity) {
    sendJson(conn, { action: 'identify', workspaceId: conn.workspaceId, ...identity });
  }
}

function dispatchMessage(conn: WorkspaceEventConnection, msg: RawWsMessage) {
  if (msg.workspaceId && msg.workspaceId !== conn.workspaceId) return;
  for (const listener of conn.listeners) listener.onMessage(msg);
}

function cleanupTimers(conn: WorkspaceEventConnection) {
  clearTimeout(conn.reconnectTimer);
  clearInterval(conn.heartbeatTimer);
}

function closeAndDeleteConnection(conn: WorkspaceEventConnection) {
  conn.disposed = true;
  cleanupTimers(conn);
  if (conn.subscribed) {
    sendJson(conn, { action: 'unsubscribe', workspaceId: conn.workspaceId });
  }
  conn.subscribed = false;
  if (conn.ws) {
    conn.ws.close();
    conn.ws = null;
  }
  workspaceConnections.delete(conn.workspaceId);
}

function connect(conn: WorkspaceEventConnection) {
  if (conn.disposed) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  conn.ws = ws;

  ws.onopen = () => {
    conn.subscribed = false;
    const authToken = localStorage.getItem('auth_token');
    if (authToken) {
      sendJson(conn, { action: 'authenticate', token: authToken });
    } else {
      sendSubscribe(conn);
      sendIdentify(conn);
    }
    clearInterval(conn.heartbeatTimer);
    conn.heartbeatTimer = setInterval(() => {
      sendJson(conn, { action: 'heartbeat' });
    }, 30_000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as RawWsMessage;
      if (msg.action === 'authenticated') {
        sendSubscribe(conn);
        if (msg.ok) {
          sendIdentify(conn);
        }
        return;
      }
      dispatchMessage(conn, msg);
    } catch (err) {
      console.error('workspaceEventBus operation failed:', err);
    }
  };

  ws.onclose = () => {
    conn.subscribed = false;
    clearInterval(conn.heartbeatTimer);
    if (conn.disposed || conn.listeners.size === 0) return;
    conn.reconnectTimer = setTimeout(() => connect(conn), 2000);
  };
}

function ensureConnection(workspaceId: string): WorkspaceEventConnection {
  let conn = workspaceConnections.get(workspaceId);
  if (!conn) {
    conn = createWorkspaceConnection(workspaceId);
    workspaceConnections.set(workspaceId, conn);
    connect(conn);
  }
  return conn;
}

export function subscribeWorkspaceEvents(
  workspaceId: string,
  listener: WorkspaceEventListener,
): () => void {
  const conn = ensureConnection(workspaceId);
  conn.listeners.add(listener);

  if (conn.subscribed && conn.ws?.readyState === WebSocket.OPEN) {
    sendIdentify(conn);
  }

  return () => {
    conn.listeners.delete(listener);
    if (conn.listeners.size > 0) return;
    closeAndDeleteConnection(conn);
  };
}

export function sendWorkspaceEvent(workspaceId: string, msg: Record<string, unknown>) {
  const conn = workspaceConnections.get(workspaceId);
  if (!conn) return;
  sendJson(conn, msg);
}

export function __resetWorkspaceEventBusForTests() {
  for (const conn of Array.from(workspaceConnections.values())) {
    closeAndDeleteConnection(conn);
  }
  workspaceConnections.clear();
}
