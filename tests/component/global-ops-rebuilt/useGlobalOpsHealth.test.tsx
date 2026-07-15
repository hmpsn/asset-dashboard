import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from '../../../src/api/client';
import { useGlobalOpsHealth } from '../../../src/hooks/admin/useGlobalOpsSettings';
import { useHealthCheck } from '../../../src/hooks/admin/useHealthCheck';
import { queryKeys } from '../../../src/lib/queryKeys';

vi.mock('../../../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/client')>('../../../src/api/client');
  return { ...actual, get: vi.fn() };
});

const mockGet = vi.mocked(get);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('Global Ops health query sharing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shares the canonical health request and cache with the rebuilt shell', async () => {
    const response = {
      hasOpenAIKey: true,
      hasWebflowToken: true,
      hasGoogleAuth: true,
      hasEmailConfig: false,
      hasStripe: true,
    };
    mockGet.mockResolvedValue(response);

    const { result } = renderHook(() => ({
      shell: useHealthCheck(),
      settings: useGlobalOpsHealth(),
    }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.shell.isSuccess).toBe(true);
      expect(result.current.settings.isSuccess).toBe(true);
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/health');
    expect(result.current.shell.data).toBe(result.current.settings.data);
    expect(queryKeys.admin.health()).toEqual(['admin-health']);
  });
});
