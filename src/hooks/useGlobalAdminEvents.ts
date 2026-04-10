import { useEffect, useRef } from 'react';

type EventHandler = (data: unknown) => void;

/**
 * Subscribe to GLOBAL, non-workspace-scoped WebSocket events — i.e. events
 * broadcast via `_broadcast()` (the all-connected-clients fan-out) rather
 * than `_broadcastToWorkspace()`. This is the right hook for:
 *   - `ADMIN_EVENTS.*` — queue updates, workspace created/deleted
 *   - `presence:update` — admin presence fan-out
 *
 * For ANY workspace-scoped event (e.g. `activity:new`, `brandscript:updated`,
 * `voice:updated`, `brand-identity:updated`) you MUST use `useWorkspaceEvents`
 * instead — this hook never sends a `subscribe` action, so the server's
 * `_broadcastToWorkspace` filter (`subs.has(workspaceId)`) will exclude your
 * connection and your handler will be dead code. That bug shipped to
 * production in PR #162 across four brand-engine tabs before being caught.
 *
 * The pr-check script enforces this contract: importing this hook from any
 * file other than the audited global-events sites is a build error.
 */
export function useGlobalAdminEvents(handlers: Record<string, EventHandler>) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Record<string, EventHandler>>(handlers);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    let disposed = false;

    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => {
        // Authenticate with JWT token
        const authToken = localStorage.getItem('auth_token');
        if (authToken) {
          ws.send(JSON.stringify({ action: 'authenticate', token: authToken }));
        }
        // Intentionally does NOT send a `subscribe` action — this hook is only
        // for global events delivered via `_broadcast()` (not
        // `_broadcastToWorkspace()`). See top-of-file comment.
      };

      ws.onmessage = (event) => {
        try {
          const { event: eventName, data } = JSON.parse(event.data);
          if (handlersRef.current[eventName]) {
            handlersRef.current[eventName](data);
          }
        } catch (err) {
          console.error('useGlobalAdminEvents operation failed:', err);
        }
      };

      ws.onclose = () => {
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
      wsRef.current?.close();
    };
  }, []);
}
