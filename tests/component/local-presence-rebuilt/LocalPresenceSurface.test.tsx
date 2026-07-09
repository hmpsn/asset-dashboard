// @ds-rebuilt
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/components/Toast';
import { LocalPresenceReviewsPipeline } from '../../../src/components/local-presence-rebuilt/LocalPresenceReviewsPipeline';
import { LocalPresenceSurface } from '../../../src/components/local-presence-rebuilt/LocalPresenceSurface';
import { queryKeys } from '../../../src/lib/queryKeys';
import {
  LOCAL_SEO_MARKET_SOURCE,
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_POSTURE,
  LOCAL_SEO_POSTURE_SOURCE,
  type LocalSeoReadResponse,
} from '../../../shared/types/local-seo';
import {
  GBP_CONNECTION_STATUSES,
  GBP_LOCATION_SYNC_STATUSES,
  GBP_REVIEW_RATINGS,
  GBP_REVIEW_RESPONSE_STATUSES,
  GBP_REVIEW_SYNC_STATUSES,
  type GbpAuthenticatedReviewsRead,
  type GbpConnectionSafe,
  type GbpLocationSummary,
  type GbpReviewResponseReviewContext,
  type GbpReviewResponseSummary,
  type GbpReviewResponseWorkflowRead,
  type WorkspaceGbpMappingRead,
} from '../../../shared/types/google-business-profile';
import type { GbpReviewsReadResponse } from '../../../src/api/localSeo';
import { expectNoA11yViolations } from '../a11y';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  addKeywordMutate: vi.fn(),
  featureFlagsList: vi.fn(),
  workspaceHandlers: {} as Record<string, () => void>,
}));

vi.mock('../../../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/client')>('../../../src/api/client');
  return {
    ...actual,
    post: (...args: unknown[]) => mocks.apiPost(...args),
  };
});

vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      list: () => mocks.featureFlagsList(),
    },
  };
});

vi.mock('../../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useRankTrackingAddKeyword: () => ({
    mutate: mocks.addKeywordMutate,
    isPending: false,
    error: null,
  }),
}));

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (_workspaceId: string, handlers: Record<string, () => void>) => {
    mocks.workspaceHandlers = handlers;
    return { send: vi.fn() };
  },
}));

vi.mock('../../../src/components/local-seo/LocalSeoMarketSetupDrawer', () => ({
  LocalSeoMarketSetupDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="local-seo-market-setup-drawer">Market setup drawer</div> : null,
}));

vi.mock('../../../src/components/local-seo/LocalSeoVisibilityPanel', () => ({
  LocalSeoVisibilityPanel: () => <div data-testid="legacy-local-seo-visibility-panel">Legacy visibility panel</div>,
}));

const workspaceId = 'ws-local-presence-rebuilt';
const now = '2026-07-06T16:30:00.000Z';

