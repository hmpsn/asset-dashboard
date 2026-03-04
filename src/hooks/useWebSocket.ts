import { useEffect, useRef } from 'react';

type EventHandler = (data: unknown) => void;

export function useWebSocket(handlers: Record<string, EventHandler>) {
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

      ws.onmessage = (event) => {
        try {
          const { event: eventName, data } = JSON.parse(event.data);
          if (handlersRef.current[eventName]) {
            handlersRef.current[eventName](data);
          }
        } catch { /* ignore parse errors */ }
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
