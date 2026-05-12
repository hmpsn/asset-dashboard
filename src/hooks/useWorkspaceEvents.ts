import { useEffect, useRef, useCallback } from 'react';
import type { WsIdentity } from './workspaceEventBus';
import { sendWorkspaceEvent, subscribeWorkspaceEvents } from './workspaceEventBus';

type EventHandler = (data: unknown) => void;

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
  const handlersRef = useRef<Record<string, EventHandler>>(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  // Helper to send JSON if the shared workspace socket is open
  const send = useCallback((msg: Record<string, unknown>) => {
    if (!workspaceId) return;
    sendWorkspaceEvent(workspaceId, msg);
  }, [workspaceId]);

  const identityRef = useRef(identity);
  useEffect(() => { identityRef.current = identity; }, [identity]);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeWorkspaceEvents(workspaceId, {
      getIdentity: () => identityRef.current,
      onMessage: (msg) => {
        const eventName = msg.event;
        if (!eventName) return;
        const handler = handlersRef.current[eventName];
        if (handler) handler(msg.data);
      },
    });
  }, [workspaceId]);

  return { send };
}
