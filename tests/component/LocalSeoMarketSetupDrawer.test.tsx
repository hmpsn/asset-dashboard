/**
 * Component tests for Bug 4 fix — trash-icon "Remove" is honest "Deactivate":
 *
 *  - Deactivating a market moves it to the "Inactive markets" section (not silently discards)
 *  - Inactive markets from the server are displayed in the section on drawer open
 *  - Reactivate button moves market back to the active list
 *  - Inactive markets are submitted with INACTIVE status on save
 *  - The "Add market" cap counts only non-inactive (active) markets
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LocalSeoMarket, LocalSeoReadResponse } from '../../shared/types/local-seo';
import { LOCAL_SEO_MARKET_STATUS, LOCAL_SEO_POSTURE } from '../../shared/types/local-seo';
import { LocalSeoMarketSetupDrawer } from '../../src/components/local-seo/LocalSeoMarketSetupDrawer';

// ─── Mock admin hooks ─────────────────────────────────────────────────────────

const updateMutateAsync = vi.fn();
const refreshMutateAsync = vi.fn();
const locationLookupMutateAsync = vi.fn();
const setPrimaryMutate = vi.fn();

vi.mock('../../src/hooks/admin', () => ({
  useLocalSeoUpdate: () => ({
    mutateAsync: updateMutateAsync,
    isPending: false,
    error: null,
  }),
  useLocalSeoRefresh: () => ({
    mutateAsync: refreshMutateAsync,
    isPending: false,
    error: null,
  }),
  useLocalSeoLocationLookup: () => ({
    mutateAsync: locationLookupMutateAsync,
    isPending: false,
    error: null,
  }),
  useSetPrimaryMarket: () => ({
    mutate: setPrimaryMutate,
    isPending: false,
    error: null,
  }),
  useLocalSeoLocations: () => ({
    data: [{ id: 'loc-1', name: 'Acme Dental', status: 'confirmed' }],
    isLoading: false,
  }),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeMarket(overrides: Partial<LocalSeoMarket> = {}): LocalSeoMarket {
  return {
    id: overrides.id ?? 'mkt-austin',
    workspaceId: 'ws-1',
    label: overrides.label ?? 'Austin, TX',
    city: overrides.city ?? 'Austin',
    stateOrRegion: overrides.stateOrRegion ?? 'TX',
    country: overrides.country ?? 'US',
    providerLocationCode: overrides.providerLocationCode ?? 1026201,
    providerLocationName: overrides.providerLocationName ?? 'Austin,Texas,United States',
    isPrimary: overrides.isPrimary ?? false,
    source: overrides.source ?? 'admin_override',
    status: overrides.status ?? LOCAL_SEO_MARKET_STATUS.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeReadResponse(overrides: Partial<LocalSeoReadResponse> = {}): LocalSeoReadResponse {
  const base: LocalSeoReadResponse = {
    featureEnabled: true,
    settings: {
      workspaceId: 'ws-1',
      posture: LOCAL_SEO_POSTURE.LOCAL,
      postureSource: 'admin_override',
      suggestionReasons: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    markets: [],
    suggestedMarkets: [],
    latestSnapshots: [],
    report: {
      workspacePosture: LOCAL_SEO_POSTURE.LOCAL,
      activeMarketCount: 0,
      configuredMarketCount: 0,
      suggestedMarketCount: 0,
      latestSnapshotCount: 0,
      checkedKeywordCount: 0,
      visibleCount: 0,
      possibleMatchCount: 0,
      notVisibleCount: 0,
      localPackPresentCount: 0,
      degradedCount: 0,
      setupState: 'needs_market',
      setupLabel: 'Market setup needed',
      setupDetail: '',
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
  return { ...base, ...overrides, settings: { ...base.settings, ...overrides.settings }, caps: { ...base.caps, ...overrides.caps }, report: { ...base.report, ...overrides.report } };
}

function renderDrawer(data: LocalSeoReadResponse, onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <LocalSeoMarketSetupDrawer workspaceId="ws-1" data={data} open={true} onClose={onClose} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  updateMutateAsync.mockResolvedValue(makeReadResponse());
  refreshMutateAsync.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LocalSeoMarketSetupDrawer — Bug 4: deactivate-not-remove', () => {
  it('deactivating a market shows it in the Inactive markets section', async () => {
    const data = makeReadResponse({ markets: [makeMarket({ id: 'mkt-austin', label: 'Austin, TX' })] });
    renderDrawer(data);

    // The market starts in the active section
    expect(screen.getByText('Austin, TX')).toBeInTheDocument();

    // Click the deactivate icon button
    const deactivateBtn = screen.getByLabelText('Deactivate Austin, TX');
    await act(async () => { fireEvent.click(deactivateBtn); });

    // The active section should no longer show the market
    expect(screen.queryByLabelText('Deactivate Austin, TX')).not.toBeInTheDocument();

    // The inactive section should appear
    const inactiveSection = screen.getByRole('region', { name: /inactive markets/i });
    expect(within(inactiveSection).getByText('Austin, TX')).toBeInTheDocument();
    expect(within(inactiveSection).getByRole('button', { name: /reactivate/i })).toBeInTheDocument();
  });

  it('inactive markets from the server are shown in the inactive section on open', () => {
    const data = makeReadResponse({
      markets: [
        makeMarket({ id: 'mkt-active', label: 'Austin, TX', status: LOCAL_SEO_MARKET_STATUS.ACTIVE }),
        makeMarket({ id: 'mkt-inactive', label: 'Dallas, TX', status: LOCAL_SEO_MARKET_STATUS.INACTIVE }),
      ],
    });
    renderDrawer(data);

    // Active market is in the configured-markets section
    expect(screen.getByLabelText('Deactivate Austin, TX')).toBeInTheDocument();

    // Inactive market is in the inactive section
    const inactiveSection = screen.getByRole('region', { name: /inactive markets/i });
    expect(within(inactiveSection).getByText('Dallas, TX')).toBeInTheDocument();
    // The active-section deactivate button is NOT present for the inactive market
    expect(screen.queryByLabelText('Deactivate Dallas, TX')).not.toBeInTheDocument();
  });

  it('Reactivate button moves market back to the active list', async () => {
    const data = makeReadResponse({
      markets: [makeMarket({ id: 'mkt-inactive', label: 'Dallas, TX', status: LOCAL_SEO_MARKET_STATUS.INACTIVE })],
    });
    renderDrawer(data);

    const inactiveSection = screen.getByRole('region', { name: /inactive markets/i });
    const reactivateBtn = within(inactiveSection).getByRole('button', { name: /reactivate/i });
    await act(async () => { fireEvent.click(reactivateBtn); });

    // Inactive section should be gone (no more inactive markets)
    expect(screen.queryByRole('region', { name: /inactive markets/i })).not.toBeInTheDocument();

    // Market is back in the configured-markets section
    expect(screen.getByText('Dallas, TX')).toBeInTheDocument();
    expect(screen.getByLabelText('Deactivate Dallas, TX')).toBeInTheDocument();
  });

  it('inactive markets are submitted with INACTIVE status on save', async () => {
    const data = makeReadResponse({
      markets: [
        makeMarket({ id: 'mkt-a', label: 'Austin, TX', status: LOCAL_SEO_MARKET_STATUS.ACTIVE }),
        makeMarket({ id: 'mkt-b', label: 'Dallas, TX', status: LOCAL_SEO_MARKET_STATUS.INACTIVE }),
      ],
    });
    renderDrawer(data);

    // Save by clicking "Save market"
    const saveBtn = screen.getByRole('button', { name: /^Save market$/i });
    await act(async () => { fireEvent.click(saveBtn); });

    expect(updateMutateAsync).toHaveBeenCalledOnce();
    const callArg = updateMutateAsync.mock.calls[0][0] as { markets: Array<{ id?: string; status?: string }> };
    expect(callArg.markets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mkt-b', status: LOCAL_SEO_MARKET_STATUS.INACTIVE }),
      ]),
    );
  });

  it('inactive markets are not counted against the active markets cap', () => {
    // 3 active markets = at cap (maxMarkets=3); if inactive were counted, "Add market" would be
    // disabled even though there is room for another active market. With the fix, inactive markets
    // live in removedMarkets and are not counted.
    const data = makeReadResponse({
      markets: [
        makeMarket({ id: 'mkt-1', label: 'Austin, TX', status: LOCAL_SEO_MARKET_STATUS.ACTIVE }),
        makeMarket({ id: 'mkt-2', label: 'Dallas, TX', status: LOCAL_SEO_MARKET_STATUS.ACTIVE }),
        makeMarket({ id: 'mkt-3', label: 'Houston, TX', status: LOCAL_SEO_MARKET_STATUS.ACTIVE }),
        makeMarket({ id: 'mkt-inactive', label: 'San Antonio, TX', status: LOCAL_SEO_MARKET_STATUS.INACTIVE }),
      ],
      caps: { maxMarkets: 3, maxKeywordsPerRefresh: 100, keywordsPerRefreshMin: 25, keywordsPerRefreshMax: 300, keywordsPerRefreshDefault: 100 },
    });
    renderDrawer(data);

    // At cap: "Add market" should be disabled
    const addMarketBtn = screen.getByRole('button', { name: /add market/i });
    expect(addMarketBtn).toBeDisabled();
  });

  it('Add market is enabled when active market count < cap even if inactive markets exist', async () => {
    const data = makeReadResponse({
      markets: [
        makeMarket({ id: 'mkt-1', label: 'Austin, TX', status: LOCAL_SEO_MARKET_STATUS.ACTIVE }),
        makeMarket({ id: 'mkt-inactive', label: 'Dallas, TX', status: LOCAL_SEO_MARKET_STATUS.INACTIVE }),
      ],
      caps: { maxMarkets: 3, maxKeywordsPerRefresh: 100, keywordsPerRefreshMin: 25, keywordsPerRefreshMax: 300, keywordsPerRefreshDefault: 100 },
    });
    renderDrawer(data);

    // 1 active + 1 inactive → 1 active < cap of 3 → "Add market" should be ENABLED
    const addMarketBtn = screen.getByRole('button', { name: /add market/i });
    expect(addMarketBtn).not.toBeDisabled();
  });
});
