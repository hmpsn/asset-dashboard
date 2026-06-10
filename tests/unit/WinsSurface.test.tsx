import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WinsSurface } from '../../src/components/client/Briefing/WinsSurface';
import type { OutcomeWinEntry } from '../../shared/types/outcome-tracking';

// Mock useClientOutcomeWins
vi.mock('../../src/hooks/client/useClientOutcomes', () => ({
  useClientOutcomeWins: vi.fn(),
}));

// Mock useFeatureFlag — TierGate uses it internally
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn().mockReturnValue(false),
}));

import { useClientOutcomeWins } from '../../src/hooks/client/useClientOutcomes';

const mockWin = (overrides: Partial<OutcomeWinEntry> = {}): OutcomeWinEntry => ({
  actionId: 'act-1',
  actionType: 'meta_updated',
  pageUrl: 'https://example.com/services',
  targetKeyword: null,
  recommendation: 'meta_updated action',
  delta: { primary_metric: 'clicks', baseline_value: 10, current_value: 15, delta_absolute: 5, delta_percent: 50, direction: 'improved' },
  score: 'win',
  detectedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  ...overrides,
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('WinsSurface', () => {
  it('renders "What we shipped" heading', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [mockWin()], isLoading: false, isError: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('What we shipped')).toBeInTheDocument();
  });

  it('renders human label for meta_updated action type', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [mockWin()], isLoading: false, isError: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('Updated meta description')).toBeInTheDocument();
  });

  it('renders "Win" badge for score=win', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [mockWin({ score: 'win' })], isLoading: false, isError: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('Win')).toBeInTheDocument();
  });

  it('renders "Strong win" badge for score=strong_win', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [mockWin({ score: 'strong_win' })], isLoading: false, isError: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('Strong win')).toBeInTheDocument();
  });

  it('renders nothing when wins is []', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isLoading: false, isError: false });
    const { container } = renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    // Component returns null when there are no wins — no card, no empty state
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Wins are building')).not.toBeInTheDocument();
  });

  it('shows skeleton rows when loading', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    const skeletons = container.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('does not show "See full history" link even when exactly 10 wins returned', () => {
    const wins = Array.from({ length: 10 }, (_, i) => mockWin({ actionId: `act-${i}` }));
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: wins, isLoading: false, isError: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.queryByText('See full history →')).not.toBeInTheDocument();
  });

  // ── Free-tier teaser month-windowed count ────────────────────────────────

  it('free-tier teaser uses 30-day window: 2 recent wins, 3 old → shows "2 wins"', () => {
    const now = Date.now();
    const recentWins = [
      mockWin({ actionId: 'r1', detectedAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString() }),
      mockWin({ actionId: 'r2', detectedAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() }),
    ];
    const oldWins = [
      mockWin({ actionId: 'o1', detectedAt: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString() }),
      mockWin({ actionId: 'o2', detectedAt: new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString() }),
      mockWin({ actionId: 'o3', detectedAt: new Date(now - 35 * 24 * 60 * 60 * 1000).toISOString() }),
    ];
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [...recentWins, ...oldWins], isLoading: false, isError: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="free" />);
    expect(screen.getByText(/2 wins? in the last 30 days/)).toBeInTheDocument();
  });

  it('free-tier teaser zero count: all wins older than 30 days → fallback string', () => {
    const now = Date.now();
    const oldWins = [
      mockWin({ actionId: 'o1', detectedAt: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString() }),
      mockWin({ actionId: 'o2', detectedAt: new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString() }),
    ];
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: oldWins, isLoading: false, isError: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="free" />);
    expect(screen.getByText(/Wins are being tracked/)).toBeInTheDocument();
  });
});
