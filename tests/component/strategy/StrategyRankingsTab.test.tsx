// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StrategyRankingsTab } from '../../../src/components/strategy/StrategyRankingsTab';
import type { StrategyMetrics, PageKeywordMap } from '../../../src/components/strategy/types';

const PAGE = {} as PageKeywordMap;

function metrics(over: Partial<StrategyMetrics> = {}): StrategyMetrics {
  return {
    pageMap: [], filteredPageMap: [PAGE], ranked: [PAGE], avgPos: 5,
    totalImpressions: 0, totalClicks: 0, top3: [], top10: [], top20: [], beyond20: [],
    notRankingCount: 0, lowHangingFruit: [], intentCounts: {},
    movements: { improved: 4, declined: 2, new: 1, lost: 3 },
    declinedFeedback: [], requestedFeedback: [], approvedFeedback: [],
    feedbackNewerThanStrategy: false, hasAnyRanking: true, hasVolumeValidation: true,
    ...over,
  } as StrategyMetrics;
}

describe('StrategyRankingsTab', () => {
  it('shows an empty state when nothing ranks', () => {
    render(<StrategyRankingsTab metrics={metrics({ ranked: [] })} workspaceId="ws1" navigate={vi.fn()} />);
    expect(screen.getByText('No ranking data yet')).toBeInTheDocument();
  });

  it('renders position movements and a Keyword Hub deep-link', () => {
    const navigate = vi.fn();
    render(<StrategyRankingsTab metrics={metrics()} workspaceId="ws1" navigate={navigate} />);
    expect(screen.getByText('Position movements')).toBeInTheDocument();
    // Improved/Lost labels are unique to the movements card in this render.
    expect(screen.getByText('Improved')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument(); // improved count
    expect(screen.getByText('Lost')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Full keyword tracking/));
    expect(navigate).toHaveBeenCalled();
  });

  it('hides the movements card when there is no real movement data', () => {
    // previousPosition is not yet rotated server-side, so improved/declined/lost are 0 and only
    // "new" is populated — the card must stay hidden rather than show an all-zero/all-New panel.
    render(
      <StrategyRankingsTab
        metrics={metrics({ movements: { improved: 0, declined: 0, new: 5, lost: 0 } })}
        workspaceId="ws1"
        navigate={vi.fn()}
      />,
    );
    expect(screen.queryByText('Position movements')).not.toBeInTheDocument();
    // The distribution + Hub deep-link still render.
    expect(screen.getByText(/Full keyword tracking/)).toBeInTheDocument();
  });
});
