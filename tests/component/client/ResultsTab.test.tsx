import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResultsTab } from '../../../src/components/client/ResultsTab';
import { useClientROI } from '../../../src/hooks/client';
import type { ROIData } from '../../../shared/types/roi';

vi.mock('../../../src/hooks/client', () => ({
  useClientROI: vi.fn(),
}));

vi.mock('../../../src/components/client/BetaContext', () => ({
  useBetaMode: () => false,
}));

const mockedUseClientROI = vi.mocked(useClientROI);

type Tier = 'free' | 'growth' | 'premium';

function makeROIData(overrides: Partial<ROIData> = {}): ROIData {
  return {
    organicTrafficValue: 1234,
    adSpendEquivalent: 1481,
    growthPercent: 8.4,
    revenueAtStake: 2200,
    pageBreakdown: [
      {
        pagePath: '/services',
        pageTitle: 'Services',
        primaryKeyword: 'seo services',
        clicks: 120,
        impressions: 2400,
        cpc: 4.25,
        trafficValue: 510,
        position: 7.2,
      },
    ],
    totalClicks: 120,
    totalImpressions: 2400,
    avgCPC: 4.25,
    trackedPages: 1,
    contentROI: {
      totalContentSpend: 300,
      totalContentValue: 1200,
      roi: 300,
      postsPublished: 2,
    },
    contentItems: [],
    computedAt: '2026-06-11T12:00:00.000Z',
    ...overrides,
  };
}

function mockROI(data: ROIData | null = makeROIData()) {
  mockedUseClientROI.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  } as unknown as ReturnType<typeof useClientROI>);
}

function renderResults(tier: Tier = 'growth') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ResultsTab workspaceId="ws-results" tier={tier} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ResultsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockROI();
  });

  it('renders the promoted ROI Results surface without throwing', () => {
    renderResults('growth');
    // Evergreen ROIDashboard renders its methodology disclosure + traffic-value content.
    expect(screen.getByTestId('roi-methodology')).toBeInTheDocument();
    expect(screen.getByText('Traffic Value by Page')).toBeInTheDocument();
  });

  it('passes tier through (free tier shows the gated ROI Dashboard surface)', () => {
    renderResults('free');
    expect(screen.getAllByText('ROI Dashboard').length).toBeGreaterThan(0);
  });
});
