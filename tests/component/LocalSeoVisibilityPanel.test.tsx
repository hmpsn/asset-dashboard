import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';
import { LocalSeoVisibilityPanel } from '../../src/components/local-seo/LocalSeoVisibilityPanel';
import type { LocalSeoReadResponse } from '../../shared/types/local-seo';

const updateMutateAsync = vi.fn();
const refreshMutate = vi.fn();
const refreshMutateAsync = vi.fn();
const locationLookupMutateAsync = vi.fn();

let localSeoData: LocalSeoReadResponse;

vi.mock('../../src/hooks/admin', () => ({
  useLocalSeo: () => ({
    data: localSeoData,
    isLoading: false,
    error: null,
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
    fireEvent.click(screen.getByRole('button', { name: /remove round rock/i }));
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