const localSeoRead: LocalSeoReadResponse = {
  featureEnabled: true,
  settings: {
    workspaceId,
    posture: LOCAL_SEO_POSTURE.LOCAL,
    postureSource: LOCAL_SEO_POSTURE_SOURCE.ADMIN_OVERRIDE,
    suggestionReasons: ['Configured local market'],
    updatedAt: now,
    keywordsPerRefresh: null,
  },
  markets: [
    {
      id: 'market-austin',
      workspaceId,
      label: 'Austin, TX',
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
      isPrimary: true,
      source: LOCAL_SEO_MARKET_SOURCE.ADMIN_OVERRIDE,
      status: LOCAL_SEO_MARKET_STATUS.ACTIVE,
      createdAt: now,
      updatedAt: now,
    },
  ],
  suggestedMarkets: [],
  latestSnapshots: [],
  report: {
    workspacePosture: LOCAL_SEO_POSTURE.LOCAL,
    activeMarketCount: 1,
    configuredMarketCount: 1,
    suggestedMarketCount: 0,
    latestSnapshotCount: 4,
    checkedKeywordCount: 4,
    visibleCount: 1,
    possibleMatchCount: 1,
    notVisibleCount: 2,
    localPackPresentCount: 4,
    degradedCount: 0,
    lastCapturedAt: now,
    setupState: 'has_data',
    setupLabel: 'Local visibility reporting is active',
    setupDetail: 'Market-specific local-pack visibility is available from retained snapshots.',
  },
  competitorBrands: [
    {
      title: 'Map Pack Rival',
      domain: 'rival.example',
      totalAppearances: 2,
      winsAgainstClient: 1,
      markets: ['Austin, TX'],
      suggestedTrackingKeywords: ['Map Pack Rival reviews'],
      mapPackShareOfVoicePct: 50,
      mapPackShareOfVoiceBasis: 4,
    },
  ] as unknown as LocalSeoReadResponse['competitorBrands'],
  serviceGaps: [],
  visibilityTrend: [
    {
      marketId: 'market-austin',
      marketLabel: 'Austin, TX',
      points: [
        { date: '2026-07-05', visibleCount: 1, checkedCount: 4 },
        { date: '2026-07-06', visibleCount: 2, checkedCount: 4 },
      ],
    },
  ],
  caps: {
    maxMarkets: 8,
    maxKeywordsPerRefresh: 100,
    keywordsPerRefreshMin: 25,
    keywordsPerRefreshMax: 300,
    keywordsPerRefreshDefault: 100,
  },
};

const gbpAggregate: GbpReviewsReadResponse = {
  owned: {
    placeId: 'place-owned',
    title: 'Austin Office',
    isOwned: true,
    rating: 4.8,
    reviewCount: 42,
    category: 'Dental clinic',
    attributes: ['Online appointments'],
    totalPhotos: 12,
    claimed: true,
  },
  competitors: [
    {
      placeId: 'place-rival',
      title: 'Map Pack Rival',
      rating: 4.9,
      reviewCount: 80,
      attributes: [],
    },
  ],
  completenessScore: 76,
};

const featureFlagResponse = {
  'local-gbp': true,
  'gbp-auth-connection': true,
  'gbp-auth-reviews': true,
  'gbp-review-responses': true,
};

const connection: GbpConnectionSafe = {
  configured: true,
  connected: true,
  status: GBP_CONNECTION_STATUSES.CONNECTED,
  connectionId: 'gbp-connection',
  scopes: ['https://www.googleapis.com/auth/business.manage'],
  accountCount: 1,
  locationCount: 1,
  mappedLocationCount: 1,
  needsReconnect: false,
};

const gbpLocation: GbpLocationSummary = {
  id: 'gbp-location',
  connectionId: 'gbp-connection',
  accountId: 'gbp-account',
  accountResourceName: 'accounts/1',
  resourceName: 'locations/1',
  title: 'Austin Office',
  addressLines: ['100 Congress Ave'],
  locality: 'Austin',
  administrativeArea: 'TX',
  regionCode: 'US',
  syncStatus: GBP_LOCATION_SYNC_STATUSES.MAPPED,
  syncedAt: now,
};

function createQueryClient(seedFeatureFlags = true): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  if (seedFeatureFlags) client.setQueryData(queryKeys.shared.featureFlags(), featureFlagResponse);
  client.setQueryData(queryKeys.admin.localSeoVariant(workspaceId, false), localSeoRead);
  client.setQueryData(queryKeys.admin.localGbpReviews(workspaceId), gbpAggregate);
  return client;
}

function createReview(overrides: Partial<GbpReviewResponseReviewContext> = {}): GbpReviewResponseReviewContext {
  const resourceName = overrides.reviewResourceName ?? 'accounts/1/locations/1/reviews/review-eligible';
  return {
    id: `stored-${resourceName.split('/').at(-1) ?? 'review'}`,
    googleLocationId: 'gbp-location',
    clientLocationId: 'client-location',
    reviewResourceName: resourceName,
    reviewId: resourceName.split('/').at(-1) ?? 'review',
    rating: GBP_REVIEW_RATINGS.FIVE,
    ratingValue: 5,
    commentExcerpt: 'Helpful local team and clear communication.',
    commentText: 'Helpful local team and clear communication.',
    reviewerDisplayName: 'Sam Local',
    reviewerIsAnonymous: false,
    createTime: '2026-07-01T12:00:00.000Z',
    updateTime: '2026-07-01T12:10:00.000Z',
    hasReply: false,
    syncedAt: now,
    locationTitle: 'Austin Office',
    ...overrides,
  };
}

