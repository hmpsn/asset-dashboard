/**
 * Lane B (B1) — useAdminLeads hook contract.
 *
 * Both-halves WS contract: when enabled, the hook subscribes to FORM_SUBMISSION_CAPTURED and
 * invalidates the paginated admin-leads query on a new capture. When disabled (flag-OFF parity),
 * it neither fetches nor subscribes — byte-identical to today's cockpit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Capture the workspaceId passed to useWorkspaceEvents + invoke its handlers on demand.
const subscribedWorkspaceIds: (string | undefined)[] = [];
let capturedHandlers: Record<string, () => void> = {};
vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (workspaceId: string | undefined, handlers: Record<string, () => void>) => {
    subscribedWorkspaceIds.push(workspaceId);
    capturedHandlers = handlers;
  },
}));

const listLeadsMock = vi.fn(async () => ({ leads: [], total: 0 }));
vi.mock('../../src/api/conversionTracking', () => ({
  conversionTrackingApi: {
    listLeads: (...args: unknown[]) => listLeadsMock(...(args as [])),
  },
}));

import { useAdminLeads } from '../../src/hooks/admin/useAdminLeads';
import { queryKeys } from '../../src/lib/queryKeys';
import { WS_EVENTS } from '../../src/lib/wsEvents';

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  subscribedWorkspaceIds.length = 0;
  capturedHandlers = {};
});

describe('useAdminLeads (B1)', () => {
  it('does NOT fetch and does NOT subscribe when disabled (flag-OFF parity)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useAdminLeads('ws-1', undefined, false), { wrapper: wrapper(qc) });
    // Give react-query a tick — the query must stay disabled.
    await new Promise((r) => setTimeout(r, 0));
    expect(listLeadsMock).not.toHaveBeenCalled();
    // useWorkspaceEvents called with undefined → no subscription.
    expect(subscribedWorkspaceIds.every((id) => id === undefined)).toBe(true);
  });

  it('fetches and subscribes when enabled', async () => {
    listLeadsMock.mockResolvedValueOnce({
      leads: [{ id: 'l1', formName: 'Contact', leadName: 'Ada', leadEmail: 'ada@x.test', outcomeType: 'form_fill', submittedAt: new Date().toISOString() }],
      total: 1,
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useAdminLeads('ws-1', undefined, true), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.total).toBe(1));
    expect(listLeadsMock).toHaveBeenCalledWith('ws-1', undefined);
    expect(subscribedWorkspaceIds).toContain('ws-1');
  });

  it('invalidates the form-submissions query on FORM_SUBMISSION_CAPTURED (both-halves)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useAdminLeads('ws-1', undefined, true), { wrapper: wrapper(qc) });
    await waitFor(() => expect(capturedHandlers[WS_EVENTS.FORM_SUBMISSION_CAPTURED]).toBeTypeOf('function'));
    capturedHandlers[WS_EVENTS.FORM_SUBMISSION_CAPTURED]();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.admin.formSubmissions('ws-1'),
    });
  });
});
