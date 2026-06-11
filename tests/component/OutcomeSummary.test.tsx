/**
 * E5 (audit #5) — OutcomeSummary client scorecard component tests.
 * Tier-gated rendering: free (top-3 wins + gate), growth (full scorecard + premium gate),
 * premium (detailed breakdown), and the not-yet-measured empty state.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OutcomeSummary from '../../src/components/client/OutcomeSummary';
import type { OutcomeScorecard } from '../../shared/types/outcome-tracking';

vi.mock('../../src/hooks/client/useClientOutcomes', () => ({
  useClientOutcomeSummary: vi.fn(),
}));

// TierGate uses useFeatureFlag internally
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn().mockReturnValue(false),
}));

import { useClientOutcomeSummary } from '../../src/hooks/client/useClientOutcomes';

const mockSummary = useClientOutcomeSummary as ReturnType<typeof vi.fn>;

const scorecard = (overrides: Partial<OutcomeScorecard> = {}): OutcomeScorecard => ({
  overallWinRate: 0.75,
  strongWinRate: 0.5,
  totalTracked: 10,
  totalScored: 8,
  pendingMeasurement: 2,
  byCategory: [
    { actionType: 'meta_updated', winRate: 0.8, count: 6, scored: 5 },
    { actionType: 'content_refreshed', winRate: 0.6, count: 4, scored: 3 },
  ],
  trend: 'improving',
  ...overrides,
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('OutcomeSummary', () => {
  it('renders the "Your results" card title', () => {
    mockSummary.mockReturnValue({ data: scorecard(), isLoading: false });
    renderWithQuery(<OutcomeSummary workspaceId="ws-1" tier="growth" />);
    expect(screen.getByText('Your results')).toBeInTheDocument();
  });

  it('free tier: shows top wins narrative and gates the full scorecard behind Growth', () => {
    mockSummary.mockReturnValue({ data: scorecard(), isLoading: false });
    renderWithQuery(<OutcomeSummary workspaceId="ws-1" tier="free" />);
    // Narrative top-3 wins are visible ungated
    expect(screen.getByText(/worked 80% of the time/)).toBeInTheDocument();
    // The full scorecard is gated
    expect(screen.getByText('Full outcome scorecard')).toBeInTheDocument();
  });

  it('growth tier: renders the full scorecard with real percentages (no NaN)', () => {
    mockSummary.mockReturnValue({ data: scorecard(), isLoading: false });
    renderWithQuery(<OutcomeSummary workspaceId="ws-1" tier="growth" />);
    expect(screen.getByText('Overall win rate')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    // strongWinRate is serialized by the public endpoint (E5 fix) — never NaN
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    // pendingMeasurement renders
    expect(screen.getByText('Pending results')).toBeInTheDocument();
    // Premium breakdown is gated
    expect(screen.getByText('Detailed outcome breakdown')).toBeInTheDocument();
  });

  it('premium tier: renders the detailed breakdown ungated', () => {
    mockSummary.mockReturnValue({ data: scorecard(), isLoading: false });
    renderWithQuery(<OutcomeSummary workspaceId="ws-1" tier="premium" />);
    expect(screen.getByText('Detailed breakdown')).toBeInTheDocument();
    expect(screen.getByText('Confirmed wins')).toBeInTheDocument();
    expect(screen.queryByText('Detailed outcome breakdown')).not.toBeInTheDocument();
  });

  it('shows the empty state when nothing has been scored yet (0% is noise, not signal)', () => {
    mockSummary.mockReturnValue({
      data: scorecard({ overallWinRate: 0, strongWinRate: 0, totalTracked: 3, totalScored: 0, pendingMeasurement: 3, byCategory: [] }),
      isLoading: false,
    });
    renderWithQuery(<OutcomeSummary workspaceId="ws-1" tier="growth" />);
    expect(screen.getByText('Results are on the way')).toBeInTheDocument();
    expect(screen.queryByText('Overall win rate')).not.toBeInTheDocument();
  });

  it('shows the empty state when the summary fails to load', () => {
    mockSummary.mockReturnValue({ data: null, isLoading: false });
    renderWithQuery(<OutcomeSummary workspaceId="ws-1" tier="premium" />);
    expect(screen.getByText('Results are on the way')).toBeInTheDocument();
  });

  it('shows skeletons while loading', () => {
    mockSummary.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderWithQuery(<OutcomeSummary workspaceId="ws-1" tier="growth" />);
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });
});
