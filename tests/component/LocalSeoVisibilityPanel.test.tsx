import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';
import { LocalSeoVisibilityPanel } from '../../src/components/local-seo/LocalSeoVisibilityPanel';
import type { LocalSeoReadResponse } from '../../shared/types/local-seo';

const updateMutateAsync = vi.fn();
const refreshMutate = vi.fn();
const refreshMutateAsync = vi.fn();
const locationLookupMutateAsync = vi.fn();
const localSeoRefetch = vi.fn();

let localSeoData: LocalSeoReadResponse | undefined;
let localSeoIsError = false;
let localSeoError: Error | null = null;

vi.mock('../../src/hooks/admin', () => ({
  useLocalSeo: () => ({
    data: localSeoData,
    isLoading: false,
    isError: localSeoIsError,
    error: localSeoError,
    refetch: localSeoRefetch,
  }),
  useLocalSeoRefresh: () => ({
    mutate: refreshMutate,
    mutateAsync: refreshMutateAsync,
    isPending: false,
    error: null,
  }),
  useLocalSeoUpdate: () => ({
    mutateAsync: updateMutateAsync,
    isPending: false,
    error: null,
  }),
  useLocalSeoLocationLookup: () => ({
    mutateAsync: locationLookupMutateAsync,
    isPending: false,
    error: null,
  }),
  useSetPrimaryMarket: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
  useLocalSeoLocations: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
  // P7 (local-gbp): GbpReviewsPanel mounts inside this panel. Return the empty readout so it
  // self-renders nothing here (its own behavior is covered by GbpReviewsPanel.test.tsx).
  useGbpReviews: () => ({ data: { owned: null, competitors: [], completenessScore: null } }),
  useLocalGbpRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ findActiveJob: () => null }),
}));

// Wave 1 added useRankTrackingAddKeyword to LocalSeoVisibilityPanel; mock it here so
// the test renderer doesn't need a QueryClientProvider wrapper.
vi.mock('../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useRankTrackingAddKeyword: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    error: null,
  }),
  useRankTrackingTogglePin: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

