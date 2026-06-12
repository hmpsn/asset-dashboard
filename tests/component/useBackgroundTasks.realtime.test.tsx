import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client', () => ({
  ApiError: class ApiError extends Error {},
  del: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../../src/hooks/workspaceEventBus', () => ({
  subscribeWorkspaceEvents: vi.fn(() => vi.fn()),
}));

import { get } from '../../src/api/client';
import { BackgroundTaskProvider, useBackgroundTasks } from '../../src/hooks/useBackgroundTasks';
import { subscribeWorkspaceEvents } from '../../src/hooks/workspaceEventBus';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs';
import { WS_EVENTS } from '../../src/lib/wsEvents';

const mockGet = vi.mocked(get);
const mockSubscribeWorkspaceEvents = vi.mocked(subscribeWorkspaceEvents);

const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static OPEN = 1;

  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(public readonly url: string) {
    sockets.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.onclose?.();
  }

  emitOpen() {
    this.onopen?.();
  }

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function makeWrapper(props: React.ComponentProps<typeof BackgroundTaskProvider>) {
  return ({ children }: { children: React.ReactNode }) => (
    <BackgroundTaskProvider {...props}>{children}</BackgroundTaskProvider>
  );
}

describe('BackgroundTaskProvider realtime wiring', () => {
  beforeEach(() => {
    vi.useRealTimers();
    sockets.length = 0;
    localStorage.clear();
    mockGet.mockReset();
    mockSubscribeWorkspaceEvents.mockReset();
    mockSubscribeWorkspaceEvents.mockReturnValue(vi.fn());
    mockGet.mockResolvedValue([]);
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  it('uses a subscribe-only workspace socket in public mode so client routes stay scrubbed but live', async () => {
    localStorage.setItem('auth_token', 'admin-hmac-token');
    const wrapper = makeWrapper({ workspaceId: 'ws-public', publicMode: true });
    const { result } = renderHook(() => useBackgroundTasks(), { wrapper });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/public/jobs/ws-public');
    });

    expect(mockSubscribeWorkspaceEvents).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(1);

    act(() => {
      sockets[0].emitOpen();
    });

    expect(sockets[0].sent.map(payload => JSON.parse(payload))).toEqual([
      { action: 'subscribe', workspaceId: 'ws-public' },
    ]);

    act(() => {
      sockets[0].emitMessage({
        event: WS_EVENTS.JOB_CREATED,
        data: {
          id: 'job-public-1',
          type: BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION,
          status: 'running',
          message: 'Generating recommendations...',
          createdAt: '2026-06-08T20:00:00.000Z',
          updatedAt: '2026-06-08T20:00:01.000Z',
          workspaceId: 'ws-public',
        },
      });
    });

    await waitFor(() => {
      expect(result.current.jobs).toHaveLength(1);
      expect(result.current.jobs[0]).toMatchObject({
        id: 'job-public-1',
        workspaceId: 'ws-public',
      });
    });
  });

  it('keeps admin workspace routes on the shared workspace event bus', async () => {
    const unsubscribe = vi.fn();
    mockSubscribeWorkspaceEvents.mockReturnValue(unsubscribe);
    const wrapper = makeWrapper({ workspaceId: 'ws-admin' });

    renderHook(() => useBackgroundTasks(), { wrapper });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/jobs?workspaceId=ws-admin');
    });

    expect(mockSubscribeWorkspaceEvents).toHaveBeenCalledWith(
      'ws-admin',
      expect.objectContaining({ onMessage: expect.any(Function) }),
    );
    expect(sockets).toHaveLength(0);
  });

  it('rehydrates active admin workspace jobs if a terminal websocket event is missed', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/api/jobs?workspaceId=ws-admin') {
        return [{
          id: 'job-admin-1',
          type: BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION,
          status: 'running',
          message: 'Generating schema plan...',
          createdAt: '2026-06-08T20:00:00.000Z',
          updatedAt: '2026-06-08T20:00:01.000Z',
          workspaceId: 'ws-admin',
        }];
      }
      if (url === '/api/jobs/job-admin-1') {
        return {
          id: 'job-admin-1',
          type: BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION,
          status: 'done',
          message: 'Schema plan ready',
          createdAt: '2026-06-08T20:00:00.000Z',
          updatedAt: '2026-06-08T20:00:03.000Z',
          workspaceId: 'ws-admin',
        };
      }
      return [];
    });

    const wrapper = makeWrapper({ workspaceId: 'ws-admin' });
    const { result } = renderHook(() => useBackgroundTasks(), { wrapper });

    await waitFor(() => {
      expect(result.current.jobs[0]).toMatchObject({
        id: 'job-admin-1',
        status: 'running',
      });
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 2100));
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/jobs/job-admin-1');
      expect(result.current.jobs[0]).toMatchObject({
        id: 'job-admin-1',
        status: 'done',
      });
    });
  });
});
