import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { WorkspaceIntegrationHealth } from '../../shared/types/integration-health';

vi.mock('../../src/api/misc', () => ({
  integrationHealth: {
    get: vi.fn(),
  },
}));

import { integrationHealth } from '../../src/api/misc';
import { useIntegrationHealth } from '../../src/hooks/admin/useIntegrationHealth';

const mockGet = vi.mocked(integrationHealth.get);

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useIntegrationHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches integration health for workspace id', async () => {
    const payload: WorkspaceIntegrationHealth = {
      workspaceId: 'ws_123',
      generatedAt: '2026-05-15T00:00:00.000Z',
      summary: { configured: 6, missing: 2, degraded: 1, healthy: 7 },
      integrations: [],
    };
    mockGet.mockResolvedValueOnce(payload);

    const { result } = renderHook(() => useIntegrationHealth('ws_123'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('ws_123');
    expect(result.current.data).toEqual(payload);
  });

  it('does not call API when workspace id is empty', async () => {
    renderHook(() => useIntegrationHealth(''), { wrapper: createWrapper() });
    await Promise.resolve();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
