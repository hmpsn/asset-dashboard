// tests/component/KeywordCommandCenter-ws-invalidation.test.tsx
//
// CONTRACT: broadcast events that KCC depends on are covered centrally.
//
// KeywordCommandCenter has no inline useWorkspaceEvents wiring (correct — adding
// it would duplicate the central map and trigger the pr-check
// "useWorkspaceEvents handler for centralized event" rule).
//
// Instead, three broadcasts that change KCC data are handled by
// useWsInvalidation (mounted in the App ancestor whenever an admin workspace
// is open): RANK_TRACKING_UPDATED, STRATEGY_UPDATED, and
// INTELLIGENCE_SIGNALS_UPDATED. Each must invalidate `queryKeys.admin.keywordCommandCenter(wsId)`
// (the prefix key) — that single invalidation covers the summary, rows, and
// detail sub-keys via React Query prefix matching.
//
// These tests pin that contract so a future wsInvalidation refactor cannot
// silently drop KCC coverage.

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWsInvalidation } from '../../src/hooks/useWsInvalidation';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation';
import { WS_EVENTS } from '../../src/lib/wsEvents';
import { queryKeys } from '../../src/lib/queryKeys';

const WS_ID = 'ws-kcc-test';

// ---------------------------------------------------------------------------
// Static registry tests (no mocking needed — test the pure mapping functions)
// ---------------------------------------------------------------------------

describe('KeywordCommandCenter — WS invalidation contract (static registry)', () => {
  it('RANK_TRACKING_UPDATED (admin scope) invalidates the KCC prefix key', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.RANK_TRACKING_UPDATED, WS_ID, undefined, 'admin');
    expect(keys).toContainEqual(queryKeys.admin.keywordCommandCenter(WS_ID));
  });

  it('STRATEGY_UPDATED (admin scope) invalidates the KCC prefix key', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.STRATEGY_UPDATED, WS_ID, undefined, 'admin');
    expect(keys).toContainEqual(queryKeys.admin.keywordCommandCenter(WS_ID));
  });

  it('INTELLIGENCE_SIGNALS_UPDATED (admin scope) invalidates the KCC prefix key', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED, WS_ID, undefined, 'admin');
    expect(keys).toContainEqual(queryKeys.admin.keywordCommandCenter(WS_ID));
  });

  it('KCC prefix key is a proper prefix of the summary, rows, and detail sub-keys', () => {
    // React Query matches all keys whose start equals the invalidation prefix.
    // If the prefix is ['admin-keyword-command-center', wsId], then summary
    // ['admin-keyword-command-center', wsId, 'summary'] is invalidated too.
    const prefix = queryKeys.admin.keywordCommandCenter(WS_ID);
    const summaryKey = queryKeys.admin.keywordCommandCenterSummary(WS_ID);
    const rowsKey = queryKeys.admin.keywordCommandCenterRows(WS_ID, { page: 1 });
    const detailKey = queryKeys.admin.keywordCommandCenterDetail(WS_ID, 'example keyword');

    // All sub-keys must start with the prefix
    expect(summaryKey.slice(0, prefix.length)).toEqual([...prefix]);
    expect(rowsKey.slice(0, prefix.length)).toEqual([...prefix]);
    expect(detailKey.slice(0, prefix.length)).toEqual([...prefix]);
  });
});

// ---------------------------------------------------------------------------
// Runtime tests — verify useWsInvalidation dispatches the KCC invalidation
// calls when the three relevant events fire
// ---------------------------------------------------------------------------

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

describe('KeywordCommandCenter — WS invalidation contract (runtime hook)', () => {
  beforeEach(() => {
    capturedHandlers = {};
  });

  it('useWsInvalidation registers RANK_TRACKING_UPDATED and it invalidates the KCC prefix', () => {
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useWsInvalidation(WS_ID), { wrapper: createWrapper(client) });

    expect(capturedHandlers[WS_EVENTS.RANK_TRACKING_UPDATED]).toBeDefined();

    act(() => {
      capturedHandlers[WS_EVENTS.RANK_TRACKING_UPDATED]?.();
    });

    const invalidatedKeys = invalidateSpy.mock.calls
      .map(([arg]) => (arg as { queryKey?: readonly unknown[] }).queryKey)
      .filter((key): key is readonly unknown[] => Array.isArray(key));

    expect(invalidatedKeys).toContainEqual(queryKeys.admin.keywordCommandCenter(WS_ID));
  });

  it('useWsInvalidation registers STRATEGY_UPDATED and it invalidates the KCC prefix', () => {
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useWsInvalidation(WS_ID), { wrapper: createWrapper(client) });

    expect(capturedHandlers[WS_EVENTS.STRATEGY_UPDATED]).toBeDefined();

    act(() => {
      capturedHandlers[WS_EVENTS.STRATEGY_UPDATED]?.();
    });

    const invalidatedKeys = invalidateSpy.mock.calls
      .map(([arg]) => (arg as { queryKey?: readonly unknown[] }).queryKey)
      .filter((key): key is readonly unknown[] => Array.isArray(key));

    expect(invalidatedKeys).toContainEqual(queryKeys.admin.keywordCommandCenter(WS_ID));
  });

  it('useWsInvalidation registers INTELLIGENCE_SIGNALS_UPDATED and it invalidates the KCC prefix', () => {
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useWsInvalidation(WS_ID), { wrapper: createWrapper(client) });

    expect(capturedHandlers[WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED]).toBeDefined();

    act(() => {
      capturedHandlers[WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED]?.();
    });

    const invalidatedKeys = invalidateSpy.mock.calls
      .map(([arg]) => (arg as { queryKey?: readonly unknown[] }).queryKey)
      .filter((key): key is readonly unknown[] => Array.isArray(key));

    expect(invalidatedKeys).toContainEqual(queryKeys.admin.keywordCommandCenter(WS_ID));
  });
});
