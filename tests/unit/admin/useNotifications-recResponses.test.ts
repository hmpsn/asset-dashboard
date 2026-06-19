// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const listMock = vi.fn();
vi.mock('../../../src/api/platform', () => ({ workspaceOverview: { list: () => listMock() } }));
vi.mock('../../../src/api/misc', () => ({
  anomalies: { listAll: () => Promise.resolve([]) },
  churnSignals: { list: () => Promise.resolve([]) },
}));

import { useNotifications } from '../../../src/hooks/admin/useNotifications';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useNotifications — rec responses', () => {
  beforeEach(() => listMock.mockReset());

  it('emits a notification for new client recommendation responses', async () => {
    listMock.mockResolvedValue([{
      id: 'ws-1', name: 'Acme', requests: { new: 0 }, approvals: { pending: 0 },
      recResponses: { approved: 2, declined: 0, discussing: 1 },
    }]);
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const item = result.current.data!.find(n => n.id === 'rec-responses-ws-1');
    expect(item).toBeDefined();
    expect(item!.label).toMatch(/3 client recommendation response/i);
    expect(item!.tab).toBe('seo-strategy');
  });
});
