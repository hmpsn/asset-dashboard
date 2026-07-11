import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSeoReadResponse } from '../../../shared/types/local-seo';
import type { UnifiedPage } from '../../../shared/types/page-join';

const mocks = vi.hoisted(() => ({
  localSeoData: null as LocalSeoReadResponse | null,
  openKeywords: vi.fn(),
}));

vi.mock('../../../src/hooks/admin', () => ({
  useWorkspaces: () => ({
    data: [{ id: 'ws-1', name: 'Acme', webflowSiteId: 'site-1' }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useKeywordStrategy: () => ({ data: { strategy: null }, isLoading: false, isError: false }),
  usePageJoin: () => ({
    pages: [PAGE],
    strategyPages: [PAGE],
    webflowPages: [PAGE],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useLocalSeo: () => ({
    data: mocks.localSeoData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeo: () => ({
    data: mocks.localSeoData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useRankTrackingAddKeyword: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ findActiveJob: () => null }),
}));

vi.mock('../../../src/components/page-intelligence/usePageIntelligenceAnalysis', () => ({
  usePageIntelligenceAnalysis: () => ({
    analyses: {},
    contentScores: {},
    analyzing: new Set<string>(),
    bulkProgress: null,
    cancellableBulkJobId: null,
    analysisError: null,
    showNextSteps: false,
    analyzePage: vi.fn(),
    analyzeAllPages: vi.fn(),
    cancelBulkJob: vi.fn(),
    dismissAnalysisError: vi.fn(),
    dismissNextSteps: vi.fn(),
  }),
}));

vi.mock('../../../src/components/page-intelligence/usePageIntelligenceKeywordEditing', () => ({
  usePageIntelligenceKeywordEditing: () => ({}),
}));

vi.mock('../../../src/components/page-intelligence/usePageIntelligenceKeywordTracking', () => ({
  usePageIntelligenceKeywordTracking: () => ({}),
}));

vi.mock('../../../src/components/page-intelligence/usePageIntelligenceSeoCopy', () => ({
  usePageIntelligenceSeoCopy: () => ({}),
}));

vi.mock('../../../src/components/page-intelligence/PageIntelligenceStrategySection', () => ({
  PageIntelligenceStrategySection: () => <div>Mapped keyword evidence</div>,
}));

vi.mock('../../../src/components/page-intelligence/PageIntelligenceAnalysisSection', () => ({
  PageIntelligenceAnalysisSection: () => null,
}));

vi.mock('../../../src/components/page-intelligence/PageIntelligencePersistedAnalysisSummary', () => ({
  PageIntelligencePersistedAnalysisSummary: () => null,
}));

import { LocalSeoVisibilityPanel } from '../../../src/components/local-seo/LocalSeoVisibilityPanel';
import { PageIntelligenceSurface } from '../../../src/components/page-intelligence-rebuilt/PageIntelligenceSurface';

const PAGE: UnifiedPage = {
  id: 'page-services',
  title: 'Services',
  path: '/services',
  slug: 'services',
  source: 'static',
  analyzed: false,
  strategy: {
    pagePath: '/services',
    pageTitle: 'Services',
    primaryKeyword: 'custom sofas',
    secondaryKeywords: ['made to order sofa'],
    searchIntent: 'commercial',
    optimizationScore: 78,
  },
};

function makeLocalSeoData(): LocalSeoReadResponse {
  return {
    featureEnabled: true,
    settings: {
      workspaceId: 'ws-1',
      posture: 'unknown',
      postureSource: 'unknown',
      suggestedPosture: 'local',
      suggestionReasons: [],
      updatedAt: '2026-07-11T00:00:00.000Z',
    },
    markets: [],
    suggestedMarkets: [],
    latestSnapshots: [],
    report: {
      workspacePosture: 'unknown',
      suggestedPosture: 'local',
      activeMarketCount: 1,
      configuredMarketCount: 1,
      suggestedMarketCount: 0,
      latestSnapshotCount: 1,
      checkedKeywordCount: 1,
      visibleCount: 1,
      possibleMatchCount: 0,
      notVisibleCount: 0,
      localPackPresentCount: 1,
      degradedCount: 0,
      setupState: 'has_data',
      setupLabel: 'Local visibility ready',
      setupDetail: 'Use Keywords to inspect local visibility by keyword.',
    },
    caps: {
      maxMarkets: 3,
      maxKeywordsPerRefresh: 100,
      keywordsPerRefreshMin: 25,
      keywordsPerRefreshMax: 300,
      keywordsPerRefreshDefault: 100,
    },
    competitorBrands: [],
    serviceGaps: [],
    visibilityTrend: [],
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderSurface() {
  return render(
    <MemoryRouter initialEntries={['/ws/ws-1/page-intelligence']}>
      <Routes>
        <Route
          path="/ws/:workspaceId/page-intelligence"
          element={(
            <>
              <PageIntelligenceSurface workspaceId="ws-1" />
              <LocationProbe />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Page Intelligence responsive flow contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.localSeoData = makeLocalSeoData();
  });

  it('keeps the list → detail → back transition URL-backed with one detail action home', async () => {
    // jsdom exercises selection and route state only; breakpoint visibility remains browser-verified.
    renderSurface();

    expect(screen.queryByRole('button', { name: 'Back to pages' })).not.toBeInTheDocument();
    const inventory = screen.getByLabelText('Page inventory');
    fireEvent.click(within(inventory).getByRole('button', { name: /Services/ }));

    expect(await screen.findByRole('heading', { name: 'Services', level: 2 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent('?page=page-services'));
    expect(screen.getAllByRole('button', { name: 'Back to pages' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Fix in SEO Editor' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Back to pages' }));

    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent(/^$/));
    expect(screen.queryByRole('button', { name: 'Back to pages' })).not.toBeInTheDocument();
    expect(within(inventory).getByRole('button', { name: /Services/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the page annotation Open Keywords capability in one actionable location', () => {
    render(
      <MemoryRouter>
        <LocalSeoVisibilityPanel workspaceId="ws-1" mode="page" onOpenKeywords={mocks.openKeywords} />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('button', { name: 'Open Keywords' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open Keywords' }));
    expect(mocks.openKeywords).toHaveBeenCalledTimes(1);
  });
});
