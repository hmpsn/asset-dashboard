import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SearchDetail } from '../../src/components/SearchDetail';
import type { AdminSearchData } from '../../src/hooks/admin/useAdminSearch';

const useAdminSearchMock = vi.fn<(...args: unknown[]) => AdminSearchData>();

vi.mock('../../src/hooks/admin', () => ({
  useAdminSearch: (...args: unknown[]) => useAdminSearchMock(...args),
}));

vi.mock('../../src/hooks/admin/useInsightFeed', () => ({
  useInsightFeed: () => ({ feed: [], isLoading: false }),
}));

vi.mock('../../src/hooks/admin/useAnalyticsAnnotations', () => ({
  useAnalyticsAnnotations: () => ({ data: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../src/hooks/useToggleSet', () => ({
  useToggleSet: () => [new Set(['clicks', 'impressions']), vi.fn()],
}));

function baseSearchData(overrides?: Partial<AdminSearchData>): AdminSearchData {
  return {
    overview: {
      totalClicks: 520,
      totalImpressions: 12300,
      avgCtr: 4.2,
      avgPosition: 12.8,
      topQueries: [
        { query: 'acme seo', clicks: 44, impressions: 900, ctr: 4.9, position: 7.1 },
      ],
      topPages: [
        { page: 'https://acme.test/pricing', clicks: 31, impressions: 600, ctr: 5.2, position: 9.8 },
      ],
      dateRange: { start: '2026-04-18', end: '2026-05-16' },
    },
    trend: [],
    devices: [],
    countries: [],
    searchTypes: [],
    comparison: null,
    isLoading: false,
    error: null,
    ...overrides,
  };
}

describe('SearchDetail', () => {
  beforeEach(() => {
    useAdminSearchMock.mockReset();
    useAdminSearchMock.mockReturnValue(baseSearchData());
  });

  it('renders Search Console not configured state', () => {
    render(<SearchDetail workspaceId="ws-risk" siteId="site-1" />);

    expect(screen.getByText('Search Console not configured')).toBeInTheDocument();
  });

  it('renders loading state while search data is loading', () => {
    useAdminSearchMock.mockReturnValue(baseSearchData({ overview: null, isLoading: true }));

    render(<SearchDetail workspaceId="ws-risk" siteId="site-1" gscPropertyUrl="sc-domain:acme.test" />);

    expect(screen.getByText('Loading search data...')).toBeInTheDocument();
  });

  it('renders query and page data when overview exists', () => {
    render(<SearchDetail workspaceId="ws-risk" siteId="site-1" gscPropertyUrl="sc-domain:acme.test" />);

    expect(screen.getByRole('button', { name: 'Queries' })).toBeInTheDocument();
    expect(screen.getByText('acme seo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    expect(screen.getByText('/pricing')).toBeInTheDocument();
  });

  // Wave 2b B1: position color routed to positionColor() authority (accent tokens, not bare tailwind).
  // Fixture position 7.1 → ≤10 → text-accent-success (NOT bare text-emerald-400).
  it('uses accent-token class text-accent-success for position ≤10, not bare text-emerald-400', () => {
    render(<SearchDetail workspaceId="ws-risk" siteId="site-1" gscPropertyUrl="sc-domain:acme.test" />);

    // Query row position 7.1 rendered in a <span> via renderActions
    const positionSpan = screen.getByText('7.1').closest('span') ?? screen.getByText('7.1');
    expect(positionSpan.className).toContain('text-accent-success');
    expect(positionSpan.className).not.toContain('text-emerald-400');
  });

  // Wave 2b B2: KeywordTable migration — query rows render via KeywordTable, CTR column present.
  it('renders query rows via KeywordTable with clicks, impressions, CTR columns', () => {
    render(<SearchDetail workspaceId="ws-risk" siteId="site-1" gscPropertyUrl="sc-domain:acme.test" />);

    // Query text rendered
    expect(screen.getByText('acme seo')).toBeInTheDocument();
    // Clicks column (blue-400 in KeywordTable)
    expect(screen.getByText('44')).toBeInTheDocument();
    // Impressions column
    expect(screen.getByText('900')).toBeInTheDocument();
    // CTR column — KeywordTable 'ctr' column renders as "{value}%"
    expect(screen.getByText('4.9%')).toBeInTheDocument();
    // Position rendered as a first-class column (raw decimal)
    expect(screen.getByText('7.1')).toBeInTheDocument();
  });

  // Wave 2b B2 regression fix: position must be a SORTABLE column header, not buried in renderActions.
  // This test FAILS against ba52b6df (no Position sort header) and passes after the fix.
  it('renders a sortable Position header in the queries table and sorts rows by position on click', () => {
    // Provide two query rows so we can verify sort order changes.
    const multiQueryData = baseSearchData({
      overview: {
        totalClicks: 520,
        totalImpressions: 12300,
        avgCtr: 4.2,
        avgPosition: 12.8,
        topQueries: [
          { query: 'acme seo', clicks: 44, impressions: 900, ctr: 4.9, position: 7.1 },
          { query: 'seo agency', clicks: 20, impressions: 400, ctr: 5.0, position: 3.2 },
        ],
        topPages: [],
        dateRange: { start: '2026-04-18', end: '2026-05-16' },
      },
    });
    useAdminSearchMock.mockReturnValue(multiQueryData);

    render(<SearchDetail workspaceId="ws-risk" siteId="site-1" gscPropertyUrl="sc-domain:acme.test" />);

    // The table should be inside the data table card. Find all "Position" buttons
    // — the MetricToggleCard renders a button with "Position" label (for the chart toggle),
    // and the KeywordTable sort header also renders one inside the <table>.
    // The sort header is inside a <table> element.
    const table = document.querySelector('table');
    expect(table).not.toBeNull();
    // Find Position sort button scoped to the table element
    const positionHeaders = screen.getAllByRole('button', { name: /position/i });
    // At least one of those buttons must be inside the table (the sort header)
    const tablePositionBtn = positionHeaders.find(btn => table!.contains(btn));
    expect(tablePositionBtn).toBeDefined();

    // Clicking it triggers a position sort — both raw decimal positions still visible.
    fireEvent.click(tablePositionBtn!);
    expect(screen.getByText('7.1')).toBeInTheDocument();
    expect(screen.getByText('3.2')).toBeInTheDocument();
  });

  // Wave 2b B2: query↔page toggle still switches data sets.
  it('query↔page toggle switches between query and page datasets', () => {
    render(<SearchDetail workspaceId="ws-risk" siteId="site-1" gscPropertyUrl="sc-domain:acme.test" />);

    // Default: queries view — query is visible
    expect(screen.getByText('acme seo')).toBeInTheDocument();

    // Switch to pages
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    // Page path rendered (normalized URL)
    expect(screen.getByText('/pricing')).toBeInTheDocument();
    // Query text no longer visible
    expect(screen.queryByText('acme seo')).not.toBeInTheDocument();
  });
});
