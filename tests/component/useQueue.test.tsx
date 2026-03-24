import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../src/api/client', () => ({
  get: vi.fn(),
}));

import { get } from '../../src/api/client';
import { useQueue } from '../../src/hooks/admin/useQueue';

const mockGet = vi.mocked(get);

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useQueue', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('fetches queue items from /api/queue', async () => {
    const items = [
      { id: 'q-1', fileName: 'hero.jpg', workspace: 'ws-1', type: 'asset', status: 'optimizing', startedAt: Date.now() },
      { id: 'q-2', fileName: 'about.jpg', workspace: 'ws-1', type: 'asset', status: 'done', startedAt: Date.now() - 5000 },
    ];
    mockGet.mockResolvedValueOnce(items);
    const { result } = renderHook(() => useQueue(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/api/queue');
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].status).toBe('optimizing');
  });

  it('returns empty array when queue is empty', async () => {
    mockGet.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useQueue(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('handles API error', async () => {
    mockGet.mockRejectedValueOnce(new Error('Queue unavailable'));
    const { result } = renderHook(() => useQueue(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Queue unavailable');
  });
});
