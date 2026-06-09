import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TrackedKeyword } from '../../../shared/types/rank-tracking';
import { queryKeys } from '../../../src/lib/queryKeys';
import { keywordTrackingKey } from '../../../src/lib/keywordTracking';

const { trackedKeywordsApi, rankTrackingApi } = vi.hoisted(() => ({
  trackedKeywordsApi: {
    get: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
  },
  rankTrackingApi: {
    keywords: vi.fn(),
    addKeyword: vi.fn(),
  },
}));

vi.mock('../../../src/api', () => ({
  trackedKeywords: trackedKeywordsApi,
}));

vi.mock('../../../src/api/seo', () => ({
  rankTracking: rankTrackingApi,
}));

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: vi.fn(),
}));

import { useStrategyTrackedKeywords } from '../../../src/components/client/strategy/useStrategyTrackedKeywords';
import { usePageIntelligenceKeywordTracking } from '../../../src/components/page-intelligence/usePageIntelligenceKeywordTracking';

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function makeTrackedKeyword(query: string): TrackedKeyword {
  return {
    query,
    pinned: false,
    addedAt: '2026-06-09T00:00:00.000Z',
    source: 'manual',
  };
}

describe('tracked keyword hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useStrategyTrackedKeywords reads and updates the client tracked-keywords cache', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    trackedKeywordsApi.get.mockResolvedValue({
      keywords: [makeTrackedKeyword('seo tips')],
    });
    trackedKeywordsApi.add.mockResolvedValue({
      keywords: [makeTrackedKeyword('seo tips'), makeTrackedKeyword('local seo')],
    });
    trackedKeywordsApi.remove.mockResolvedValue({
      keywords: [makeTrackedKeyword('local seo')],
    });

    const { result } = renderHook(
      () => useStrategyTrackedKeywords({ workspaceId: 'ws-1' }),
      { wrapper: makeWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.trackedKeywords.map(row => row.query)).toEqual(['seo tips']);
    });

    expect(queryClient.getQueryData(queryKeys.client.trackedKeywords('ws-1'))).toEqual({
      keywords: [makeTrackedKeyword('seo tips')],
    });

    await act(async () => {
      await result.current.addTrackedKeyword('local seo');
    });

    await waitFor(() => {
      expect(result.current.trackedKeywords.map(row => row.query)).toEqual(['seo tips', 'local seo']);
    });

    await act(async () => {
      await result.current.removeTrackedKeyword('seo tips');
    });

    await waitFor(() => {
      expect(result.current.trackedKeywords.map(row => row.query)).toEqual(['local seo']);
    });

    expect(queryClient.getQueryData(queryKeys.client.trackedKeywords('ws-1'))).toEqual({
      keywords: [makeTrackedKeyword('local seo')],
    });
  });

  it('usePageIntelligenceKeywordTracking exposes a Set while keeping the shared cache array-shaped', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    rankTrackingApi.keywords.mockResolvedValue([makeTrackedKeyword('seo tips')]);
    rankTrackingApi.addKeyword.mockResolvedValue({});

    const { result } = renderHook(
      () => usePageIntelligenceKeywordTracking('ws-1'),
      { wrapper: makeWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.trackedKeywords.has(keywordTrackingKey('seo tips'))).toBe(true);
    });

    const initialCache = queryClient.getQueryData(queryKeys.admin.rankTrackingKeywords('ws-1'));
    expect(Array.isArray(initialCache)).toBe(true);
    expect(initialCache instanceof Set).toBe(false);

    await act(async () => {
      await result.current.trackKeyword('local seo');
    });

    await waitFor(() => {
      expect(result.current.trackedKeywords.has(keywordTrackingKey('local seo'))).toBe(true);
    });

    const cache = queryClient.getQueryData<TrackedKeyword[]>(queryKeys.admin.rankTrackingKeywords('ws-1'));
    expect(Array.isArray(cache)).toBe(true);
    expect(cache?.map(row => row.query)).toEqual(['seo tips', 'local seo']);
  });
});
