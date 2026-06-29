import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LocalPresencePage } from '../../src/components/local-seo/LocalPresencePage';
import type { LocalSeoReadResponse } from '../../shared/types/local-seo';

const localSeoData: LocalSeoReadResponse = {
  featureEnabled: true,
  settings: {
    workspaceId: 'ws-1',
    posture: 'local',
    postureSource: 'admin_override',
    suggestionReasons: [],
    updatedAt: '2026-06-20T12:00:00.000Z',
  },
  markets: [
    {
      id: 'market-austin',
      workspaceId: 'ws-1',
      label: 'Austin, TX',
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
      source: 'admin_override',
      status: 'active',
      createdAt: '2026-06-20T12:00:00.000Z',
      updatedAt: '2026-06-20T12:00:00.000Z',
    },
  ],
  suggestedMarkets: [],
  latestSnapshots: [],
  report: {
    workspacePosture: 'local',
    activeMarketCount: 1,
    configuredMarketCount: 1,
    suggestedMarketCount: 0,
    latestSnapshotCount: 1,
    checkedKeywordCount: 12,
    visibleCount: 5,
    possibleMatchCount: 2,
    notVisibleCount: 5,
    localPackPresentCount: 8,
    degradedCount: 0,
    lastCapturedAt: '2026-06-20T12:00:00.000Z',
    setupState: 'has_data',
    setupLabel: 'Local visibility ready',
    setupDetail: 'Local visibility has recent market-specific evidence.',
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

const featureFlagMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('../../src/hooks/admin', () => ({
  useLocalSeo: () => ({
    data: localSeoData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useLocalSeoUpdate: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useLocalSeoLocationLookup: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useLocalSeoLocations: () => ({ data: [], isLoading: false, isError: false }),
  useSetPrimaryMarket: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useGbpReviews: () => ({
    data: {
      owned: {
        title: 'Acme Austin',
        rating: 4.7,
        reviewCount: 18,
        category: 'Marketing agency',
        attributes: ['Identifies as women-owned'],
        totalPhotos: 6,
      },
      competitors: [
        {
          title: 'Austin Local Leader',
          rating: 4.8,
          reviewCount: 42,
          category: 'Marketing agency',
          attributes: [],
          totalPhotos: 3,
        },
      ],
      completenessScore: 88,
    },
  }),
  useLocalGbpRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...args),
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ findActiveJob: () => null }),
}));

vi.mock('../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useRankTrackingAddKeyword: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useRankTrackingTogglePin: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

function renderPage(initialEntry = '/ws/ws-1/local-seo') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocalPresencePage workspaceId="ws-1" />
    </MemoryRouter>,
  );
}

describe('LocalPresencePage', () => {
  beforeEach(() => {
    featureFlagMock.mockReturnValue(true);
  });

  it('renders the Local Presence shell with all four tabs', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Local Presence' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /visibility/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /reviews/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /setup/i })).toBeInTheDocument();
    expect(screen.getByText('Local operating status')).toBeInTheDocument();
  });

  it('does not show GBP review framing on Overview when local-gbp is off', () => {
    featureFlagMock.mockReturnValue(false);
    renderPage();

    expect(screen.getByText('Local packs')).toBeInTheDocument();
    expect(screen.getByText('Local pack coverage')).toBeInTheDocument();
    expect(screen.queryByText('Review count')).not.toBeInTheDocument();
    expect(screen.queryByText('Reviews vs competitors')).not.toBeInTheDocument();
    expect(screen.queryByText('GBP aggregate')).not.toBeInTheDocument();
  });

  it('initializes from the ?tab= receiver and renders reviews under the existing GBP gate', () => {
    renderPage('/ws/ws-1/local-seo?tab=reviews');

    expect(screen.getByRole('tab', { name: /reviews/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Reviews vs competitors')).toBeInTheDocument();
    expect(screen.getByText('Acme Austin')).toBeInTheDocument();
  });

  it('switches to the existing workspace-level visibility workflow', () => {
    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: /visibility/i }));

    expect(screen.getByText('Local Keyword Visibility')).toBeInTheDocument();
    expect(screen.getByText('Keyword visibility lives in Keywords')).toBeInTheDocument();
  });

  it('keeps location CRUD in Business Footprint during Phase 1 setup', () => {
    renderPage('/ws/ws-1/local-seo?tab=setup');

    expect(screen.getByText('Location records still live in Brand & AI for this phase. GBP account linking comes in the OAuth foundation phase.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open location records/i })).toBeInTheDocument();
  });
});
