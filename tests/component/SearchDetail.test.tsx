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
});
