/**
 * Lane C C2/C5 — admin verification readout + setup checklist + value-integrity guardrails.
 *
 * Flag ON: the Conversion tracking readout renders pinned/typed counts, the Webflow-forms-connected
 * pill, relative last-lead freshness, the resolved provenance pill, the OnboardingStep-shaped setup
 * checklist, and the value-integrity preview ("last 90 days would have read ~$Y" + client-sentence
 * echo). Flag OFF: the readout is absent (byte-identical P0).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  render(
    <ClientDashboardTab
      workspaceId="ws-1"
      webflowSiteId="site-1"
      ws={{ ga4PropertyId: 'GA-123', ...ws }}
      patchWorkspace={vi.fn(async () => ({}))}
      toast={vi.fn()}
    />,
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

  it('shows the value-integrity preview ("would have read ~$") + the client-sentence echo', () => {
    renderTab({
      outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate' },
      eventConfig: [{ eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' }],
    });
    // 18 outcomes * $800 = $14,400 preview (also echoed in the client-sentence below).
    expect(screen.getByText(/would have read/i)).toBeInTheDocument();
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
