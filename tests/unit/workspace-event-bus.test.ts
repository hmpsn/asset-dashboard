import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetWorkspaceEventBusForTests,
  sendWorkspaceEvent,
  subscribeWorkspaceEvents,
} from '../../src/hooks/workspaceEventBus';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;

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
    this.readyState = 3;
    this.onclose?.();
  }
}

function sentPayloads(ws: MockWebSocket) {
  return ws.sent.map(payload => JSON.parse(payload) as Record<string, unknown>);
}

describe('workspaceEventBus', () => {
  beforeEach(() => {
    __resetWorkspaceEventBusForTests();
    MockWebSocket.instances.length = 0;
    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: 'localhost:5173' },
    });
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
    });
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    __resetWorkspaceEventBusForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shares one socket per workspace across multiple subscribers', () => {
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];

    const unsubscribeA = subscribeWorkspaceEvents('ws-1', {
      onMessage: (msg) => seenA.push(msg),
    });
    const unsubscribeB = subscribeWorkspaceEvents('ws-1', {
      onMessage: (msg) => seenB.push(msg),
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({ event: 'activity:new', workspaceId: 'ws-1', data: { ok: true } });
    ws.emitMessage({ event: 'activity:new', workspaceId: 'ws-2', data: { ignored: true } });

    expect(seenA).toHaveLength(1);
    expect(seenB).toHaveLength(1);

    unsubscribeA();
    expect(ws.closeCount).toBe(0);
    unsubscribeB();
    expect(ws.closeCount).toBe(1);
  });

  it('authenticates then subscribes and identifies when identity exists', () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'token-1') });

    const unsubscribe = subscribeWorkspaceEvents('ws-auth', {
      getIdentity: () => ({ userId: 'u1', email: 'u1@example.com', role: 'admin' }),
      onMessage: () => {},
    });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({ action: 'authenticated', ok: true });

    const sent = sentPayloads(ws);
    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'authenticate', token: 'token-1' }),
      expect.objectContaining({ action: 'subscribe', workspaceId: 'ws-auth' }),
      expect.objectContaining({ action: 'identify', workspaceId: 'ws-auth', userId: 'u1' }),
    ]));

    unsubscribe();
  });

  it('subscribes without identify when token auth fails', () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'expired-token') });

    const unsubscribe = subscribeWorkspaceEvents('ws-auth-fail', {
      getIdentity: () => ({ userId: 'u2', email: 'u2@example.com', role: 'admin' }),
      onMessage: () => {},
    });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({ action: 'authenticated', ok: false });

    const sent = sentPayloads(ws);
    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'authenticate', token: 'expired-token' }),
      expect.objectContaining({ action: 'subscribe', workspaceId: 'ws-auth-fail' }),
    ]));
    expect(sent).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'identify', workspaceId: 'ws-auth-fail', userId: 'u2' }),
    ]));

    unsubscribe();
  });

  it('sends unsubscribe before closing final workspace connection', () => {
    const unsubscribe = subscribeWorkspaceEvents('ws-close', {
      onMessage: () => {},
    });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    unsubscribe();

    const sent = sentPayloads(ws);
    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'unsubscribe', workspaceId: 'ws-close' }),
    ]));
    expect(ws.closeCount).toBe(1);
  });

  it('forwards sendWorkspaceEvent payloads through open workspace connection', () => {
    const unsubscribe = subscribeWorkspaceEvents('ws-send', {
      onMessage: () => {},
    });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    sendWorkspaceEvent('ws-send', { action: 'ping', value: 1 });

    const sent = sentPayloads(ws);
    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'ping', value: 1 }),
    ]));

    unsubscribe();
  });

  it('reconnects after close while listeners remain', () => {
    vi.useFakeTimers();
    const unsubscribe = subscribeWorkspaceEvents('ws-reconnect', {
      onMessage: () => {},
    });
    const first = MockWebSocket.instances[0];
    first.emitOpen();
    first.emitClose();

    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(2);

    unsubscribe();
  });
});
