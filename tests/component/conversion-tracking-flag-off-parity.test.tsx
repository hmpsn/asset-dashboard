/**
 * Lane C C5 — flag-OFF byte-identical parity for the P1a admin additions.
 *
 * With the-issue-client-measured-capture mocked OFF, NONE of the P1a subsections render: no
 * Conversion-tracking readout, no Webflow connect card, no per-event lead-type select. The
 * ClientDashboardTab surface is exactly today's P0 surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => false, // measured-capture OFF
}));
vi.mock('../../src/hooks/admin/useConversionTrackingStatus', () => ({
  useConversionTrackingStatus: () => ({ status: undefined, isLoading: false, isError: false }),
}));

const availableEvents = [{ eventName: 'form_submit', eventCount: 120, users: 90 }];
vi.mock('../../src/api/client', () => ({
  get: vi.fn(async () => []),
  getSafe: vi.fn(async (url: string, fallback: unknown) =>
    url.includes('analytics-events') ? availableEvents : fallback),
  post: vi.fn(async () => ({})),
  patch: vi.fn(async () => ({})),
  del: vi.fn(async () => ({})),
}));

import { ClientDashboardTab } from '../../src/components/settings/ClientDashboardTab';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

describe('C5 — flag-OFF byte-identical parity', () => {
  it('renders none of the P1a subsections when measured-capture is OFF', async () => {
    render(
      <ClientDashboardTab
        workspaceId="ws-1"
        webflowSiteId="site-1"
        ws={{
          ga4PropertyId: 'GA-123',
          outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate' },
          conversionTrackingConfirmedAt: new Date().toISOString(),
          eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
        }}
        patchWorkspace={vi.fn(async () => ({}))}
        toast={vi.fn()}
      />,
    );

    // No readout, no connect card, no value-integrity preview.
    expect(screen.queryByText('Conversion tracking')).toBeNull();
    expect(screen.queryByText('Webflow form capture')).toBeNull();
    expect(screen.queryByText(/would have read/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Enable Webflow form capture/i })).toBeNull();

    // The P0 surface still renders.
    expect(screen.getByText('Outcome Value')).toBeInTheDocument();
    expect(screen.getByText('Event Display & Pinning')).toBeInTheDocument();

    // Open Event Config — no per-event lead-type select.
    fireEvent.click(screen.getByLabelText('Configure event display'));
    await waitFor(() => expect(screen.queryByText(/form submit|Form fills/)).toBeTruthy());
    expect(screen.queryByLabelText(/Lead type for/i)).toBeNull();
  });
});
