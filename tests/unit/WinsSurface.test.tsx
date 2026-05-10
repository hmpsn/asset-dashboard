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
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [mockWin()], isLoading: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('What we shipped')).toBeInTheDocument();
  });

  it('renders human label for meta_updated action type', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [mockWin()], isLoading: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('Updated meta description')).toBeInTheDocument();
  });

  it('renders "Win" badge for score=win', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [mockWin({ score: 'win' })], isLoading: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('Win')).toBeInTheDocument();
  });

  it('renders "Strong win" badge for score=strong_win', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [mockWin({ score: 'strong_win' })], isLoading: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('Strong win')).toBeInTheDocument();
  });

  it('shows empty state when wins is []', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [], isLoading: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText(/We're working/)).toBeInTheDocument();
  });

  it('shows skeleton rows when loading', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    const skeletons = container.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows "See full history" link when exactly 10 wins returned', () => {
    const wins = Array.from({ length: 10 }, (_, i) => mockWin({ actionId: `act-${i}` }));
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: wins, isLoading: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('See full history →')).toBeInTheDocument();
  });
});
