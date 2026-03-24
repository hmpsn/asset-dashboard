import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../src/api/client', () => ({
  get: vi.fn(),
}));

import { get } from '../../src/api/client';
import { useHealthCheck } from '../../src/hooks/admin/useHealthCheck';

const mockGet = vi.mocked(get);

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useHealthCheck', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('fetches health status from /api/health', async () => {
    const health = { hasOpenAIKey: true, hasWebflowToken: false };
    mockGet.mockResolvedValueOnce(health);
    const { result } = renderHook(() => useHealthCheck(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/api/health');
    expect(result.current.data).toEqual(health);
  });

  it('returns both keys true when configured', async () => {
    const health = { hasOpenAIKey: true, hasWebflowToken: true };
    mockGet.mockResolvedValueOnce(health);
    const { result } = renderHook(() => useHealthCheck(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.hasOpenAIKey).toBe(true);
    expect(result.current.data?.hasWebflowToken).toBe(true);
  });

  it('handles API error gracefully', async () => {
    mockGet.mockRejectedValueOnce(new Error('Server down'));
    const { result } = renderHook(() => useHealthCheck(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Server down');
  });
});
