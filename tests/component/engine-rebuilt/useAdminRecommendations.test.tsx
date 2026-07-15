import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAdminUndismissRecommendation } from '../../../src/hooks/admin/useAdminRecommendations';
import { queryKeys } from '../../../src/lib/queryKeys';
import type { RecommendationSet } from '../../../shared/types/recommendations';

const workspaceId = 'ws-engine-history';

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useAdminUndismissRecommendation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes every Engine consumer after clearing dismissed status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'rec-1',
      workspaceId,
      status: 'pending',
      lifecycle: 'struck',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    const client = createClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () => useAdminUndismissRecommendation(workspaceId),
      { wrapper: wrapper(client) },
    );

    act(() => result.current.mutate('rec-1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.admin.recommendations(workspaceId) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.shared.recommendations(workspaceId) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.admin.intelligenceAll(workspaceId) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.admin.issueLenses(workspaceId) });
  });

  it('keeps the mutation pending until all five canonical invalidations finish', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'rec-1',
      workspaceId,
      status: 'pending',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    const client = createClient();
    client.setQueryData(queryKeys.admin.recommendations(workspaceId), {
      recommendations: [{ id: 'rec-1', workspaceId, status: 'dismissed', lifecycle: 'struck' }],
    } as unknown as RecommendationSet);
    const resolveInvalidations: Array<() => void> = [];
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockImplementation(() => (
      new Promise<void>((resolve) => resolveInvalidations.push(resolve))
    ));
    const { result } = renderHook(
      () => useAdminUndismissRecommendation(workspaceId),
      { wrapper: wrapper(client) },
    );

    act(() => result.current.mutate('rec-1'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(5));
    expect(client.getQueryData<RecommendationSet>(queryKeys.admin.recommendations(workspaceId))
      ?.recommendations[0]).toMatchObject({ status: 'pending', lifecycle: 'struck' });
    expect(result.current.isPending).toBe(true);
    expect(result.current.isSuccess).toBe(false);

    act(() => resolveInvalidations.slice(0, 4).forEach((resolve) => resolve()));
    await act(async () => Promise.resolve());
    expect(result.current.isPending).toBe(true);

    act(() => resolveInvalidations[4]?.());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isPending).toBe(false);
  });
});
