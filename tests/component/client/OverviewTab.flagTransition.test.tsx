/**
 * Regression guard for the Rules-of-Hooks crash in OverviewTab (caught only in a real browser render
 * during the staging soak, NOT by the other OverviewTab tests).
 *
 * The bug: `useFeatureFlag('the-issue-client-measured-capture')` was called INSIDE the
 * `if (theIssueEnabled)` block. When the strategy-the-issue feature-flag query resolves
 * (loading→loaded flips theIssueEnabled false→true), the conditional hook is added on the second
 * render → React throws "Rendered more hooks than during the previous render" and the ErrorBoundary
 * blanks the whole client dashboard.
 *
 * Why the sibling tests can't catch it: they all `vi.mock('useFeatureFlag', () => () => false)`. A
 * mocked hook is a plain function — it consumes ZERO React hook slots, so a conditionally-placed
 * useFeatureFlag never registers as a hook and the order-violation is invisible. This test uses the
 * REAL useFeatureFlag backed by a QueryClient and drives the actual loading→loaded transition, so any
 * conditionally-placed hook in OverviewTab will throw here.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OverviewTab } from '../../../src/components/client/OverviewTab';
import type { WorkspaceInfo } from '../../../src/components/client/types';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../../../src/components/client/BetaContext', () => ({ useBetaMode: () => false }));
vi.mock('../../../src/hooks/client', () => ({ useClientIntelligence: () => ({ data: undefined }) }));
vi.mock('../../../src/hooks/useRecommendations', () => ({ useRecommendationSet: () => ({ data: undefined }) }));

// NOTE: useFeatureFlag is intentionally NOT mocked — the real hook (useQuery) is what makes this a
// genuine Rules-of-Hooks guard. We mock the underlying API so the flag query resolves to flags-ON,
// driving the loading(false)→loaded(true) transition that reproduced the crash.
vi.mock('../../../src/api/misc', () => ({
  featureFlags: {
    list: () => Promise.resolve({
      'strategy-the-issue': true,
      'the-issue-client-spine': true,
      'the-issue-client-measured-capture': true,
    }),
  },
}));

// The flag-ON branch renders TheIssueClientPage — stub it (the conditional hook under test lives in
// OverviewTab itself, which runs BEFORE this child renders, so a stub still exercises the violation).
vi.mock('../../../src/components/client/the-issue/TheIssueClientPage', () => ({
  TheIssueClientPage: () => <div data-testid="issue-client-page" />,
}));
// Heavy legacy-body children (rendered during the initial loading=flag-OFF render) — stub for speed.
vi.mock('../../../src/components/client/MonthlyDigest', () => ({ MonthlyDigest: () => <div /> }));
vi.mock('../../../src/components/client/IntelligenceSummaryCard', () => ({ IntelligenceSummaryCard: () => <div /> }));
vi.mock('../../../src/components/client/HealthScoreCard', () => ({ HealthScoreCard: () => <div /> }));
vi.mock('../../../src/components/client/PredictionShowcaseCard', () => ({ PredictionShowcaseCard: () => <div /> }));
vi.mock('../../../src/components/client/InsightsDigest', () => ({ InsightsDigest: () => <div /> }));

const baseWs: WorkspaceInfo = { id: 'ws-test', name: 'Acme Corp', tier: 'growth', siteIntelligenceClientView: true };

const baseProps = {
  ws: baseWs,
  overview: null, searchComparison: null, trend: [], ga4Overview: null, ga4Trend: [],
  ga4Comparison: null, ga4Organic: null, ga4Conversions: [], ga4NewVsReturning: [],
  searchDataUpdatedAt: null, ga4DataUpdatedAt: null, audit: null, auditDetail: null,
  strategyData: null, insights: null, contentRequests: [], requests: [], approvalBatches: [],
  activityLog: [], pendingApprovals: 0, unreadTeamNotes: 0,
  eventDisplayName: (n: string) => n, isEventPinned: () => false,
  workspaceId: 'ws-test', onAskAi: vi.fn(), onOpenChat: vi.fn(),
  clientUser: null, contentPlanSummary: null,
};

describe('OverviewTab — feature-flag loading→loaded transition (Rules-of-Hooks guard)', () => {
  it('does NOT crash with "rendered more hooks" when strategy-the-issue resolves true', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <OverviewTab {...baseProps} />
      </QueryClientProvider>,
    );
    // After the flag query resolves, theIssueEnabled flips false→true and the Issue branch mounts.
    // A conditionally-placed hook in OverviewTab would throw during this transition and the page would
    // never appear; reaching the stub proves the hook order stayed stable across the transition.
    await waitFor(() => {
      expect(screen.getByTestId('issue-client-page')).toBeInTheDocument();
    });
  });
});