function makeReadResponse(overrides: Partial<LocalSeoReadResponse> = {}): LocalSeoReadResponse {
  const base: LocalSeoReadResponse = {
    featureEnabled: true,
    settings: {
      workspaceId: 'ws-1',
      posture: 'unknown',
      postureSource: 'unknown',
      suggestedPosture: 'local',
      suggestionReasons: ['Business profile has city/state contact evidence'],
      updatedAt: '2026-05-20T12:00:00.000Z',
    },
    markets: [],
    suggestedMarkets: [{
      id: 'business-profile-primary-market',
      workspaceId: 'ws-1',
      label: 'Austin, TX',
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
      source: 'business_profile',
      status: 'needs_review',
      createdAt: '2026-05-20T12:00:00.000Z',
      updatedAt: '2026-05-20T12:00:00.000Z',
    }],
    latestSnapshots: [],
    report: {
      workspacePosture: 'unknown',
      suggestedPosture: 'local',
      activeMarketCount: 0,
      configuredMarketCount: 0,
      suggestedMarketCount: 1,
      latestSnapshotCount: 0,
      checkedKeywordCount: 0,
      visibleCount: 0,
      possibleMatchCount: 0,
      notVisibleCount: 0,
      localPackPresentCount: 0,
      degradedCount: 0,
      setupState: 'needs_market',
      setupLabel: 'Market setup needed',
      setupDetail: 'Configure at least one reviewed local market before refreshing local visibility.',
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

  return {
    ...base,
    ...overrides,
    settings: { ...base.settings, ...overrides.settings },
    report: { ...base.report, ...overrides.report },
    caps: { ...base.caps, ...overrides.caps },
  };
}

function renderPanel(props: ComponentProps<typeof LocalSeoVisibilityPanel> = { workspaceId: 'ws-1' }) {
  return render(
    <MemoryRouter>
      <LocalSeoVisibilityPanel {...props} />
    </MemoryRouter>,
  );
}

describe('LocalSeoVisibilityPanel setup drawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localSeoIsError = false;
    localSeoError = null;
    localSeoData = makeReadResponse();
    updateMutateAsync.mockResolvedValue({
      ...localSeoData,
      markets: [{
        id: 'market-austin',
        workspaceId: 'ws-1',
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        providerLocationName: 'Austin,Texas,United States',
        source: 'admin_override',
        status: 'active',
        createdAt: '2026-05-20T12:00:00.000Z',
        updatedAt: '2026-05-20T12:00:00.000Z',
      }],
    });
    refreshMutateAsync.mockResolvedValue({ jobId: 'job-1', selectedKeywordCount: 5, selectedMarketCount: 1 });
    locationLookupMutateAsync.mockResolvedValue({
      query: { city: 'Austin', stateOrRegion: 'TX', country: 'US' },
      status: 'matched',
      candidates: [{
        providerLocationCode: 1026201,
        providerLocationName: 'Austin,Texas,United States',
        countryIsoCode: 'US',
        locationType: 'City',
        score: 100,
      }],
      bestCandidate: {
        providerLocationCode: 1026201,
        providerLocationName: 'Austin,Texas,United States',
        countryIsoCode: 'US',
        locationType: 'City',
        score: 100,
      },
    });
  });

  it('renders Configure market when local visibility needs setup', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: /configure market/i })).toBeInTheDocument();
    expect(screen.getByText('Market setup needed')).toBeInTheDocument();
  });

  it('keeps keyword-level local visibility in the command center instead of rendering a mini keyword list', () => {
    localSeoData = makeReadResponse({
      markets: [{
        id: 'market-austin',
        workspaceId: 'ws-1',
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        source: 'admin_override',
        status: 'active',
        createdAt: '2026-05-20T12:00:00.000Z',
        updatedAt: '2026-05-20T12:00:00.000Z',
      }],
      latestSnapshots: [{
        id: 'snap-1',
        workspaceId: 'ws-1',
        keyword: 'cosmetic dentistry austin',
        normalizedKeyword: 'cosmetic dentistry austin',
        marketId: 'market-austin',
        marketLabel: 'Austin, TX',
        capturedAt: '2026-05-20T12:00:00.000Z',
        localPackPresent: true,
        businessFound: true,
        businessMatchConfidence: 'verified',
        localRank: 2,
        topCompetitors: [],
        sourceEndpoint: 'google_organic_serp',
        provider: 'fake-seo-provider',
        device: 'desktop',
        languageCode: 'en',
        status: 'success',
      }],
      report: {
        setupState: 'has_data',
        setupLabel: 'Local visibility ready',
        setupDetail: 'Use Keywords to inspect local visibility by keyword.',
        activeMarketCount: 1,
        configuredMarketCount: 1,
        latestSnapshotCount: 1,
        checkedKeywordCount: 1,
        visibleCount: 1,
        localPackPresentCount: 1,
      },
    });

    renderPanel({ workspaceId: 'ws-1', onOpenKeywords: vi.fn() });

    expect(screen.getByText('Keyword visibility lives in Keywords')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /view local keywords/i })[0]).toBeInTheDocument();
    expect(screen.queryByText('cosmetic dentistry austin')).not.toBeInTheDocument();
  });

  it('renders Strategy mode as the posture and setup home', () => {
    localSeoData = makeReadResponse({
      markets: [{
        id: 'market-austin',
        workspaceId: 'ws-1',
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        source: 'admin_override',
        status: 'active',
        createdAt: '2026-05-20T12:00:00.000Z',
        updatedAt: '2026-05-20T12:00:00.000Z',
      }],
      report: {
        setupState: 'ready_no_data',
        setupLabel: 'Local setup ready',
        setupDetail: 'Refresh local visibility when you are ready to measure this market.',
        activeMarketCount: 1,
        configuredMarketCount: 1,
      },
    });

    renderPanel({ workspaceId: 'ws-1', mode: 'strategy', onOpenKeywords: vi.fn() });

    expect(screen.getByText('Local SEO Setup')).toBeInTheDocument();
    expect(screen.getByText('Local setup ready')).toBeInTheDocument();
    expect(screen.getByText('Austin, TX')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view local keywords/i })).toBeInTheDocument();
    expect(screen.queryByText('Local Keyword Visibility')).not.toBeInTheDocument();
  });

  it('renders Keywords mode as the local keyword visibility hub', () => {
    localSeoData = makeReadResponse({
      report: {
        setupState: 'has_data',
        setupLabel: 'Local visibility ready',
        setupDetail: 'Use Keywords to inspect local visibility by keyword.',
        activeMarketCount: 1,
        configuredMarketCount: 1,
        checkedKeywordCount: 12,
        visibleCount: 4,
        possibleMatchCount: 3,
        notVisibleCount: 5,
      },
    });

    renderPanel({ workspaceId: 'ws-1', mode: 'keywords', onOpenKeywords: vi.fn() });

    expect(screen.getByText('Local Keyword Visibility')).toBeInTheDocument();
    expect(screen.getByText('Keyword visibility lives in Keywords')).toBeInTheDocument();
    expect(screen.getByText('Possible')).toBeInTheDocument();
    expect(screen.getByText('Not Found')).toBeInTheDocument();
  });

  it('renders the per-market visibility trend when the read model includes a series with >= 2 points', () => {
    localSeoData = makeReadResponse({
      report: {
        setupState: 'has_data',
        setupLabel: 'Local visibility ready',
        setupDetail: 'Use Keywords to inspect local visibility by keyword.',
        activeMarketCount: 1,
        configuredMarketCount: 1,
        checkedKeywordCount: 12,
        visibleCount: 4,
      },
      visibilityTrend: [
        {
          marketId: 'm1',
          marketLabel: 'Austin, TX',
          points: [
            { date: '2026-06-01', visibleCount: 1, checkedCount: 4 },
            { date: '2026-06-02', visibleCount: 3, checkedCount: 4 },
          ],
        },
      ],
    });

    renderPanel({ workspaceId: 'ws-1', mode: 'keywords', onOpenKeywords: vi.fn() });

    expect(screen.getByText('Visibility trend')).toBeInTheDocument();
    expect(screen.getByText('Verified local-pack matches over time')).toBeInTheDocument();
    // Market label appears in the trend row (getAllByText — also used in the market summary).
    expect(screen.getAllByText('Austin, TX').length).toBeGreaterThan(0);
    // Trend delta (+2) renders via TrendBadge.
    expect(screen.getByText(/\+2/)).toBeInTheDocument();
  });

  it('does not render the visibility trend when no market has >= 2 points', () => {
    localSeoData = makeReadResponse({
      report: {
        setupState: 'has_data',
        setupLabel: 'Local visibility ready',
        setupDetail: 'Use Keywords to inspect local visibility by keyword.',
        activeMarketCount: 1,
        configuredMarketCount: 1,
        checkedKeywordCount: 12,
        visibleCount: 4,
      },
      visibilityTrend: [
        { marketId: 'm1', marketLabel: 'Austin, TX', points: [{ date: '2026-06-01', visibleCount: 1, checkedCount: 4 }] },
      ],
    });

    renderPanel({ workspaceId: 'ws-1', mode: 'keywords', onOpenKeywords: vi.fn() });

    expect(screen.queryByText('Visibility trend')).not.toBeInTheDocument();
  });

  it('renders Page mode as annotation-only without workspace stats or refresh controls', () => {
    localSeoData = makeReadResponse({
      report: {
        setupState: 'has_data',
        setupLabel: 'Local visibility ready',
        setupDetail: 'Use Keywords to inspect local visibility by keyword.',
        activeMarketCount: 1,
        configuredMarketCount: 1,
        checkedKeywordCount: 2,
        visibleCount: 1,
      },
    });

    renderPanel({ workspaceId: 'ws-1', mode: 'page', onOpenKeywords: vi.fn() });

    expect(screen.getByText('Local visibility annotation')).toBeInTheDocument();
    expect(screen.getByText(/Page rows show local evidence/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open keywords/i })).toBeInTheDocument();
    expect(screen.queryByText('Markets')).not.toBeInTheDocument();
    expect(screen.queryByText('Checked')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^refresh$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /configure market/i })).not.toBeInTheDocument();
  });

  it('uses a suggested market to populate a valid active market save', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /configure market/i }));
    fireEvent.click(screen.getByRole('button', { name: /use this market/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save market$/i }));

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith({
      posture: 'unknown',
      markets: [expect.objectContaining({
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        providerLocationCode: 1026201,
        providerLocationName: 'Austin,Texas,United States',
        status: 'active',
      })],
      keywordsPerRefresh: null,
    }));
  });

  it('can match a provider location code from entered city, state, and country', async () => {
    localSeoData = makeReadResponse({ suggestedMarkets: [] });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /configure market/i }));
    fireEvent.click(screen.getByRole('button', { name: /add market/i }));
    fireEvent.change(screen.getByLabelText(/market label/i), { target: { value: 'Austin, TX' } });
    fireEvent.change(screen.getByLabelText(/^city/i), { target: { value: 'Austin' } });
    fireEvent.change(screen.getByLabelText(/state \/ region/i), { target: { value: 'TX' } });
    fireEvent.click(screen.getByRole('button', { name: /match location/i }));

    expect(await screen.findByText(/DataForSEO #1026201/i)).toBeInTheDocument();
  });

  it('does not submit active markets without provider identity', async () => {
    localSeoData = makeReadResponse({ suggestedMarkets: [] });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /configure market/i }));
    fireEvent.click(screen.getByRole('button', { name: /add market/i }));
    fireEvent.change(screen.getByLabelText(/market label/i), { target: { value: 'Austin, TX' } });
    fireEvent.change(screen.getByLabelText(/^city/i), { target: { value: 'Austin' } });
    fireEvent.click(screen.getByRole('button', { name: /^save market$/i }));

    expect(await screen.findByText(/needs a provider location name/i)).toBeInTheDocument();
    expect(updateMutateAsync).not.toHaveBeenCalled();
  });

  it('allows non-local posture to save without configured markets', async () => {
    localSeoData = makeReadResponse({ suggestedMarkets: [] });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /configure market/i }));
    fireEvent.change(screen.getByLabelText(/local seo posture/i), { target: { value: 'non_local' } });

    expect(screen.getByRole('button', { name: /save and refresh visibility/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^save market$/i }));

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith({
      posture: 'non_local',
      markets: [],
      keywordsPerRefresh: null,
    }));
    expect(refreshMutateAsync).not.toHaveBeenCalled();
  });

  it('saves and then starts a local visibility refresh', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /configure market/i }));
    fireEvent.click(screen.getByRole('button', { name: /use this market/i }));
    fireEvent.click(screen.getByRole('button', { name: /save and refresh visibility/i }));

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled());
    await waitFor(() => expect(refreshMutateAsync).toHaveBeenCalledWith({
      marketIds: ['market-austin'],
    }));
  });

  it('marks removed existing markets inactive in the saved payload', async () => {
    localSeoData = makeReadResponse({
      settings: { posture: 'local' },
      markets: [
        {
          id: 'market-austin',
          workspaceId: 'ws-1',
          label: 'Austin, TX',
          city: 'Austin',
          stateOrRegion: 'TX',
          country: 'US',
          providerLocationName: 'Austin,Texas,United States',
          source: 'admin_override',
          status: 'active',
          createdAt: '2026-05-20T12:00:00.000Z',
          updatedAt: '2026-05-20T12:00:00.000Z',
        },
        {
          id: 'market-round-rock',
          workspaceId: 'ws-1',
          label: 'Round Rock, TX',
          city: 'Round Rock',
          stateOrRegion: 'TX',
          country: 'US',
          providerLocationName: 'Round Rock,Texas,United States',
          source: 'admin_override',
          status: 'active',
          createdAt: '2026-05-20T12:00:00.000Z',
          updatedAt: '2026-05-20T12:00:00.000Z',
        },
      ],
      report: { setupState: 'ready_no_data', activeMarketCount: 2, configuredMarketCount: 2 },
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /edit markets/i }));
    fireEvent.click(screen.getByRole('button', { name: /deactivate round rock/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save market$/i }));

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith({
      posture: 'local',
      markets: expect.arrayContaining([
        expect.objectContaining({ id: 'market-austin', status: 'active' }),
        expect.objectContaining({ id: 'market-round-rock', status: 'inactive' }),
      ]),
      keywordsPerRefresh: null,
    }));
  });

  it('regenerates provider code while preserving cleared coordinate fields', async () => {
    localSeoData = makeReadResponse({
      settings: { posture: 'local' },
      markets: [{
        id: 'market-austin',
        workspaceId: 'ws-1',
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        providerLocationCode: 1026201,
        providerLocationName: 'Austin,Texas,United States',
        latitude: 30.2672,
        longitude: -97.7431,
        source: 'admin_override',
        status: 'active',
        createdAt: '2026-05-20T12:00:00.000Z',
        updatedAt: '2026-05-20T12:00:00.000Z',
      }],
      report: { setupState: 'ready_no_data', activeMarketCount: 1, configuredMarketCount: 1 },
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /edit markets/i }));
    fireEvent.click(screen.getByRole('button', { name: /provider identity/i }));
    fireEvent.change(screen.getByLabelText(/provider location code/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/^latitude/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/^longitude/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save market$/i }));

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith({
      posture: 'local',
      markets: [expect.objectContaining({
        id: 'market-austin',
        providerLocationCode: 1026201,
        latitude: null,
        longitude: null,
        providerLocationName: 'Austin,Texas,United States',
      })],
      keywordsPerRefresh: null,
    }));
  });
});

