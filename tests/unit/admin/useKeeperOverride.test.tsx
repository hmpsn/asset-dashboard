import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const patchMock = vi.fn().mockResolvedValue({
  keeperPath: '/guides/implant-cost',
  urlSetKey: 'keeper-key',
});

vi.mock('../../../src/api/client.js', () => ({
  patch: (...args: unknown[]) => patchMock(...args),
}));

vi.mock('../../../src/hooks/useWorkspaceEvents.js', () => ({
  useWorkspaceEvents: vi.fn(),
}));

import { useKeeperOverride } from '../../../src/hooks/admin/useKeeperOverride';
import { queryKeys } from '../../../src/lib/queryKeys';
import { cannibalizationUrlSetKey } from '../../../shared/page-address-utils';

const pages = [
  { path: '/services/implants', position: 7, source: 'gsc' as const },
  { path: '/guides/implant-cost', position: 11, source: 'gsc' as const },
];
const urlSetKey = cannibalizationUrlSetKey(pages.map((page) => page.path));

function strategyFixture(canonicalPath = '/services/implants') {
  return {
    cannibalization: [{
      keyword: 'dental implant cost',
      severity: 'high' as const,
      recommendation: 'Consolidate the competing pages.',
      canonicalPath,
      pages,
    }],
  };
}

describe('useKeeperOverride', () => {
  beforeEach(() => {
    patchMock.mockReset();
    patchMock.mockResolvedValue({ keeperPath: '/guides/implant-cost', urlSetKey });
  });

  it('invalidates both recommendation and keyword-strategy reads after a keeper write', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useKeeperOverride('ws-engine'), { wrapper });

    act(() => {
      result.current.setKeeper({ urlSetKey: 'keeper-key', keeperPath: '/guides/implant-cost' });
    });

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.admin.recommendations('ws-engine') });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.admin.keywordStrategy('ws-engine') });
    });
  });

  it('updates the workspace keyword-strategy cache before the keeper request resolves', async () => {
    let resolvePatch: (value: { keeperPath: string; urlSetKey: string }) => void = () => {};
    patchMock.mockReturnValue(new Promise((resolve) => { resolvePatch = resolve; }));
    const queryClient = new QueryClient();
    const strategyKey = queryKeys.admin.keywordStrategy('ws-engine');
    queryClient.setQueryData(strategyKey, strategyFixture());
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useKeeperOverride('ws-engine'), { wrapper });

    act(() => {
      result.current.setKeeper({ urlSetKey, keeperPath: '/guides/implant-cost' });
    });

    await waitFor(() => {
      expect(queryClient.getQueryData<ReturnType<typeof strategyFixture>>(strategyKey)?.cannibalization[0]?.canonicalPath)
        .toBe('/guides/implant-cost');
    });

    await act(async () => {
      resolvePatch({ keeperPath: '/guides/implant-cost', urlSetKey });
    });
  });

  it('does not delay the selector success callback behind active-query refetches', async () => {
    const queryClient = new QueryClient();
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(new Promise(() => {}));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useKeeperOverride('ws-engine'), { wrapper });

    act(() => {
      result.current.setKeeper(
        { urlSetKey, keeperPath: '/guides/implant-cost' },
        { onSuccess },
      );
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('rolls the optimistic keeper back when the write fails', async () => {
    patchMock.mockRejectedValue(new Error('keeper write failed'));
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const strategyKey = queryKeys.admin.keywordStrategy('ws-engine');
    queryClient.setQueryData(strategyKey, strategyFixture());
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useKeeperOverride('ws-engine'), { wrapper });

    act(() => {
      result.current.setKeeper({ urlSetKey, keeperPath: '/guides/implant-cost' });
    });

    await waitFor(() => expect(result.current.keeperError).toBeTruthy());
    expect(queryClient.getQueryData<ReturnType<typeof strategyFixture>>(strategyKey)?.cannibalization[0]?.canonicalPath)
      .toBe('/services/implants');
  });
});
