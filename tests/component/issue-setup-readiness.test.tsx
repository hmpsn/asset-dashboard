/**
 * Lane B (B4) — IssueSetupReadiness panel (the per-client readiness checklist with deep-links).
 *
 * Renders a ✓/⚠ row per SetupReadinessState signal (via the re-mounted ConversionTrackingReadout
 * + deep-linkable ConversionSetupStep[]). Each ⚠ gap is a one-click deep-link to the fix surface
 * (workspace-settings ?tab=connections|dashboard) honoring the ?tab= two-halves contract. All-complete
 * → steps render done (no deep-link), provenance pill = "Measured". No purple/violet/indigo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SetupReadinessState } from '../../shared/types/the-issue';
import type { ConversionTrackingStatus } from '../../src/api/conversionTracking';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import { IssueSetupReadiness } from '../../src/components/strategy/issue/IssueSetupReadiness';

const ALL_GAPS: SetupReadinessState = {
  ga4Connected: false,
  valueSet: false,
  basisOfValue: null,
  segmentConfirmed: false,
  eventsPinned: false,
  eventsTyped: false,
  webflowConnected: false,
  conversionTrackingConfirmedAt: null,
  lastLeadAt: null,
  povDrafted: false,
  openGapCount: 7,
};

const ALL_CLEAR: SetupReadinessState = {
  ga4Connected: true,
  valueSet: true,
  basisOfValue: 'agency_estimate',
  segmentConfirmed: true,
  eventsPinned: true,
  eventsTyped: true,
  webflowConnected: true,
  conversionTrackingConfirmedAt: new Date().toISOString(),
  lastLeadAt: new Date().toISOString(),
  povDrafted: true,
  openGapCount: 0,
};

const STATUS: ConversionTrackingStatus = {
  pinnedCount: 0,
  typedCount: 0,
  formCaptureConnected: false,
  lastSubmissionAt: null,
  submissionCount: 0,
  recentOutcomeCount: 0,
  readiness: ALL_GAPS,
};

function renderPanel(readiness: SetupReadinessState, status: ConversionTrackingStatus = STATUS) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IssueSetupReadiness
          workspaceId="ws-1"
          readiness={readiness}
          status={status}
          segmentLabel="b2b saas"
          resolvedProvenance={readiness.lastLeadAt ? 'measured_action' : 'estimate_ga4'}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('IssueSetupReadiness (B4)', () => {
  it('shows the open-gap headline when there are gaps', () => {
    renderPanel(ALL_GAPS);
    expect(screen.getByText(/7 steps left|7 steps|steps left/i)).toBeInTheDocument();
  });

  it('renders each gap as an actionable deep-link button', () => {
    renderPanel(ALL_GAPS);
    // GA4, value, segment, events pin+type, webflow → each surfaces an actionable button.
    const ga4Btn = screen.getByRole('button', { name: /connect google analytics|connect ga4|ga4/i });
    expect(ga4Btn).toBeInTheDocument();
  });

  it('GA4 gap deep-links to workspace-settings?tab=connections', () => {
    renderPanel(ALL_GAPS);
    fireEvent.click(screen.getByRole('button', { name: /connect google analytics|connect ga4|ga4/i }));
    expect(navigateMock).toHaveBeenCalledWith('/ws/ws-1/workspace-settings?tab=connections');
  });

  it('outcome-value gap deep-links to workspace-settings?tab=dashboard', () => {
    renderPanel(ALL_GAPS);
    fireEvent.click(screen.getByRole('button', { name: /set.*outcome value|outcome value/i }));
    expect(navigateMock).toHaveBeenCalledWith('/ws/ws-1/workspace-settings?tab=dashboard');
  });

  it('all-clear → no actionable step buttons and a measured provenance pill', () => {
    renderPanel(ALL_CLEAR, { ...STATUS, readiness: ALL_CLEAR, formCaptureConnected: true, submissionCount: 3 });
    // No deep-link buttons remain (everything is completed).
    expect(screen.queryByRole('button', { name: /connect google analytics|set.*outcome value|connect webflow/i })).toBeNull();
    const pill = document.querySelector('[data-provenance]');
    expect(pill?.textContent).toMatch(/measured/i);
  });

  it('uses no purple/violet/indigo classes', () => {
    const { container } = renderPanel(ALL_GAPS);
    expect(container.innerHTML).not.toMatch(/purple-|violet|indigo/);
  });
});
