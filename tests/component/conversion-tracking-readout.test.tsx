/**
 * Lane C C2/C5 — admin verification readout + setup checklist + value-integrity guardrails.
 *
 * Flag ON: the Conversion tracking readout renders pinned/typed counts, the Webflow-forms-connected
 * pill, relative last-lead freshness, the resolved provenance pill (both "Measured" and "Estimate"
 * directions), the OnboardingStep-shaped setup checklist, and the value-integrity preview ("based on
 * your most recent tracked data, that's about $Y" — the latest single GA4 snapshot, NOT a 90-day
 * aggregate — + client-sentence echo). Flag OFF: the readout is absent (byte-identical P0).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConversionTrackingStatus } from '../../src/api/conversionTracking';

const featureFlagMock = vi.fn((_flag: string) => false);
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...(args as [string])),
}));

const statusMock = vi.fn<() => { status: ConversionTrackingStatus | undefined; isLoading: boolean; isError: boolean }>(
  () => ({ status: undefined, isLoading: false, isError: false }),
);
vi.mock('../../src/hooks/admin/useConversionTrackingStatus', () => ({
  useConversionTrackingStatus: () => statusMock(),
}));

vi.mock('../../src/api/client', () => ({
  get: vi.fn(async () => []),
  getSafe: vi.fn(async (_url: string, fallback: unknown) => fallback),
  post: vi.fn(async () => ({})),
  patch: vi.fn(async () => ({})),
  del: vi.fn(async () => ({})),
}));

import { ClientDashboardTab } from '../../src/components/settings/ClientDashboardTab';

const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

function renderTab(ws: Record<string, unknown> = {}) {
  // ClientDashboardTab now calls useQueryClient (the disable/enable handlers invalidate the
  // conversion-tracking-status query), so a QueryClientProvider must wrap the render.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ClientDashboardTab
        workspaceId="ws-1"
        webflowSiteId="site-1"
        ws={{ ga4PropertyId: 'GA-123', ...ws }}
        patchWorkspace={vi.fn(async () => ({}))}
        toast={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  featureFlagMock.mockReturnValue(false);
  statusMock.mockReturnValue({ status: undefined, isLoading: false, isError: false });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

describe('C2 — verification readout (flag ON)', () => {
  beforeEach(() => {
    featureFlagMock.mockImplementation((flag: string) => flag === 'the-issue-client-measured-capture');
    statusMock.mockReturnValue({
      status: {
        pinnedCount: 3, typedCount: 2, formCaptureConnected: true,
        lastSubmissionAt: TWO_HOURS_AGO, submissionCount: 5, recentOutcomeCount: 18,
      },
      isLoading: false, isError: false,
    });
  });

  it('renders pinned/typed counts, forms-connected pill, and relative last-lead', () => {
    renderTab({
      eventConfig: [
        { eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' },
        { eventName: 'phone_call', displayName: 'Calls', pinned: true, outcomeType: 'call' },
        { eventName: 'scroll', displayName: 'Scroll', pinned: true },
      ],
    });
    expect(screen.getByText('Conversion tracking')).toBeInTheDocument();
    expect(screen.getByText(/3 pinned · 2 typed/)).toBeInTheDocument();
    expect(screen.getByText(/Webflow forms connected/)).toBeInTheDocument();
    expect(screen.getByText(/2h ago/)).toBeInTheDocument();
  });

  it('provenance pill reads "Measured" when a real lead has been captured (submissionCount > 0)', () => {
    // C2 fixture above already sets submissionCount: 5 → the provenance flips to measured_action.
    renderTab({
      eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
    });
    const pill = document.querySelector('[data-provenance]');
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute('data-provenance')).toBe('measured_action');
    expect(pill?.textContent).toMatch(/measured/i);
    expect(pill?.textContent).not.toMatch(/estimate/i);
  });

  it('provenance pill reads "Estimate" when nothing is captured and setup is unconfirmed', () => {
    // Override the C2 status fixture: no leads captured, not connected → stays an estimate.
    statusMock.mockReturnValue({
      status: {
        pinnedCount: 1, typedCount: 1, formCaptureConnected: false,
        lastSubmissionAt: null, submissionCount: 0, recentOutcomeCount: 0,
      },
      isLoading: false, isError: false,
    });
    renderTab({
      // No conversionTrackingConfirmedAt → hasConfirmedTypedSetup is false → estimate_ga4.
      eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
    });
    const pill = document.querySelector('[data-provenance]');
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute('data-provenance')).toBe('estimate_ga4');
    expect(pill?.textContent).toMatch(/estimate/i);
    expect(pill?.textContent).not.toMatch(/measured/i);
  });

  it('shows the value-integrity preview ("based on your most recent tracked data") + the client-sentence echo', () => {
    renderTab({
      outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate' },
      eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
    });
    // 18 outcomes * $800 = $14,400 preview (also echoed in the client-sentence below). The label must
    // reflect the latest single GA4 snapshot, NOT a 90-day aggregate (which would inflate the figure).
    expect(screen.getByText(/based on your most recent tracked data/i)).toBeInTheDocument();
    expect(screen.queryByText(/last 90 days/i)).toBeNull();
    expect(screen.getAllByText(/\$14,400/).length).toBeGreaterThanOrEqual(1);
  });
});

describe('C5 — flag OFF parity', () => {
  it('does NOT render the Conversion tracking readout when the flag is OFF', () => {
    featureFlagMock.mockReturnValue(false);
    renderTab({ eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true }] });
    expect(screen.queryByText('Conversion tracking')).toBeNull();
  });
});
