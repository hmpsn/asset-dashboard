/**
 * Wave 2b B2 — SearchTab KeywordTable migration tests.
 *
 * Assertions:
 *  - topQueries renders via KeywordTable (query text, clicks, impressions, CTR, position)
 *  - query↔page toggle in the "All Keywords & Pages" section still switches datasets
 *  - tracked-vs-all-queries caption is present when the raw data section is expanded
 *  - RankTrackingSection is kept as-is (not migrated, still renders)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SearchTab } from '../../src/components/client/SearchTab';
import type {
  SearchOverview, PerformanceTrend, SearchComparison,
} from '../../src/components/client/types';

vi.mock('../../src/components/client/helpers', () => ({
  DualTrendChart: () => <div data-testid="dual-trend-chart" />,
  InsightCard: ({ title }: { title: string }) => <div data-testid={`insight-card-${title}`}>{title}</div>,
}));

vi.mock('../../src/components/client/SeoGlossary', () => ({
  Explainer: () => null,
}));

vi.mock('../../src/components/shared/RankTable', async () => {
  const actual = await vi.importActual<typeof import('../../src/components/shared/RankTable')>('../../src/components/shared/RankTable');
  return {
    ...actual,
    RankTrackingSection: () => <div data-testid="rank-tracking-section" />,
  };
});

function makeOverview(overrides?: Partial<SearchOverview>): SearchOverview {
  return {
    totalClicks: 1200,
    totalImpressions: 28000,
    avgCtr: 4.3,
    avgPosition: 11.2,
    topQueries: [
      { query: 'acme plumbing', clicks: 88, impressions: 1800, ctr: 4.9, position: 6.3 },
      { query: 'emergency plumber', clicks: 52, impressions: 2200, ctr: 2.4, position: 14.7 },
    ],
    topPages: [
      { page: 'https://acme.test/services', clicks: 60, impressions: 1400, ctr: 4.3, position: 8.1 },
    ],
    dateRange: { start: '2026-05-01', end: '2026-05-28' },
    ...overrides,
  };
}

const defaultProps = {
  overview: makeOverview(),
  searchComparison: null as SearchComparison | null,
  trend: [] as PerformanceTrend[],
  annotations: [],
  rankHistory: [],
  latestRanks: [],
  insights: null,
};

describe('SearchTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders null state when overview is null', () => {
    render(<SearchTab {...defaultProps} overview={null} />);
    expect(screen.getByText('Search data coming soon')).toBeInTheDocument();
  });

  it('keeps RankTrackingSection as-is (not migrated)', () => {
    render(<SearchTab {...defaultProps} />);
    expect(screen.getByTestId('rank-tracking-section')).toBeInTheDocument();
  });

  // Wave 2b B2: "All Keywords & Pages" section — expand and verify KeywordTable renders query rows.
  it('renders topQueries via KeywordTable when raw data section is expanded', () => {
    render(<SearchTab {...defaultProps} />);

    // Expand the collapsible section
    fireEvent.click(screen.getByText('All Keywords & Pages'));

    // Query text from topQueries[0]
    expect(screen.getByText('acme plumbing')).toBeInTheDocument();
    // Clicks column
    expect(screen.getByText('88')).toBeInTheDocument();
    // Impressions column
    expect(screen.getByText('1,800')).toBeInTheDocument();
    // CTR column — rendered as "{value}%"
    expect(screen.getByText('4.9%')).toBeInTheDocument();
    // Position rendered via renderActions as raw decimal
    expect(screen.getByText('6.3')).toBeInTheDocument();
  });

  // Wave 2b B2: tracked-vs-all caption is present when the section is expanded.
  it('shows tracked-vs-all caption distinguishing all-queries from tracked keywords', () => {
    render(<SearchTab {...defaultProps} />);

    fireEvent.click(screen.getByText('All Keywords & Pages'));

    // Caption text distinguishing this table from RankTrackingSection above
    expect(
      screen.getByText(/all queries this period from search console/i)
    ).toBeInTheDocument();
  });

  // Wave 2b B2: query↔page toggle in the collapsible section still switches datasets.
  it('query↔page toggle switches datasets in the raw data section', () => {
    render(<SearchTab {...defaultProps} />);

    fireEvent.click(screen.getByText('All Keywords & Pages'));

    // Default: queries view — query is visible
    expect(screen.getByText('acme plumbing')).toBeInTheDocument();

    // Switch to pages
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    // Page path rendered (normalized URL, not full URL)
    expect(screen.getByText('/services')).toBeInTheDocument();
    // Query text no longer visible
    expect(screen.queryByText('acme plumbing')).not.toBeInTheDocument();
  });

  // Wave 2b B2: position uses positionColor authority via renderActions.
  it('renders position with positionColor accent class, not bare tailwind', () => {
    render(<SearchTab {...defaultProps} />);

    fireEvent.click(screen.getByText('All Keywords & Pages'));

    // Position 6.3 → ≤10 → text-accent-success
    const posSpan = screen.getByText('6.3').closest('span') ?? screen.getByText('6.3');
    expect((posSpan as HTMLElement).className).toContain('text-accent-success');
    expect((posSpan as HTMLElement).className).not.toContain('text-emerald-400');
  });
});