// ── Bug fix tests ─────────────────────────────────────────────────────────────
// Three silent-failure bugs verified via TDD before implementation.

describe('LocalSeoVisibilityPanel — Bug fix: panel error state (Bug 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localSeoIsError = false;
    localSeoError = null;
    localSeoData = makeReadResponse();
    updateMutateAsync.mockResolvedValue({ markets: [] });
    refreshMutateAsync.mockResolvedValue({ jobId: 'job-1', selectedKeywordCount: 0, selectedMarketCount: 0 });
  });

  it('renders ErrorState with retry button when the first fetch fails (data is undefined)', () => {
    // Simulate a first-load fetch failure: data is undefined and isError is true
    localSeoData = undefined as unknown as LocalSeoReadResponse;
    localSeoIsError = true;
    localSeoError = new Error('Network error');

    renderPanel();

    // Must render an error state — NOT return null silently
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Retry / Try Again button must be present
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('calls refetch when the retry button is clicked after a fetch error', () => {
    localSeoData = undefined as unknown as LocalSeoReadResponse;
    localSeoIsError = true;
    localSeoError = new Error('Network error');

    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(localSeoRefetch).toHaveBeenCalledTimes(1);
  });

  it('returns null (not an error state) when featureEnabled is false and no error', () => {
    localSeoIsError = false;
    localSeoData = makeReadResponse({ featureEnabled: false });

    const { container } = renderPanel();

    // featureEnabled: false → nothing rendered (existing behaviour preserved)
    expect(container.firstChild).toBeNull();
    // No error UI shown
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders error state in page mode too', () => {
    localSeoData = undefined as unknown as LocalSeoReadResponse;
    localSeoIsError = true;
    localSeoError = new Error('Network error');

    renderPanel({ workspaceId: 'ws-1', mode: 'page' });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('LocalSeoMarketSetupDrawer — Bug fix: dirty-state resync (Bug 2)', () => {
  const marketA = {
    id: 'market-austin',
    workspaceId: 'ws-1',
    label: 'Austin, TX',
    city: 'Austin',
    stateOrRegion: 'TX',
    country: 'US',
    providerLocationName: 'Austin,Texas,United States',
    providerLocationCode: 1026201,
    source: 'admin_override' as const,
    status: 'active' as const,
    createdAt: '2026-05-20T12:00:00.000Z',
    updatedAt: '2026-05-20T12:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localSeoIsError = false;
    localSeoError = null;
    localSeoData = makeReadResponse({
      settings: { posture: 'local' },
      markets: [marketA],
      report: { setupState: 'ready_no_data', activeMarketCount: 1, configuredMarketCount: 1 },
    });
    updateMutateAsync.mockResolvedValue({ markets: [marketA] });
    refreshMutateAsync.mockResolvedValue({ jobId: 'job-1', selectedKeywordCount: 5, selectedMarketCount: 1 });
  });

  it('preserves in-progress label edits when data identity changes while drawer is open', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <LocalSeoVisibilityPanel workspaceId="ws-1" />
      </MemoryRouter>,
    );

    // Open the drawer
    fireEvent.click(screen.getByRole('button', { name: /edit markets/i }));

    // Edit the market label — make it dirty
    const labelInput = screen.getByLabelText(/market label/i);
    fireEvent.change(labelInput, { target: { value: 'Austin Metro' } });
    expect(labelInput).toHaveValue('Austin Metro');

    // Simulate a data refetch by providing a new object identity for data.markets
    // (same logical content, new array reference — the scenario that "Set as primary" triggers)
    localSeoData = makeReadResponse({
      settings: { posture: 'local' },
      markets: [{ ...marketA }], // new array/object identity
      report: { setupState: 'ready_no_data', activeMarketCount: 1, configuredMarketCount: 1 },
    });

    await act(async () => {
      rerender(
        <MemoryRouter>
          <LocalSeoVisibilityPanel workspaceId="ws-1" />
        </MemoryRouter>,
      );
    });

    // Draft must NOT be wiped — label edit should be preserved
    expect(screen.getByLabelText(/market label/i)).toHaveValue('Austin Metro');
  });

  it('resyncs cleanly from fresh data when the drawer is pristine', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <LocalSeoVisibilityPanel workspaceId="ws-1" />
      </MemoryRouter>,
    );

    // Open the drawer without making any changes
    fireEvent.click(screen.getByRole('button', { name: /edit markets/i }));
    expect(screen.getByLabelText(/market label/i)).toHaveValue('Austin, TX');

    // Simulate a data update that brings a renamed market
    localSeoData = makeReadResponse({
      settings: { posture: 'local' },
      markets: [{ ...marketA, label: 'Austin Metro Area' }],
      report: { setupState: 'ready_no_data', activeMarketCount: 1, configuredMarketCount: 1 },
    });

    await act(async () => {
      rerender(
        <MemoryRouter>
          <LocalSeoVisibilityPanel workspaceId="ws-1" />
        </MemoryRouter>,
      );
    });

    // Pristine drawer SHOULD resync with the new server data
    expect(screen.getByLabelText(/market label/i)).toHaveValue('Austin Metro Area');
  });
});

