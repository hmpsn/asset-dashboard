/**
 * Tests for useWorkspaceBadges hook (W1.6 — badge stale fix).
 *
 * Verifies:
 *  (a) badge count comes from the React Query cache via useWorkspaceBadges
 *  (b) CONTENT_REQUEST_CREATED / _UPDATE events invalidate the workspace-badges key
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWorkspaceBadges } from '../../src/hooks/admin/useWorkspaceBadges';
import { useWsInvalidation } from '../../src/hooks/useWsInvalidation';
import { queryKeys } from '../../src/lib/queryKeys';
import { WS_EVENTS } from '../../src/lib/wsEvents';

// ── Mock workspaceBadges API ────────────────────────────────────────────────
const getBadgesMock = vi.fn();

vi.mock('../../src/api/platform', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/platform')>('../../src/api/platform');
  return {
    ...actual,
    workspaceBadges: { get: (...args: unknown[]) => getBadgesMock(...args) },
  };
});

// ── WS event capture for useWsInvalidation tests ───────────────────────────
let capturedHandlers: Record<string, (data?: unknown) => void> = {};

vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (_wsId: string | undefined, handlers: Record<string, (d?: unknown) => void>) => {
    capturedHandlers = handlers;
  },
}));

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useWorkspaceBadges', () => {
  beforeEach(() => {
    getBadgesMock.mockReset();
    capturedHandlers = {};
  });

  it('returns pendingRequests from the API response', async () => {
    getBadgesMock.mockResolvedValue({ pendingRequests: 3, hasContent: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useWorkspaceBadges('ws-test'), {
      wrapper: wrapper(client),
    });

    // Wait for query to settle
    await act(async () => {
      await new Promise(res => setTimeout(res, 50));
    });

    expect(getBadgesMock).toHaveBeenCalledWith('ws-test');
    expect(result.current.data?.pendingRequests).toBe(3);
  });

  it('is disabled when workspaceId is undefined', () => {
    getBadgesMock.mockResolvedValue({ pendingRequests: 0, hasContent: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(() => useWorkspaceBadges(undefined), { wrapper: wrapper(client) });

    expect(getBadgesMock).not.toHaveBeenCalled();
  });
});

describe('useWsInvalidation — workspace-badges key', () => {
  beforeEach(() => {
    capturedHandlers = {};
  });

  it('CONTENT_REQUEST_CREATED invalidates workspace-badges key', () => {
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const workspaceId = 'ws-badges-test';

    renderHook(() => useWsInvalidation(workspaceId), { wrapper: wrapper(client) });

    act(() => {
      capturedHandlers[WS_EVENTS.CONTENT_REQUEST_CREATED]?.();
    });

    const invalidatedKeys = invalidateSpy.mock.calls
      .map(([arg]) => (arg as { queryKey?: readonly unknown[] }).queryKey)
      .filter((k): k is readonly unknown[] => Array.isArray(k));

    expect(invalidatedKeys).toContainEqual(queryKeys.admin.workspaceBadges(workspaceId));
  });

  it('CONTENT_REQUEST_UPDATE invalidates workspace-badges key', () => {
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const workspaceId = 'ws-badges-test-2';

    renderHook(() => useWsInvalidation(workspaceId), { wrapper: wrapper(client) });

    act(() => {
      capturedHandlers[WS_EVENTS.CONTENT_REQUEST_UPDATE]?.();
    });

    const invalidatedKeys = invalidateSpy.mock.calls
      .map(([arg]) => (arg as { queryKey?: readonly unknown[] }).queryKey)
      .filter((k): k is readonly unknown[] => Array.isArray(k));

    expect(invalidatedKeys).toContainEqual(queryKeys.admin.workspaceBadges(workspaceId));
  });
});
