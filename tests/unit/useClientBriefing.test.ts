// tests/unit/useClientBriefing.test.ts
//
// Verifies the `enabled` gate on `useClientBriefing(workspaceId, enabled)` —
// when false (free-tier), the hook MUST NOT call the public endpoint, since
// the server returns 402 for free workspaces. Plan T2.13 explicitly called
// for this test.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('../../src/api/briefing', () => ({
  briefingApi: {
    getPublished: vi.fn(),
  },
}));

import { briefingApi } from '../../src/api/briefing';
import { useClientBriefing } from '../../src/hooks/client/useClientBriefing';

const mockGetPublished = vi.mocked(briefingApi.getPublished);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useClientBriefing', () => {
  beforeEach(() => {
    mockGetPublished.mockReset();
  });

  it('does NOT call the public endpoint when `enabled=false` (free tier)', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useClientBriefing('ws_test', false), { wrapper });

    // Give React Query a tick to schedule (or not).
    await new Promise((r) => setTimeout(r, 50));
    expect(mockGetPublished).not.toHaveBeenCalled();
    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('does NOT call the public endpoint when workspaceId is empty', async () => {
    const wrapper = createWrapper();
    renderHook(() => useClientBriefing('', true), { wrapper });

    await new Promise((r) => setTimeout(r, 50));
    expect(mockGetPublished).not.toHaveBeenCalled();
  });

  it('calls getPublished when both `enabled=true` and workspaceId is set', async () => {
    mockGetPublished.mockResolvedValueOnce(null);
    const wrapper = createWrapper();
    const { result } = renderHook(() => useClientBriefing('ws_test', true), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(mockGetPublished).toHaveBeenCalledWith('ws_test');
  });
});