describe('LocalSeoMarketSetupDrawer — Bug fix: save error visibility (Bug 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localSeoIsError = false;
    localSeoError = null;
    localSeoData = makeReadResponse({
      settings: { posture: 'local' },
      markets: [{
        id: 'market-austin',
        workspaceId: 'ws-1',
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        providerLocationName: 'Austin,Texas,United States',
        providerLocationCode: 1026201,
        source: 'admin_override',
        status: 'active',
        createdAt: '2026-05-20T12:00:00.000Z',
        updatedAt: '2026-05-20T12:00:00.000Z',
      }],
      report: { setupState: 'ready_no_data', activeMarketCount: 1, configuredMarketCount: 1 },
    });
    updateMutateAsync.mockRejectedValue(new Error('Save failed: network timeout'));
    refreshMutateAsync.mockResolvedValue({ jobId: 'job-1', selectedKeywordCount: 5, selectedMarketCount: 1 });
  });

  it('shows a role=alert error message in the footer area after a failed save', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /edit markets/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save market$/i }));

    // Error must be announced via role="alert"
    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/save failed/i);
  });

  it('shows a role=alert for validation errors too', async () => {
    // Use a setup where validation will fail: non-local posture but active market with no provider identity
    localSeoData = makeReadResponse({ suggestedMarkets: [] });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /configure market/i }));
    fireEvent.click(screen.getByRole('button', { name: /add market/i }));
    fireEvent.change(screen.getByLabelText(/market label/i), { target: { value: 'Austin, TX' } });
    fireEvent.change(screen.getByLabelText(/^city/i), { target: { value: 'Austin' } });
    // Missing country and provider identity — validation should fail
    fireEvent.change(screen.getByLabelText(/^country/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save market$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
  });
});
