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
  recommendation: 'Updated page metadata',
  delta: { primary_metric: 'clicks', baseline_value: 10, current_value: 15, delta_absolute: 5, delta_percent: 50, direction: 'improved' },
  score: 'win',
  attributedValue: null,
  // C4: default to platform_executed so the umbrella stays "What we shipped"; the
  // externally_executed honesty path is covered by its own test below.
  attribution: 'platform_executed',
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

  // C4 (attribution honesty): an externally_executed win is work done on the CLIENT's side
  // that we flagged — the card must NOT claim "we shipped/built" it.
  it('reframes the card title and shows an honest qualifier for externally_executed wins', () => {
    const wins = [mockWin({ actionId: 'ext-1', attribution: 'externally_executed' })];
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: wins, isLoading: false, isError: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    // Umbrella title becomes the honest "Wins we called" instead of "What we shipped".
    expect(screen.getByText('Wins we called')).toBeInTheDocument();
    expect(screen.queryByText('What we shipped')).not.toBeInTheDocument();
    // The row carries the "implemented on your side" qualifier so we never claim execution.
    expect(screen.getByText('We flagged this — implemented on your side.')).toBeInTheDocument();
  });

  // A platform_executed win must NOT carry the external qualifier.
  it('does not show the external qualifier for platform_executed wins', () => {
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [mockWin()], isLoading: false, isError: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.queryByText('We flagged this — implemented on your side.')).not.toBeInTheDocument();
  });

  it('renders the resolved source title as the row heading (E5 — real titles, not fabricated strings)', () => {
    const win = mockWin({ recommendation: 'Rewrite the pricing page meta description' });
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [win], isLoading: false, isError: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('Rewrite the pricing page meta description')).toBeInTheDocument();
  });

  it('falls back to the human action label when recommendation is empty', () => {
    const win = mockWin({ recommendation: '' });
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [win], isLoading: false, isError: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText('Updated meta description')).toBeInTheDocument();
  });

  it('renders formatted attributed value when present (E5 — dollar attribution)', () => {
    const win = mockWin({ attributedValue: 318.4 });
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: [win], isLoading: false, isError: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.getByText(/\$318/)).toBeInTheDocument();
  });

  it('shows no dollar line when attributedValue is null or zero', () => {
    const wins = [
      mockWin({ actionId: 'a-null', attributedValue: null }),
      mockWin({ actionId: 'a-zero', attributedValue: 0 }),
    ];
    (useClientOutcomeWins as ReturnType<typeof vi.fn>).mockReturnValue({ data: wins, isLoading: false, isError: false });
    renderWithQuery(<WinsSurface workspaceId="ws-1" effectiveTier="growth" />);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
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
