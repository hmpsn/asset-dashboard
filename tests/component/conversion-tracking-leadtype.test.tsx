/**
 * Lane C C1 — per-pinned-event outcomeType (lead-type) mapping in Event Display & Pinning.
 *
 * Flag ON: each PINNED event row renders an outcomeType <select>; choosing a type and saving PATCHes
 * eventConfig carrying { outcomeType }. Flag OFF: no outcomeType select renders (the row is
 * byte-identical to the P0 surface). useFeatureFlag is mocked (no QueryClientProvider needed for the
 * flag path); the component's network layer is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── per-flag useFeatureFlag dispatcher (Sidebar.test.tsx pattern) ──────────────
const featureFlagMock = vi.fn((_flag: string) => false);
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...(args as [string])),
}));

// Stub the conversion-tracking status hook so the readout doesn't need React Query wiring.
vi.mock('../../src/hooks/admin/useConversionTrackingStatus', () => ({
  useConversionTrackingStatus: () => ({ status: undefined, isLoading: false, isError: false }),
}));

// The component fetches client users + available events on mount via api/client; stub the network.
const availableEvents = [
  { eventName: 'form_submit', eventCount: 120, users: 90 },
  { eventName: 'phone_call', eventCount: 41, users: 38 },
];
vi.mock('../../src/api/client', () => ({
  get: vi.fn(async () => []),
  // loadEvents() uses getSafe against /api/public/analytics-events/... (flat array) + analytics-top-pages.
  getSafe: vi.fn(async (url: string, fallback: unknown) =>
    url.includes('analytics-events') ? availableEvents : fallback),
  post: vi.fn(async () => ({})),
  patch: vi.fn(async () => ({})),
  del: vi.fn(async () => ({})),
}));

import { ClientDashboardTab } from '../../src/components/settings/ClientDashboardTab';

function renderTab(ws: Record<string, unknown> = {}, patchWorkspace = vi.fn(async () => ({}))) {
  render(
    <ClientDashboardTab
      workspaceId="ws-1"
      webflowSiteId="site-1"
      ws={{ ga4PropertyId: 'GA-123', ...ws }}
      patchWorkspace={patchWorkspace}
      toast={vi.fn()}
    />,
  );
  return { patchWorkspace };
}

beforeEach(() => {
  vi.clearAllMocks();
  featureFlagMock.mockReturnValue(false);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ events: availableEvents, pages: [] }) })));
});

describe('C1 — outcomeType mapping (flag ON)', () => {
  it('renders an outcomeType select per pinned row and PATCHes eventConfig with the chosen types', async () => {
    featureFlagMock.mockImplementation((flag: string) => flag === 'the-issue-client-measured-capture');
    const { patchWorkspace } = renderTab({
      eventConfig: [
        { eventName: 'form_submit', displayName: 'Form fills', pinned: true },
        { eventName: 'phone_call', displayName: 'Calls', pinned: true },
      ],
    });
    // Open Event Configuration.
    fireEvent.click(screen.getByLabelText('Configure event display'));
    await waitFor(() => expect(screen.getAllByLabelText(/Lead type for/i).length).toBeGreaterThanOrEqual(2));

    fireEvent.change(screen.getByLabelText('Lead type for form_submit'), { target: { value: 'form_fill' } });
    fireEvent.change(screen.getByLabelText('Lead type for phone_call'), { target: { value: 'call' } });
    fireEvent.click(screen.getByLabelText('Save event configuration'));

    await waitFor(() => {
      expect(patchWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          eventConfig: expect.arrayContaining([
            expect.objectContaining({ eventName: 'form_submit', pinned: true, outcomeType: 'form_fill' }),
            expect.objectContaining({ eventName: 'phone_call', pinned: true, outcomeType: 'call' }),
          ]),
        }),
      );
    });
  });
});

describe('C1 — flag OFF byte-identical', () => {
  it('renders NO outcomeType select when the flag is OFF', async () => {
    featureFlagMock.mockReturnValue(false);
    renderTab({ eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true }] });
    fireEvent.click(screen.getByLabelText('Configure event display'));
    await waitFor(() => expect(screen.queryByText(/form submit|Form fills/)).toBeTruthy());
    expect(screen.queryByLabelText(/Lead type for/i)).toBeNull();
  });
});