function createResponse(
  id: string,
  status: GbpReviewResponseSummary['status'],
  review: GbpReviewResponseReviewContext,
): GbpReviewResponseSummary {
  return {
    id,
    workspaceId,
    reviewResourceName: review.reviewResourceName,
    googleLocationId: review.googleLocationId,
    clientLocationId: review.clientLocationId,
    status,
    draftText: 'Thank you for sharing this feedback. We appreciate the chance to help locally.',
    editedText: status === GBP_REVIEW_RESPONSE_STATUSES.CHANGES_REQUESTED
      ? 'Thank you for the feedback. We updated this response for clarity.'
      : undefined,
    createdAt: now,
    updatedAt: now,
    review,
  };
}

function seedReviewQueries(client: QueryClient) {
  const mappingRead: WorkspaceGbpMappingRead = {
    connection,
    locations: [gbpLocation],
    mappings: [
      {
        workspaceId,
        clientLocationId: 'client-location',
        googleLocationId: gbpLocation.id,
        isPrimary: true,
        createdAt: now,
        updatedAt: now,
        location: gbpLocation,
      },
    ],
  };
  const authenticatedReviews: GbpAuthenticatedReviewsRead = {
    connection,
    mappedLocationCount: 1,
    locations: [
      {
        googleLocationId: gbpLocation.id,
        clientLocationId: 'client-location',
        isPrimary: true,
        location: gbpLocation,
        syncStatus: GBP_REVIEW_SYNC_STATUSES.SYNCED,
        lastSyncedAt: now,
        averageRating: 4.8,
        totalReviewCount: 42,
        storedReviewCount: 8,
        unansweredCount: 1,
        lowRatingCount: 0,
      },
    ],
    recentReviews: [],
    aggregate: {
      averageRating: 4.8,
      totalReviewCount: 42,
      storedReviewCount: 8,
      unansweredCount: 1,
      lowRatingCount: 0,
      lastSyncedAt: now,
    },
    copyPolicy: {
      rawReviewTextStored: true,
      aiUseAllowed: true,
      guidance: 'Use public-safe language for replies.',
    },
  };
  const eligibleReview = createReview();
  const workflowRead: GbpReviewResponseWorkflowRead = {
    connection,
    eligibleReviews: [eligibleReview],
    responses: [
      createResponse('response-draft', GBP_REVIEW_RESPONSE_STATUSES.DRAFT, createReview({ reviewResourceName: 'accounts/1/locations/1/reviews/review-draft' })),
      createResponse('response-declined', GBP_REVIEW_RESPONSE_STATUSES.DECLINED, createReview({ reviewResourceName: 'accounts/1/locations/1/reviews/review-declined', reviewerDisplayName: 'Declined Reviewer' })),
      createResponse('response-cancelled', GBP_REVIEW_RESPONSE_STATUSES.CANCELLED, createReview({ reviewResourceName: 'accounts/1/locations/1/reviews/review-cancelled', reviewerDisplayName: 'Cancelled Reviewer' })),
    ],
    policy: {
      rawReviewTextUsedForDraftingOnly: true,
      guidance: 'Do not invent facts about the reviewer.',
    },
  };

  client.setQueryData(queryKeys.admin.gbpWorkspaceMappings(workspaceId), mappingRead);
  client.setQueryData(queryKeys.admin.gbpAuthenticatedReviews(workspaceId), authenticatedReviews);
  client.setQueryData(queryKeys.admin.gbpReviewResponses(workspaceId), workflowRead);
}

