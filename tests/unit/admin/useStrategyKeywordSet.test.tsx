import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock the API wrappers
const getMock = vi.fn();
const postMock = vi.fn();

vi.mock('../../../src/api/keyword-strategy.js', () => ({
  getStrategyKeywordSet: (...a: unknown[]) => getMock(...a),
  addStrategyKeywordApi: (...a: unknown[]) => postMock('add', ...a),
  removeStrategyKeywordApi: (...a: unknown[]) => postMock('remove', ...a),
  keepStrategyKeywordApi: (...a: unknown[]) => postMock('keep', ...a),
}));

import { useStrategyKeywordSet } from '../../../src/hooks/admin/useStrategyKeywordSet';
import { queryKeys } from '../../../src/lib/queryKeys';
import type { ActiveStrategyKeyword } from '../../../shared/types/strategy-keyword-set';

const KW: ActiveStrategyKeyword = {
  id: 1,
  workspaceId: 'ws-1',
  keyword: 'seo tools',
  source: 'manual_add',
  keptAt: null,
  removedAt: null,
  slotOrder: 0,
  createdAt: '2026-06-19T00:00:00.000Z',
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useStrategyKeywordSet', () => {
  beforeEach(() => {
    getMock.mockClear();
    postMock.mockClear();
  });

  it('does not fetch when managedSetEnabled is false', async () => {
    getMock.mockResolvedValue({ keywords: [KW] });
    renderHook(() => useStrategyKeywordSet('ws-1', false), { wrapper });
    await new Promise(r => setTimeout(r, 50));
    expect(getMock).not.toHaveBeenCalled();
  });

  it('returns empty managedKeywordSet when flag is OFF', async () => {
    getMock.mockResolvedValue({ keywords: [KW] });
    const { result } = renderHook(() => useStrategyKeywordSet('ws-1', false), { wrapper });
    expect(result.current.managedKeywordSet).toEqual([]);
  });

  it('fetches the active set when managedSetEnabled is true', async () => {
    getMock.mockResolvedValue({ keywords: [KW] });
    const { result } = renderHook(() => useStrategyKeywordSet('ws-1', true), { wrapper });
    await waitFor(() => expect(result.current.managedKeywordSet).toHaveLength(1));
    expect(getMock).toHaveBeenCalledWith('ws-1');
    expect(result.current.managedKeywordSet[0].keyword).toBe('seo tools');
  });

  it('calls addStrategyKeywordApi with the correct args on addStrategyKeyword', async () => {
    getMock.mockResolvedValue({ keywords: [] });
    postMock.mockResolvedValue({ keyword: KW });
    const { result } = renderHook(() => useStrategyKeywordSet('ws-1', true), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.addStrategyKeyword('seo tools', 'manual_add');
    });
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('add', 'ws-1', 'seo tools', 'manual_add'));
  });

  it('calls removeStrategyKeywordApi on removeStrategyKeyword', async () => {
    getMock.mockResolvedValue({ keywords: [KW] });
    postMock.mockResolvedValue({ keywords: [] });
    const { result } = renderHook(() => useStrategyKeywordSet('ws-1', true), { wrapper });
    await waitFor(() => expect(result.current.managedKeywordSet).toHaveLength(1));

    await act(async () => {
      result.current.removeStrategyKeyword('seo tools');
    });
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('remove', 'ws-1', 'seo tools'));
  });

  it('calls keepStrategyKeywordApi on keepStrategyKeyword', async () => {
    getMock.mockResolvedValue({ keywords: [KW] });
    postMock.mockResolvedValue({ keywords: [{ ...KW, keptAt: '2026-06-19T00:00:00.000Z' }] });
    const { result } = renderHook(() => useStrategyKeywordSet('ws-1', true), { wrapper });
    await waitFor(() => expect(result.current.managedKeywordSet).toHaveLength(1));

    await act(async () => {
      result.current.keepStrategyKeyword('seo tools');
    });
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('keep', 'ws-1', 'seo tools'));
  });

  it('invalidates keywordStrategy cache on successful add', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    getMock.mockResolvedValue({ keywords: [] });
    postMock.mockResolvedValue({ keyword: KW });

    const wrap = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useStrategyKeywordSet('ws-1', true), { wrapper: wrap });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.addStrategyKeyword('seo tools', 'manual_add');
    });

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.admin.strategyKeywordSet('ws-1') });
      expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.admin.keywordStrategy('ws-1') });
    });
  });
});
