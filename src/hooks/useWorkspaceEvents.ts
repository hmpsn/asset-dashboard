import { useEffect, useRef, useCallback } from 'react';

type EventHandler = (data: unknown) => void;

export interface WsIdentity {
  userId: string;
  email: string;
  name?: string;
  role?: 'client' | 'admin';
}

/**
 * Subscribe to workspace-scoped WebSocket events.
 * Sends subscribe/unsubscribe messages so the server only pushes relevant events.
 * Handlers are keyed by event name (e.g. 'activity:new', 'approval:update').
 * Pass `identity` to register presence tracking for the connected user.
 */
export function useWorkspaceEvents(
  workspaceId: string | undefined,
  handlers: Record<string, EventHandler>,
  identity?: WsIdentity,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Record<string, EventHandler>>(handlers);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const currentSubRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  // Helper to send JSON if socket is open
  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const identityRef = useRef(identity);
  useEffect(() => { identityRef.current = identity; }, [identity]);

  useEffect(() => {
    if (!workspaceId) return;
    let disposed = false;
    let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => {
        // Authenticate with JWT token before subscribing
        const authToken = localStorage.getItem('auth_token');
        if (authToken) {
          ws.send(JSON.stringify({ action: 'authenticate', token: authToken }));
          // subscribe will be sent after 'authenticated' response in onmessage
        } else {
          // No auth token — subscribe immediately (legacy/public behavior)
          ws.send(JSON.stringify({ action: 'subscribe', workspaceId }));
          currentSubRef.current = workspaceId;
          const id = identityRef.current;
          if (id) {
            ws.send(JSON.stringify({ action: 'identify', workspaceId, ...id }));
          }
        }
        // Heartbeat every 30s to keep presence alive
        clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'heartbeat' }));
          }
        }, 30_000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Handle authentication response — subscribe after confirmed
          if (msg.action === 'authenticated') {
            if (msg.ok) {
              ws.send(JSON.stringify({ action: 'subscribe', workspaceId }));
              currentSubRef.current = workspaceId;
              const id = identityRef.current;
              if (id) {
                ws.send(JSON.stringify({ action: 'identify', workspaceId, ...id }));
              }
            } else {
              // Auth failed (expired/invalid token) — subscribe without auth (fallback)
              ws.send(JSON.stringify({ action: 'subscribe', workspaceId }));
              currentSubRef.current = workspaceId;
            }
            return;
          }
          // Only process messages for this workspace (or global events without workspaceId)
          if (msg.workspaceId && msg.workspaceId !== workspaceId) return;
          const handler = handlersRef.current[msg.event];
          if (handler) handler(msg.data);
        } catch (err) { console.error('useWorkspaceEvents operation failed:', err); }
      };

      ws.onclose = () => {
        currentSubRef.current = undefined;
        clearInterval(heartbeatInterval);
        if (!disposed) {
          reconnectTimer.current = setTimeout(connect, 2000);
        }
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      disposed = true;
      clearInterval(heartbeatInterval);
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        // Unsubscribe before closing
        if (currentSubRef.current) {
          send({ action: 'unsubscribe', workspaceId: currentSubRef.current });
        }
        wsRef.current.close();
        wsRef.current = null;
      }
      currentSubRef.current = undefined;
    };
  }, [workspaceId, send]);

  return { send };
}
