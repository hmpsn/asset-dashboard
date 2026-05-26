import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWsInvalidation } from '../../src/hooks/useWsInvalidation.js';
import { WS_EVENTS } from '../../src/lib/wsEvents.js';
import { queryKeys } from '../../src/lib/queryKeys.js';

let capturedHandlers: Record<string, (data?: unknown) => void> = {};

vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (_workspaceId: string | undefined, handlers: Record<string, (data?: unknown) => void>) => {
    capturedHandlers = handlers;
  },
}));

function createWrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useWsInvalidation (runtime)', () => {
  beforeEach(() => {
    capturedHandlers = {};
  });

  it('registers a large centralized handler map from WS events', () => {
    const client = new QueryClient();
    renderHook(() => useWsInvalidation('ws-runtime'), { wrapper: createWrapper(client) });

    const registered = Object.keys(capturedHandlers);
    expect(registered.length).toBeGreaterThan(45);
    expect(registered).toContain(WS_EVENTS.DIAGNOSTIC_COMPLETE);
    expect(registered).toContain(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED);
    expect(registered).toContain(WS_EVENTS.POST_UPDATED);
  });

  it('short-circuits all workspace-scoped handlers when workspaceId is undefined', () => {
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useWsInvalidation(undefined), { wrapper: createWrapper(client) });

    act(() => {
      for (const handler of Object.values(capturedHandlers)) {
        handler({});
      }
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('executes real handler callbacks and invalidates expected cache keys', () => {
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const workspaceId = 'ws-runtime';

    renderHook(() => useWsInvalidation(workspaceId), { wrapper: createWrapper(client) });

    act(() => {
      for (const handler of Object.values(capturedHandlers)) {
        handler({ siteId: 'site-42', postId: 'post-99' });
      }
      // Exercise no-siteId guard branch.
      capturedHandlers[WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED]?.({});
    });

    const invalidatedKeys = invalidateSpy.mock.calls
      .map(([arg]) => (arg as { queryKey?: readonly unknown[] }).queryKey)
      .filter((key): key is readonly unknown[] => Array.isArray(key));

    expect(invalidatedKeys).toContainEqual(queryKeys.admin.insightFeed(workspaceId));
    expect(invalidatedKeys).toContainEqual(queryKeys.admin.schemaCmsFieldMappings('site-42'));
    expect(invalidatedKeys).toContainEqual(queryKeys.admin.post(workspaceId, 'post-99'));
    expect(invalidatedKeys).toContainEqual(queryKeys.client.briefing(workspaceId));
    expect(invalidatedKeys).toContainEqual(queryKeys.admin.notifications());
    expect(invalidatedKeys).toContainEqual(queryKeys.admin.keywordStrategy(workspaceId));
    expect(invalidatedKeys).toContainEqual(queryKeys.admin.rankTrackingLatest(workspaceId));

    // Ensure the known bad legacy key is never used.
    expect(invalidatedKeys).not.toContainEqual(['admin-insights', workspaceId]);

    // Smoke assertion that we exercised broad invalidation paths.
    expect(invalidatedKeys.length).toBeGreaterThan(120);
  });
});
