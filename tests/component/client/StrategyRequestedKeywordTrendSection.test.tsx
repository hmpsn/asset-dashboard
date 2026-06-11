/**
 * A4 (audit #15) — client requested-keyword rank-trend card.
 *
 * Asserts:
 *  - renders the 180-day series (chart svg + legend) when rank history exists;
 *  - empty state when the client HAS requested keywords but no snapshots yet;
 *  - renders nothing when no keywords are client-requested;
 *  - free tier → TierGate teaser instead of the chart.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Mocks ──
vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: () => {},
}));

const mockHistory = vi.fn<() => Array<{ date: string; positions: Record<string, number> }>>(() => []);

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
    useQuery: (opts: { queryKey: unknown[]; enabled?: boolean }) => {
      const head = String(opts.queryKey?.[0] ?? '');
      if (head === 'client-requested-keyword-trend' && opts.enabled !== false) {
        return { data: mockHistory(), isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
    },
  };
});

import { StrategyRequestedKeywordTrendSection } from '../../../src/components/client/strategy/StrategyRequestedKeywordTrendSection';
import { TRACKED_KEYWORD_SOURCE } from '../../../shared/types/rank-tracking';
import type { TrackedKeyword } from '../../../shared/types/rank-tracking';

function makeKeyword(query: string, source: string): TrackedKeyword {
  return {
    query,
    pinned: false,
    addedAt: '2026-05-01T00:00:00.000Z',
    source: source as TrackedKeyword['source'],
    status: 'active',
  } as TrackedKeyword;
}

const requestedKeyword = makeKeyword('emergency plumber', TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED);
const strategyKeyword = makeKeyword('drain cleaning', TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD);

function seriesFixture(): Array<{ date: string; positions: Record<string, number> }> {
  // A multi-day series like the 180-day endpoint returns (limit=180).
  return Array.from({ length: 6 }, (_, i) => ({
    date: `2026-06-0${i + 1}`,
    positions: { 'emergency plumber': 20 - i * 2 },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHistory.mockReturnValue([]);
});

describe('StrategyRequestedKeywordTrendSection', () => {
  it('renders the rank series chart for requested keywords', () => {
    mockHistory.mockReturnValue(seriesFixture());
    const { container } = render(
      <StrategyRequestedKeywordTrendSection
        workspaceId="ws-1"
        trackedKeywords={[requestedKeyword, strategyKeyword]}
        effectiveTier="growth"
      />,
    );
    expect(screen.getByText('Your requested keywords')).toBeTruthy();
    // RankHistoryChart renders a stroked series path per keyword + a legend entry.
    expect(container.querySelector('path[stroke]')).toBeTruthy();
    expect(screen.getByText('emergency plumber')).toBeTruthy();
    // 180-day framing is part of the card copy.
    expect(screen.getByText(/180 days/)).toBeTruthy();
  });

  it('shows the empty state when keywords are requested but no snapshots exist yet', () => {
    mockHistory.mockReturnValue([]);
    render(
      <StrategyRequestedKeywordTrendSection
        workspaceId="ws-1"
        trackedKeywords={[requestedKeyword]}
        effectiveTier="growth"
      />,
    );
    expect(screen.getByText('No ranking data yet')).toBeTruthy();
  });

  it('renders nothing when the client has no requested keywords', () => {
    mockHistory.mockReturnValue(seriesFixture());
    const { container } = render(
      <StrategyRequestedKeywordTrendSection
        workspaceId="ws-1"
        trackedKeywords={[strategyKeyword]}
        effectiveTier="growth"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('free tier sees the TierGate teaser, not the chart', () => {
    mockHistory.mockReturnValue(seriesFixture());
    const { container } = render(
      <StrategyRequestedKeywordTrendSection
        workspaceId="ws-1"
        trackedKeywords={[requestedKeyword]}
        effectiveTier="free"
      />,
    );
    // Lock overlay with the feature name + plan badge renders.
    expect(screen.getByText('Requested Keyword Trends')).toBeTruthy();
    expect(screen.getByText('Growth Plan')).toBeTruthy();
    // The fetch is disabled when tier-locked, so no chart series path renders
    // (TierGate keeps a blurred aria-hidden preview of the card chrome only).
    expect(container.querySelector('path[stroke]')).toBeFalsy();
  });
});
