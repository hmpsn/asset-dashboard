import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const postMock = vi.fn().mockResolvedValue({ modified: 2 });
vi.mock('../../../src/api/client.js', () => ({ post: (...a: unknown[]) => postMock(...a) }));

import { useRecBulkMutation } from '../../../src/hooks/admin/useRecBulkMutation';
import { queryKeys } from '../../../src/lib/queryKeys';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useRecBulkMutation', () => {
  beforeEach(() => postMock.mockClear());

  it('posts the bulk payload to the bulk endpoint', async () => {
    const { result } = renderHook(() => useRecBulkMutation('ws-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ recIds: ['r1', 'r2'], action: 'throttle', throttleDays: 30 });
    });
    await waitFor(() => expect(postMock).toHaveBeenCalledWith(
      '/api/recommendations/ws-1/bulk',
      { recIds: ['r1', 'r2'], action: 'throttle', throttleDays: 30 },
    ));
  });

  it('invalidates BOTH the admin and shared recommendations caches on success', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrap = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRecBulkMutation('ws-1'), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ recIds: ['r1'], action: 'send' });
    });
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.admin.recommendations('ws-1') });
      expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.shared.recommendations('ws-1') });
    });
  });
});
