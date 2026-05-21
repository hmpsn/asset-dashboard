import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocalSeoVisibilityPanel } from '../../src/components/local-seo/LocalSeoVisibilityPanel';
import type { LocalSeoReadResponse } from '../../shared/types/local-seo';

const updateMutateAsync = vi.fn();
const refreshMutate = vi.fn();
const refreshMutateAsync = vi.fn();

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
      maxKeywordsPerRefresh: 25,
    },
  };

  return {
    ...base,
    ...overrides,
    settings: { ...base.settings, ...overrides.settings },
    report: { ...base.report, ...overrides.report },
    caps: { ...base.caps, ...overrides.caps },
  };
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
        providerLocationName: 'Austin,TX,United States',
        source: 'admin_override',
        status: 'active',
        createdAt: '2026-05-20T12:00:00.000Z',
        updatedAt: '2026-05-20T12:00:00.000Z',
      }],
    });
    refreshMutateAsync.mockResolvedValue({ jobId: 'job-1', selectedKeywordCount: 5, selectedMarketCount: 1 });
  });

  it('renders Configure market when local visibility needs setup', () => {
    render(<LocalSeoVisibilityPanel workspaceId="ws-1" />);

    expect(screen.getByRole('button', { name: /configure market/i })).toBeInTheDocument();
    expect(screen.getByText('Market setup needed')).toBeInTheDocument();
  });

  it('uses a suggested market to populate a valid active market save', async () => {
    render(<LocalSeoVisibilityPanel workspaceId="ws-1" />);

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
        providerLocationName: 'Austin,TX,United States',
        status: 'active',
      })],
    }));
  });

  it('does not submit active markets without provider identity', async () => {
    localSeoData = makeReadResponse({ suggestedMarkets: [] });
    render(<LocalSeoVisibilityPanel workspaceId="ws-1" />);

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
    render(<LocalSeoVisibilityPanel workspaceId="ws-1" />);

    fireEvent.click(screen.getByRole('button', { name: /configure market/i }));
    fireEvent.change(screen.getByLabelText(/local seo posture/i), { target: { value: 'non_local' } });

    expect(screen.getByRole('button', { name: /save and refresh visibility/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^save market$/i }));

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith({
      posture: 'non_local',
      markets: [],
    }));
    expect(refreshMutateAsync).not.toHaveBeenCalled();
  });

  it('saves and then starts a local visibility refresh', async () => {
    render(<LocalSeoVisibilityPanel workspaceId="ws-1" />);

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
          providerLocationName: 'Austin,TX,United States',
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
          providerLocationName: 'Round Rock,TX,United States',
          source: 'admin_override',
          status: 'active',
          createdAt: '2026-05-20T12:00:00.000Z',
          updatedAt: '2026-05-20T12:00:00.000Z',
        },
      ],
      report: { setupState: 'ready_no_data', activeMarketCount: 2, configuredMarketCount: 2 },
    });
    render(<LocalSeoVisibilityPanel workspaceId="ws-1" />);

    fireEvent.click(screen.getByRole('button', { name: /edit markets/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove round rock/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save market$/i }));

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith({
      posture: 'local',
      markets: expect.arrayContaining([
        expect.objectContaining({ id: 'market-austin', status: 'active' }),
        expect.objectContaining({ id: 'market-round-rock', status: 'inactive' }),
      ]),
    }));
  });

  it('sends nulls when clearing saved numeric provider fields', async () => {
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
        providerLocationName: 'Austin,TX,United States',
        latitude: 30.2672,
        longitude: -97.7431,
        source: 'admin_override',
        status: 'active',
        createdAt: '2026-05-20T12:00:00.000Z',
        updatedAt: '2026-05-20T12:00:00.000Z',
      }],
      report: { setupState: 'ready_no_data', activeMarketCount: 1, configuredMarketCount: 1 },
    });
    render(<LocalSeoVisibilityPanel workspaceId="ws-1" />);

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
        providerLocationCode: null,
        latitude: null,
        longitude: null,
        providerLocationName: 'Austin,TX,United States',
      })],
    }));
  });
});
