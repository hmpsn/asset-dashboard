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

vi.mock('../../src/hooks/admin/useGoogleBusinessProfile', () => ({
  useWorkspaceGbpMappings: () => ({
    data: {
      connection: {
        configured: true,
        connected: true,
        status: 'connected',
        scopes: ['https://www.googleapis.com/auth/business.manage'],
        accountCount: 1,
        locationCount: 2,
        mappedLocationCount: 1,
        needsReconnect: false,
      },
      locations: [
        {
          id: 'locations/1',
          connectionId: 'conn-1',
          accountId: 'accounts/1',
          accountResourceName: 'accounts/1',
          resourceName: 'locations/1',
          title: 'Acme Austin',
          addressLines: [],
          syncStatus: 'available',
          syncedAt: '2026-06-29T12:00:00.000Z',
        },
        {
          id: 'locations/2',
          connectionId: 'conn-1',
          accountId: 'accounts/1',
          accountResourceName: 'accounts/1',
          resourceName: 'locations/2',
          title: 'Acme Round Rock',
          addressLines: [],
          syncStatus: 'available',
          syncedAt: '2026-06-29T12:00:00.000Z',
        },
      ],
      mappings: [
        {
          workspaceId: 'ws-1',
          clientLocationId: 'loc-1',
          googleLocationId: 'locations/1',
          isPrimary: true,
          createdAt: '2026-06-29T12:00:00.000Z',
          updatedAt: '2026-06-29T12:00:00.000Z',
          location: {
            id: 'locations/1',
            connectionId: 'conn-1',
            accountId: 'accounts/1',
            accountResourceName: 'accounts/1',
            resourceName: 'locations/1',
            title: 'Acme Austin',
            addressLines: [],
            syncStatus: 'available',
            syncedAt: '2026-06-29T12:00:00.000Z',
          },
        },
      ],
    },
    isLoading: false,
    isError: false,
  }),
  useGbpAuthenticatedReviews: () => ({
    data: {
      connection: {
        configured: true,
        connected: true,
        status: 'connected',
        scopes: ['https://www.googleapis.com/auth/business.manage'],
        accountCount: 1,
        locationCount: 2,
        mappedLocationCount: 1,
        needsReconnect: false,
      },
      mappedLocationCount: 1,
      locations: [
        {
          googleLocationId: 'locations/1',
          clientLocationId: 'loc-1',
          isPrimary: true,
          location: {
            id: 'locations/1',
            connectionId: 'conn-1',
            accountId: 'accounts/1',
            accountResourceName: 'accounts/1',
            resourceName: 'locations/1',
            title: 'Acme Austin',
            addressLines: [],
            syncStatus: 'available',
            syncedAt: '2026-06-29T12:00:00.000Z',
          },
          syncStatus: 'synced',
          lastSyncedAt: '2026-06-29T12:00:00.000Z',
          averageRating: 4.8,
          totalReviewCount: 42,
          storedReviewCount: 2,
          newestReviewAt: '2026-06-29T12:00:00.000Z',
          unansweredCount: 1,
          lowRatingCount: 1,
        },
      ],
      recentReviews: [
        {
          id: 'review-1',
          googleLocationId: 'locations/1',
          clientLocationId: 'loc-1',
          reviewResourceName: 'accounts/1/locations/1/reviews/review-1',
          reviewId: 'review-1',
          rating: 'TWO',
          ratingValue: 2,
          commentExcerpt: 'Service was slow but helpful.',
          reviewerIsAnonymous: false,
          updateTime: '2026-06-29T12:00:00.000Z',
          hasReply: false,
          syncedAt: '2026-06-29T12:00:00.000Z',
        },
      ],
      aggregate: {
        averageRating: 4.8,
        totalReviewCount: 42,
        storedReviewCount: 2,
        unansweredCount: 1,
        lowRatingCount: 1,
        newestReviewAt: '2026-06-29T12:00:00.000Z',
        lastSyncedAt: '2026-06-29T12:00:00.000Z',
      },
      copyPolicy: {
        rawReviewTextStored: true,
        aiUseAllowed: false,
        guidance: 'Authenticated review text is stored for admin triage only in Phase 2B.',
      },
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useSyncGbpAuthenticatedReviews: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
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
    expect(screen.getByText('Authenticated GBP')).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 discovered Google Business Profile locations/)).toBeInTheDocument();
    expect(screen.getByText('Authenticated reviews')).toBeInTheDocument();
    expect(screen.getByText('Service was slow but helpful.')).toBeInTheDocument();
    expect(screen.getByText('Reviews vs competitors')).toBeInTheDocument();
    expect(screen.getAllByText('Acme Austin').length).toBeGreaterThanOrEqual(1);
  });

  it('switches to the existing workspace-level visibility workflow', () => {
    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: /visibility/i }));

    expect(screen.getByText('Local Keyword Visibility')).toBeInTheDocument();
    expect(screen.getByText('Keyword visibility lives in Keywords')).toBeInTheDocument();
  });

  it('keeps location CRUD in Business Footprint while surfacing Phase 2A GBP mapping status', () => {
    renderPage('/ws/ws-1/local-seo?tab=setup');

    expect(screen.getByText('Authenticated GBP')).toBeInTheDocument();
    expect(screen.getByText(/Authenticated GBP locations map to those records/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open location records/i })).toBeInTheDocument();
  });
});
