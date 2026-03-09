import { useEffect, useRef, useCallback } from 'react';

type EventHandler = (data: unknown) => void;

/**
 * Subscribe to workspace-scoped WebSocket events.
 * Sends subscribe/unsubscribe messages so the server only pushes relevant events.
 * Handlers are keyed by event name (e.g. 'activity:new', 'approval:update').
 */
export function useWorkspaceEvents(
  workspaceId: string | undefined,
  handlers: Record<string, EventHandler>,
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

  useEffect(() => {
    if (!workspaceId) return;
    let disposed = false;

    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => {
        // Subscribe to the workspace
        ws.send(JSON.stringify({ action: 'subscribe', workspaceId }));
        currentSubRef.current = workspaceId;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Only process messages for this workspace (or global events without workspaceId)
          if (msg.workspaceId && msg.workspaceId !== workspaceId) return;
          const handler = handlersRef.current[msg.event];
          if (handler) handler(msg.data);
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        currentSubRef.current = undefined;
        if (!disposed) {
          reconnectTimer.current = setTimeout(connect, 2000);
        }
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      disposed = true;
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
