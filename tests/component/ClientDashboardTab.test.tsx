/**
 * Component tests for the The Issue (Client) P0 admin subsections in ClientDashboardTab:
 *  - "Outcome Value" subsection (after Content Pricing) — configure → save → PATCH with
 *    basis: 'agency_estimate'; an existing ai_enriched value shows the "AI estimate" label.
 *  - Segment confirm/override subsection — non-local FormSelect PATCHes segmentConfig.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// useFeatureFlag (P1a measured-capture) is read unconditionally; mock it OFF so these P0 tests stay on
// the byte-identical surface. A QueryClientProvider is still required because ClientDashboardTab calls
// useQueryClient unconditionally (enable/disable handlers invalidate the status query).
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => false,
}));
// The P1a status hook is gated on the flag (OFF here) but is still imported — stub it to a no-op.
vi.mock('../../src/hooks/admin/useConversionTrackingStatus', () => ({
  useConversionTrackingStatus: () => ({ status: undefined, isLoading: false, isError: false }),
}));

import { ClientDashboardTab } from '../../src/components/settings/ClientDashboardTab';

// The component fetches client users on mount via api/client `get`; stub the network layer.
vi.mock('../../src/api/client', () => ({
  get: vi.fn(async () => []),
  getSafe: vi.fn(async () => ({ ok: true, data: [] })),
  post: vi.fn(async () => ({})),
  patch: vi.fn(async () => ({})),
  del: vi.fn(async () => ({})),
}));

function renderTab(wsOverrides: Record<string, unknown> = {}, patchWorkspace = vi.fn(async () => ({}))) {
  const toast = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ClientDashboardTab
        workspaceId="ws-1"
        webflowSiteId="site-1"
        ws={{ ...wsOverrides }}
        patchWorkspace={patchWorkspace}
        toast={toast}
      />
    </QueryClientProvider>,
  );
  return { patchWorkspace, toast };
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom doesn't implement fetch — the AI-enrich button uses it; stub a default ok.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ valuePerOutcome: 600, unitLabel: 'qualified lead' }),
  })));
});

describe('ClientDashboardTab — Outcome Value subsection', () => {
  it('renders the Outcome Value section', () => {
    renderTab();
    expect(screen.getByText('Outcome Value')).toBeInTheDocument();
  });

  it('saves a configured outcome value via patchWorkspace with basis agency_estimate', async () => {
    const { patchWorkspace } = renderTab();
    fireEvent.click(screen.getByLabelText('Configure outcome value'));
    fireEvent.change(screen.getByPlaceholderText('800'), { target: { value: '800' } });
    fireEvent.change(screen.getByPlaceholderText('new patient'), { target: { value: 'new patient' } });
    fireEvent.click(screen.getByLabelText('Save outcome value'));
    await waitFor(() => {
      expect(patchWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          outcomeValue: expect.objectContaining({
            valuePerOutcome: 800,
            unitLabel: 'new patient',
            basis: 'agency_estimate',
          }),
        }),
      );
    });
  });

  it('shows an AI estimate label when an existing value has basis ai_enriched', () => {
    renderTab({ outcomeValue: { valuePerOutcome: 600, unitLabel: 'qualified lead', currency: 'USD', basis: 'ai_enriched' } });
    expect(screen.getByText(/AI estimate/i)).toBeInTheDocument();
  });
});

describe('ClientDashboardTab — Segment subsection', () => {
  it('PATCHes segmentConfig when the non-local segment select changes', async () => {
    const { patchWorkspace } = renderTab({ segmentProfile: { segment: 'b2b_saas' } });
    const section = screen.getByText('Client Segment').closest('div');
    expect(section).toBeTruthy();
    const select = screen.getByLabelText('Segment override') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'professional_services' } });
    fireEvent.click(screen.getByLabelText('Save segment'));
    await waitFor(() => {
      expect(patchWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          segmentConfig: expect.objectContaining({ segment: 'professional_services' }),
        }),
      );
    });
    void within;
  });
});