function renderWithProviders(
  ui: ReactElement,
  client = createQueryClient(),
  route = `/ws/${workspaceId}/local-seo?lens=overview`,
) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          {ui}
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspaceHandlers = {};
  mocks.featureFlagsList.mockReturnValue(new Promise(() => {}));
  mocks.addKeywordMutate.mockImplementation((_keyword: string, options?: { onSuccess?: () => void; onSettled?: () => void }) => {
    options?.onSuccess?.();
    options?.onSettled?.();
  });
  mocks.apiPost.mockImplementation((url: string, body?: unknown) => {
    if (url.endsWith('/draft-and-send')) {
      return Promise.resolve({
        response: {
          ...createResponse('response-sent', GBP_REVIEW_RESPONSE_STATUSES.AWAITING_CLIENT, createReview({ reviewResourceName: (body as { reviewResourceName: string }).reviewResourceName })),
          sentDeliverableId: 'deliverable-1',
        },
        deliverable: { id: 'deliverable-1', type: 'gbp_review_response' },
      });
    }
    return Promise.resolve(createResponse('response-manual', GBP_REVIEW_RESPONSE_STATUSES.DRAFT, createReview({ reviewResourceName: (body as { reviewResourceName: string }).reviewResourceName })));
  });
});

describe('LocalPresenceSurface', () => {
  it('presents the prototype rank/profile and reviews modes without legacy peer tabs', async () => {
    renderWithProviders(<LocalPresenceSurface workspaceId={workspaceId} />);

    expect(await screen.findByRole('heading', { name: 'Local Presence' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Rank & profile/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Reviews & replies/i })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Overview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Visibility/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Setup/i })).not.toBeInTheDocument();
    expect(screen.getByText('Local operating status')).toBeInTheDocument();
    expect(screen.getAllByTestId('legacy-local-seo-visibility-panel')).toHaveLength(1);
  });

  it('maps rank/profile cockpit copy to styleguide typography roles', async () => {
    renderWithProviders(<LocalPresenceSurface workspaceId={workspaceId} />);

    expect(await screen.findByRole('heading', { name: 'Local Presence' })).toBeInTheDocument();
    expect(screen.getAllByText('Market-specific local-pack visibility is available from retained snapshots.').some((element) => element.classList.contains('t-body'))).toBe(true);
    expect(screen.getByText('Local visibility reporting is active')).toHaveClass('t-ui');
    expect(screen.getByText('Rating, reviews, and the three profile signals currently available.')).toHaveClass('t-body');
    expect(screen.getAllByText('Map Pack Rival').some((element) => element.classList.contains('t-ui'))).toBe(true);
    expect(screen.getAllByText('Austin, TX').some((element) => element.classList.contains('t-ui'))).toBe(true);
    expect(screen.getByText('2/4 visible on 2026-07-06')).toHaveClass('t-body');
  });

  it('keeps setup as a drawer-only compatibility state', async () => {
    renderWithProviders(
      <LocalPresenceSurface workspaceId={workspaceId} />,
      createQueryClient(),
      `/ws/${workspaceId}/local-seo?tab=setup`,
    );

    expect(await screen.findByRole('heading', { name: 'Local Presence' })).toBeInTheDocument();
    expect(await screen.findByTestId('local-seo-market-setup-drawer')).toBeInTheDocument();
    expect(screen.queryByText('Markets and refresh settings')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Rank & profile/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('maps legacy visibility links into the rank/profile workspace exactly once', async () => {
    renderWithProviders(
      <LocalPresenceSurface workspaceId={workspaceId} />,
      createQueryClient(),
      `/ws/${workspaceId}/local-seo?lens=visibility`,
    );

    expect(await screen.findByRole('radio', { name: /Rank & profile/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByTestId('legacy-local-seo-visibility-panel')).toHaveLength(1);
    expect(screen.getByText('confident matches')).toBeInTheDocument();
  });

  it('switches to Reviews & replies from the rank/profile workspace', async () => {
    const client = createQueryClient();
    seedReviewQueries(client);
    renderWithProviders(<LocalPresenceSurface workspaceId={workspaceId} />, client);

    fireEvent.click(await screen.findByRole('radio', { name: /Reviews & replies/i }));

    expect(await screen.findByText('Review response pipeline')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Reviews & replies/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('legacy-local-seo-visibility-panel')).not.toBeInTheDocument();
  });

  it('mounts through a real feature-flag loading to loaded transition', async () => {
    const client = createQueryClient(false);
    renderWithProviders(<LocalPresenceSurface workspaceId={workspaceId} />, client);

    expect(await screen.findByRole('heading', { name: 'Local Presence' })).toBeInTheDocument();
    expect(screen.getAllByText('Local packs').length).toBeGreaterThan(0);

    act(() => {
      client.setQueryData(queryKeys.shared.featureFlags(), featureFlagResponse);
    });

    await waitFor(() => expect(screen.getAllByText('Reviews').length).toBeGreaterThan(0));
    expect(screen.getByRole('radio', { name: /Rank & profile/i })).toBeInTheDocument();
  });

  it('keeps flag-off reviews availability copy user-facing', async () => {
    const client = createQueryClient(false);
    renderWithProviders(<LocalPresenceSurface workspaceId={workspaceId} />, client);

    fireEvent.click(await screen.findByRole('radio', { name: /Reviews & replies/i }));

    expect(await screen.findByText('Google Business Profile connection is not enabled')).toBeInTheDocument();
    expect(screen.getByText(/not available for this workspace yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/backend feature lifecycle|backend lifecycle|feature flag|response flag/i)).not.toBeInTheDocument();
  });

  it('renders real local posture and map-pack share-of-voice without a verified badge or internal terms', async () => {
    const { container } = renderWithProviders(<LocalPresenceSurface workspaceId={workspaceId} />);

    expect(await screen.findByRole('heading', { name: 'Local Presence' })).toBeInTheDocument();
    expect(screen.getByText('Map Pack Rival')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();

    // a11y floor (ds-rebuilt-a11y-coverage contract): assert no axe violations once the
    // surface has settled (no skeleton shimmer mid-render — see batch-1 a11y-flake lesson).
    await waitFor(() => expect(container.querySelectorAll('.animate-pulse').length).toBe(0));
    await expectNoA11yViolations(container);

    expect(screen.queryByText(/provider degraded|setup-state reads|backend feature lifecycle|rebuild|migration|carry-over/i)).not.toBeInTheDocument();
    expect(await screen.findByTestId('legacy-local-seo-visibility-panel')).toBeInTheDocument();
    expect(screen.getByText('confident matches')).toBeInTheDocument();
  });

  it('renders declined and cancelled review states and calls manual draft routes', async () => {
    const client = createQueryClient();
    seedReviewQueries(client);
    renderWithProviders(
      <LocalPresenceReviewsPipeline
        workspaceId={workspaceId}
        desk="all"
        setDesk={vi.fn()}
        search=""
      />,
      client,
    );

    expect(await screen.findByText('Review response pipeline')).toBeInTheDocument();
    expect(screen.getAllByText('Declined').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Closed').length).toBeGreaterThanOrEqual(2);

    const manualText = 'Thank you for sharing this review. We appreciate your local feedback and look forward to helping again.';
    const noteText = 'Please approve this public reply.';
    fireEvent.change(screen.getByLabelText(/Manual draft for 5 star from Sam Local/i), {
      target: { value: manualText },
    });
    fireEvent.change(screen.getByLabelText(/Client note for 5 star from Sam Local/i), {
      target: { value: noteText },
    });

    fireEvent.click(screen.getByRole('button', { name: /Save manual/i }));

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith(
        `/api/google-business-profile/workspaces/${workspaceId}/review-responses/manual-draft`,
        {
          reviewResourceName: 'accounts/1/locations/1/reviews/review-eligible',
          draftText: manualText,
        },
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /Draft and send/i }));

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith(
        `/api/google-business-profile/workspaces/${workspaceId}/review-responses/draft-and-send`,
        {
          reviewResourceName: 'accounts/1/locations/1/reviews/review-eligible',
          draftText: manualText,
          note: noteText,
        },
      );
    });
  });
});
