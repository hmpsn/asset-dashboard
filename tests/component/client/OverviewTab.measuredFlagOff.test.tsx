/**
 * OverviewTab — measured-capture flag-OFF rollback parity (P1a review fix #1).
 *
 * Contract: when `strategy-the-issue` is ON but `the-issue-client-measured-capture` is OFF, the typed
 * outcome render (type icons + [data-outcome-type] tags) must NOT appear, even if ws.eventConfig still
 * carries admin-assigned outcomeTypes. OverviewTab gates each unit's outcomeType on the measured flag,
 * so the byType rollup is empty and OutcomeCountBand degrades byte-identically to P0 (untyped estimate).
 *
 * This stubs TheIssueClientPage to render the REAL OutcomeCountBand from the outcomeCount prop that
 * OverviewTab constructs — so the assertion exercises the actual gating path (the prop shape), not a
 * re-mocked render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverviewTab } from '../../../src/components/client/OverviewTab';
import { OutcomeCountBand } from '../../../src/components/client/the-issue/OutcomeCountBand';
import type { WorkspaceInfo } from '../../../src/components/client/types';
import type { IssueOutcomeCount } from '../../../shared/types/the-issue';

// ── per-flag useFeatureFlag dispatcher ──────────────────────────────────────────
const featureFlagMock = vi.fn((_flag: string) => false);
vi.mock('../../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...(args as [string])),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../../../src/components/client/BetaContext', () => ({ useBetaMode: () => false }));
vi.mock('../../../src/hooks/client', () => ({ useClientIntelligence: () => ({ data: undefined }) }));
vi.mock('../../../src/hooks/useRecommendations', () => ({ useRecommendationSet: () => ({ data: undefined }) }));

// Stub TheIssueClientPage to render the REAL OutcomeCountBand from the outcomeCount prop OverviewTab
// builds — so the [data-outcome-type] assertion exercises OverviewTab's actual outcomeType gating.
vi.mock('../../../src/components/client/the-issue/TheIssueClientPage', () => ({
  TheIssueClientPage: ({ outcomeCount }: { outcomeCount?: IssueOutcomeCount | null }) =>
    outcomeCount ? <OutcomeCountBand count={outcomeCount} /> : <div data-testid="no-outcome-count" />,
}));

const ws: WorkspaceInfo = {
  id: 'ws-test',
  name: 'Acme Corp',
  tier: 'growth',
  // Typed pinned events — admin assigned outcomeTypes. These MUST be ignored when measured is OFF.
  eventConfig: [
    { eventName: 'form_submit', displayName: 'Form fills', pinned: true, outcomeType: 'form_fill' },
    { eventName: 'phone_call', displayName: 'Calls', pinned: true, outcomeType: 'call' },
  ] as never,
};

const baseProps = {
  ws,
  overview: null, searchComparison: null, trend: [],
  ga4Overview: null, ga4Trend: [], ga4Comparison: null, ga4Organic: null,
  ga4Conversions: [
    { eventName: 'form_submit', conversions: 23 },
    { eventName: 'phone_call', conversions: 41 },
  ] as never,
  ga4NewVsReturning: [], searchDataUpdatedAt: null, ga4DataUpdatedAt: null,
  audit: null, auditDetail: null, strategyData: null, insights: null,
  contentRequests: [], requests: [], approvalBatches: [], activityLog: [],
  pendingApprovals: 0, unreadTeamNotes: 0,
  eventDisplayName: (n: string) => n, isEventPinned: () => true,
  workspaceId: 'ws-test', onAskAi: vi.fn(), onOpenChat: vi.fn(),
  clientUser: null, contentPlanSummary: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  // strategy-the-issue ON, the-issue-client-measured-capture OFF.
  featureFlagMock.mockImplementation((flag: string) => flag === 'strategy-the-issue');
});

describe('OverviewTab — measured-capture flag OFF rollback (byte-identical P0)', () => {
  it('renders NO [data-outcome-type] tags even when eventConfig carries typed outcomeTypes', () => {
    const { container } = render(<OverviewTab {...baseProps} />);
    // The outcome units still render (estimate path), but with NO typed render.
    expect(container.querySelectorAll('[data-outcome-type]').length).toBe(0);
  });

  it('renders no type-aware icon for any unit (untyped StatCards only)', () => {
    const { container } = render(<OverviewTab {...baseProps} />);
    // OutcomeCountBand only renders type icons inside [data-outcome-type] wrappers (typed units).
    // With measured OFF there are none — confirm the typed wrapper is absent and the band still mounted.
    expect(container.querySelectorAll('[data-outcome-type] svg').length).toBe(0);
    expect(screen.getByTestId('outcome-count-band')).toBeInTheDocument();
  });

  it('flips to typed render when the measured flag is ON (positive control)', () => {
    featureFlagMock.mockImplementation(
      (flag: string) => flag === 'strategy-the-issue' || flag === 'the-issue-client-measured-capture',
    );
    const { container } = render(<OverviewTab {...baseProps} />);
    // form_fill + call → two typed units → two [data-outcome-type] tags.
    expect(container.querySelectorAll('[data-outcome-type]').length).toBe(2);
  });
});
