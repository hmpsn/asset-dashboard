/**
 * the-issue-client-my-leads-hook.test.tsx — useClientMyLeads (Lane C, P1b).
 *
 * - fetches the client's own leads when enabled (consumes Lane A's getMyLeads wrapper);
 * - does NOT fetch when disabled (flag-OFF byte-identical) — no network, no WS subscription;
 * - registers the FORM_SUBMISSION_CAPTURED both-halves WS handler keyed on the workspace, which
 *   invalidates the my-leads query (Data Flow Rule #2, workspace-scoped → useWorkspaceEvents).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { NamedLeadView } from '../../shared/types/the-issue';
import { WS_EVENTS } from '../../src/lib/wsEvents';

vi.mock('../../src/api/conversionTracking', () => ({
  getMyLeads: vi.fn(),
}));

// Capture the (workspaceId, handlers) passed to useWorkspaceEvents so we can assert the contract.
const wsEventsSpy = vi.fn();
vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (wsId: string | undefined, handlers: Record<string, () => void>) => {
    wsEventsSpy(wsId, handlers);
  },
}));

import { getMyLeads } from '../../src/api/conversionTracking';
import { useClientMyLeads } from '../../src/hooks/client/useClientMyLeads';

const mockGet = vi.mocked(getMyLeads);

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const LEAD: NamedLeadView = {
  id: 'lead-1', formName: 'Contact', leadName: 'Jane', leadEmail: 'jane@example.com',
  outcomeType: 'form_fill', submittedAt: '2026-06-20T00:00:00.000Z',
};

describe('useClientMyLeads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the client own leads when enabled', async () => {
    mockGet.mockResolvedValueOnce({ leads: [LEAD] });
    const { result } = renderHook(() => useClientMyLeads('ws-1', true), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.leads.length).toBe(1));
    expect(mockGet).toHaveBeenCalledWith('ws-1');
    expect(result.current.leads[0].leadName).toBe('Jane');
  });

  it('does NOT fetch when disabled (flag-OFF parity) and subscribes to no workspace', async () => {
    renderHook(() => useClientMyLeads('ws-1', false), { wrapper: createWrapper() });
    await Promise.resolve();
    expect(mockGet).not.toHaveBeenCalled();
    // useWorkspaceEvents called with undefined workspace → no subscription side effects.
    expect(wsEventsSpy).toHaveBeenCalledWith(undefined, expect.anything());
  });

  it('does NOT fetch when the workspace id is empty', async () => {
    renderHook(() => useClientMyLeads('', true), { wrapper: createWrapper() });
    await Promise.resolve();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('registers a FORM_SUBMISSION_CAPTURED both-halves WS handler when enabled', () => {
    mockGet.mockResolvedValue({ leads: [] });
    renderHook(() => useClientMyLeads('ws-1', true), { wrapper: createWrapper() });
    const [wsId, handlers] = wsEventsSpy.mock.calls.at(-1)!;
    expect(wsId).toBe('ws-1');
    expect(typeof handlers[WS_EVENTS.FORM_SUBMISSION_CAPTURED]).toBe('function');
  });
});
