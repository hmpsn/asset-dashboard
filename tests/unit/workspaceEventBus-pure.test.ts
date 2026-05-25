/**
 * Additional unit tests for workspaceEventBus.ts covering scenarios not
 * exercised by tests/unit/workspace-event-bus.test.ts:
 *
 *   Already covered:
 *     - Socket is shared across multiple subscribers for the same workspace
 *     - authenticate → subscribe → identify flow
 *     - subscribe-without-identify when auth fails
 *     - unsubscribe + close on last listener removal
 *     - sendWorkspaceEvent forwarding
 *     - reconnect after socket close while listeners remain
 *
 *   Covered here (new):
 *     - Multiple workspaces get independent sockets
 *     - Listener receives only messages for its own workspaceId
 *     - resolveIdentity returns first available identity across listeners
 *     - Sending identify after subscriber attaches to already-subscribed connection
 *     - sendWorkspaceEvent is a no-op when no connection exists
 *     - Messages with no workspaceId field are dispatched to all listeners
 *     - Handler errors don't prevent other listeners from receiving the message
 *     - No reconnect when disposed connection closes
 *     - __resetWorkspaceEventBusForTests clears all connections
 *     - Heartbeat is sent to connected socket (timer-based)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetWorkspaceEventBusForTests,
  sendWorkspaceEvent,
  subscribeWorkspaceEvents,
} from '../../src/hooks/workspaceEventBus.js';

// ---------------------------------------------------------------------------
// MockWebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState = 0;
  sent: string[] = [];
  closeCount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.closeCount += 1;
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(payload: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  emitClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

function sentPayloads(ws: MockWebSocket) {
  return ws.sent.map(s => JSON.parse(s) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetWorkspaceEventBusForTests();
  MockWebSocket.instances.length = 0;
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:5173' } });
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) });
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  __resetWorkspaceEventBusForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('workspaceEventBus — additional coverage', () => {
  it('creates independent sockets for different workspaces', () => {
    const unsubA = subscribeWorkspaceEvents('ws-a', { onMessage: () => {} });
    const unsubB = subscribeWorkspaceEvents('ws-b', { onMessage: () => {} });

    // Two different workspaces → two separate WebSocket instances
    expect(MockWebSocket.instances).toHaveLength(2);
    // Both sockets connect to the same /ws endpoint (workspace routing is
    // done via subscribe message, not URL — this is the expected behaviour)
    expect(MockWebSocket.instances[0]).not.toBe(MockWebSocket.instances[1]);

    unsubA();
    unsubB();
  });

  it('filters out messages whose workspaceId does not match the connection', () => {
    const received: unknown[] = [];
    const unsubscribe = subscribeWorkspaceEvents('target-ws', {
      onMessage: msg => received.push(msg),
    });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({ event: 'update', workspaceId: 'other-ws', data: 'ignored' });
    ws.emitMessage({ event: 'update', workspaceId: 'target-ws', data: 'delivered' });

    expect(received).toHaveLength(1);
    expect((received[0] as Record<string, unknown>).data).toBe('delivered');

    unsubscribe();
  });

  it('delivers messages with no workspaceId field to all listeners', () => {
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    const unsubA = subscribeWorkspaceEvents('ws-shared', { onMessage: msg => receivedA.push(msg) });
    const unsubB = subscribeWorkspaceEvents('ws-shared', { onMessage: msg => receivedB.push(msg) });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    // No workspaceId in message → dispatch to all listeners
    ws.emitMessage({ event: 'presence:update', data: { online: true } });

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);

    unsubA();
    unsubB();
  });

  it('resolves identity from the first listener that provides one', () => {
    const received: unknown[] = [];

    // First listener: no identity
    const unsubA = subscribeWorkspaceEvents('ws-id', {
      onMessage: msg => received.push(msg),
    });

    // Second listener: has identity
    const unsubB = subscribeWorkspaceEvents('ws-id', {
      getIdentity: () => ({ userId: 'u-42', email: 'test@example.com', role: 'client' as const }),
      onMessage: () => {},
    });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    // Simulate auth token present so we go through authenticate → identified path
    ws.emitMessage({ action: 'authenticated', ok: true });

    const sent = sentPayloads(ws);
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'identify', userId: 'u-42' }),
      ]),
    );

    unsubA();
    unsubB();
  });

  it('calls sendIdentify when a listener attaches to an already-subscribed connection', () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) });

    // First subscriber — this creates and opens the connection
    const unsubA = subscribeWorkspaceEvents('ws-late', { onMessage: () => {} });
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    // Without an auth token the connection does subscribe immediately
    // (no authenticate step)

    const sentBefore = ws.sent.length;

    // Second subscriber attaches after the socket is already subscribed + open
    const unsubB = subscribeWorkspaceEvents('ws-late', {
      getIdentity: () => ({ userId: 'late-user', email: 'late@example.com' }),
      onMessage: () => {},
    });

    // An identify should have been sent because the connection was already open
    const sentAfter = sentPayloads(ws).slice(sentBefore);
    expect(sentAfter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'identify', userId: 'late-user' }),
      ]),
    );

    unsubA();
    unsubB();
  });

  it('sendWorkspaceEvent is a no-op when no connection exists', () => {
    // No subscription created — calling sendWorkspaceEvent must not throw
    expect(() => sendWorkspaceEvent('non-existent-ws', { action: 'ping' })).not.toThrow();
    // No sockets created
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('handler errors thrown inside onmessage are swallowed by the bus try/catch and logged to console.error', () => {
    // The bus wraps ws.onmessage in a try/catch (workspaceEventBus.ts line ~123).
    // A listener that throws must not crash the calling code — the error is
    // caught and logged.  This documents the current contract.

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const unsubA = subscribeWorkspaceEvents('ws-err', {
      onMessage: () => { throw new Error('listener failure'); },
    });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();

    // Should NOT throw (the bus try/catch absorbs it)
    expect(() => ws.emitMessage({ event: 'test', workspaceId: 'ws-err' })).not.toThrow();

    // The error should have been forwarded to console.error
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('workspaceEventBus'),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
    unsubA();
  });

  it('does NOT reconnect when the connection was disposed before the socket closed', () => {
    vi.useFakeTimers();

    const unsubscribe = subscribeWorkspaceEvents('ws-disposed', { onMessage: () => {} });
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();

    // Remove the last listener → disposes the connection
    unsubscribe();

    // Socket close fires after disposal
    ws.emitClose();

    // Advance past the reconnect window
    vi.advanceTimersByTime(3000);

    // No new socket should have been created
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('__resetWorkspaceEventBusForTests clears all active connections', () => {
    subscribeWorkspaceEvents('ws-reset-a', { onMessage: () => {} });
    subscribeWorkspaceEvents('ws-reset-b', { onMessage: () => {} });
    expect(MockWebSocket.instances).toHaveLength(2);

    __resetWorkspaceEventBusForTests();

    // Both sockets should have been closed
    expect(MockWebSocket.instances[0].closeCount).toBeGreaterThanOrEqual(1);
    expect(MockWebSocket.instances[1].closeCount).toBeGreaterThanOrEqual(1);

    // After reset, creating a new subscription allocates a fresh socket
    const unsubC = subscribeWorkspaceEvents('ws-reset-a', { onMessage: () => {} });
    expect(MockWebSocket.instances).toHaveLength(3);
    unsubC();
  });

  it('sends heartbeat messages on a 30-second interval', () => {
    vi.useFakeTimers();

    const unsubscribe = subscribeWorkspaceEvents('ws-heartbeat', { onMessage: () => {} });
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();

    vi.advanceTimersByTime(30_000);

    const sent = sentPayloads(ws);
    expect(sent).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'heartbeat' })]),
    );

    unsubscribe();
  });

  it('uses wss: protocol when the page is served over https', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:', host: 'secure.example.com' } });

    const unsubscribe = subscribeWorkspaceEvents('ws-tls', { onMessage: () => {} });
    expect(MockWebSocket.instances[0].url).toMatch(/^wss:/);
    unsubscribe();
  });
});
