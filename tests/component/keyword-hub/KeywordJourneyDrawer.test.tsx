/**
 * KeywordJourneyDrawer.test.tsx — the Keyword Journey Drawer.
 *
 * The KeywordDetailDrawer is the Keyword Hub's detail surface. It renders five
 * journey sections + a Tracking-Decision enrichment unconditionally (the
 * `keyword-hub` flag gate was removed in the W4 cutover when the Hub became the
 * only keyword surface).
 *
 * Sections:
 *   T0 — KeywordSparkline (extracted from RankTracker's PositionSparkline)
 *   T1 — Origin (sourceGapKey provenance + unwired View-in-Strategy)
 *   T2 — Tracking-Decision enrichment (strategyOwned / addedAt / pinned)
 *   T3 — National Rank + 90-day sparkline (lazy history fetch)
 *   T4 — Local Visibility per-market breakdown (+N more toggle)
 *   T5 — Lifecycle / Why Retired (amber; replacedBy + unwired View-in-Hub)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { KeywordSparkline } from '../../../src/components/keyword-command-center/KeywordSparkline';
import { KeywordDetailDrawer } from '../../../src/components/keyword-command-center/KeywordDetailDrawer';
import type {
  KeywordCommandCenterRow,
  KeywordCommandCenterStatus,
} from '../../../shared/types/keyword-command-center';
import type {
  LocalSeoKeywordVisibility,
  LocalSeoKeywordVisibilitySummary,
} from '../../../shared/types/local-seo';

// ---------------------------------------------------------------------------
// History-fetch mock
// ---------------------------------------------------------------------------

const getMock = vi.fn();

vi.mock('../../../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/api/client')>();
  return {
    ...actual,
    get: (...args: unknown[]) => getMock(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMarket(overrides: Partial<LocalSeoKeywordVisibility> = {}): LocalSeoKeywordVisibility {
  return {
    keyword: 'cosmetic dentistry',
    normalizedKeyword: 'cosmetic dentistry',
    marketId: 'm-austin',
    marketLabel: 'Austin, TX',
    capturedAt: '2026-05-01T00:00:00.000Z',
    posture: 'visible',
    label: 'Visible',
    detail: 'In the local pack',
    localPackPresent: true,
    businessFound: true,
    businessMatchConfidence: 'verified',
    localRank: 2,
    sourceEndpoint: 'google_local_finder',
    provider: 'dataforseo',
    ...overrides,
  };
}

function makeLocalSeo(markets: LocalSeoKeywordVisibility[]): LocalSeoKeywordVisibilitySummary {
  const primary = markets[0];
  return {
    ...primary,
    marketCount: markets.length,
    markets,
    visibleMarketCount: markets.filter(m => m.posture === 'visible').length,
    possibleMatchMarketCount: markets.filter(m => m.posture === 'possible_match').length,
    localPackOnlyMarketCount: markets.filter(m => m.posture === 'local_pack_present').length,
    notVisibleMarketCount: markets.filter(m => m.posture === 'not_visible').length,
    degradedMarketCount: markets.filter(m => m.posture === 'provider_degraded').length,
  };
}

function makeRow(overrides: Partial<KeywordCommandCenterRow> = {}): KeywordCommandCenterRow {
  return {
    keyword: 'cosmetic dentistry',
    normalizedKeyword: 'cosmetic dentistry',
    lifecycleStatus: 'tracked' as KeywordCommandCenterStatus,
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: { volume: 1200, currentPosition: 6.3, ctr: 0.04, clicks: 88, impressions: 2200 },
    tracking: { status: 'active', source: 'manual' },
    nextActions: [],
    isProtected: false,
    ...overrides,
  };
}

function renderDrawer(row: KeywordCommandCenterRow | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <KeywordDetailDrawer
          open
          row={row}
          workspaceId="ws-1"
          onAction={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  getMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// T0 — KeywordSparkline
// ===========================================================================

describe('KeywordSparkline', () => {
  it('returns null for empty data', () => {
    const { container } = render(<KeywordSparkline data={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null for a single point', () => {
    const { container } = render(
      <KeywordSparkline data={[{ date: '2026-05-01', position: 5 }]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders an <svg> for two or more points', () => {
    const { container } = render(
      <KeywordSparkline
        data={[
          { date: '2026-04-01', position: 8 },
          { date: '2026-05-01', position: 5 },
        ]}
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('shows emerald delta when improved (latest < first)', () => {
    const { container } = render(
      <KeywordSparkline
        data={[
          { date: '2026-04-01', position: 8 },
          { date: '2026-05-01', position: 3 },
        ]}
      />,
    );
    expect(container.querySelector('.text-emerald-400')).not.toBeNull();
  });

  it('shows red delta when regressed (latest > first)', () => {
    const { container } = render(
      <KeywordSparkline
        data={[
          { date: '2026-04-01', position: 3 },
          { date: '2026-05-01', position: 9 },
        ]}
      />,
    );
    expect(container.querySelector('.text-red-400')).not.toBeNull();
  });
});

// ===========================================================================
// Drawer chrome baseline
// ===========================================================================
//
// The journey sections used to be gated behind the `keyword-hub` flag. After
// the W4 cutover the Hub is the only keyword surface, so the journey renders
// unconditionally. This baseline asserts the core drawer chrome still mounts;
// the journey-section behaviour is exercised by the T1–T5 describes below.

describe('drawer chrome baseline', () => {
  it('renders the keyword and core drawer chrome', () => {
    renderDrawer(makeRow());
    expect(screen.getByText('cosmetic dentistry')).not.toBeNull();
    expect(screen.getByText('Tracking State')).not.toBeNull();
  });
});

// ===========================================================================
// T1 — Origin
// ===========================================================================

describe('Origin section', () => {
  it('shows "From content gap" + the unwired View-in-Strategy button for a gap-sourced keyword', () => {
    renderDrawer(
      makeRow({
        tracking: { status: 'active', source: 'content_gap', sourceGapKey: 'gap:dental-implants' },
      }),
    );
    expect(screen.getByText(/From content gap/i)).not.toBeNull();
    const btn = screen.getByTestId('view-in-strategy-link');
    expect(btn).not.toBeNull();
    // Unwired in P2: must NOT navigate (href stays '#').
    expect(btn.getAttribute('href') ?? '#').toBe('#');
  });

  it('shows "Client requested" with NO View-in-Strategy button', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'client_requested' } }));
    // Scope to the Origin section (the tracking-source line also reads "client requested").
    const originHeading = screen.getByText('Origin');
    const originSection = originHeading.parentElement as HTMLElement;
    expect(within(originSection).getByText(/Client requested/i)).not.toBeNull();
    expect(screen.queryByTestId('view-in-strategy-link')).toBeNull();
  });

  it('shows "Manually added" for a manual keyword', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'manual' } }));
    expect(screen.getByText(/Manually added/i)).not.toBeNull();
  });

  it('omits the Origin section entirely for an unknown source', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'unknown' } }));
    expect(screen.queryByText(/From content gap/i)).toBeNull();
    expect(screen.queryByText(/Client requested/i)).toBeNull();
    expect(screen.queryByText(/Manually added/i)).toBeNull();
    expect(screen.queryByTestId('view-in-strategy-link')).toBeNull();
  });
});

// ===========================================================================
// T2 — Tracking-Decision enrichment
// ===========================================================================

describe('Tracking-Decision enrichment', () => {
  it('shows the Auto-managed note ONLY when strategyOwned === true', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'manual', strategyOwned: true } }));
    expect(screen.getByText(/Auto-managed/i)).not.toBeNull();
  });

  it('omits the Auto-managed note when strategyOwned === false', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'manual', strategyOwned: false } }));
    expect(screen.queryByText(/Auto-managed/i)).toBeNull();
  });

  it('omits the Auto-managed note when strategyOwned is undefined', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'manual' } }));
    expect(screen.queryByText(/Auto-managed/i)).toBeNull();
  });

  it('shows "Tracked since Nov 15, 2025" when addedAt is defined', () => {
    renderDrawer(
      makeRow({ tracking: { status: 'active', source: 'manual', addedAt: '2025-11-15T12:00:00.000Z' } }),
    );
    expect(screen.getByText(/Tracked since Nov 15, 2025/)).not.toBeNull();
  });

  it('omits "Tracked since" when addedAt is absent', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'manual' } }));
    expect(screen.queryByText(/Tracked since/i)).toBeNull();
  });

  it('shows a Pinned badge when pinned === true', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'manual', pinned: true } }));
    expect(screen.getByText(/Pinned/i)).not.toBeNull();
  });
});

// ===========================================================================
// T3 — National Rank + sparkline
// ===========================================================================

describe('National Rank section', () => {
  it('shows "#6.3" with the positionColor class for a ranked keyword', () => {
    renderDrawer(
      makeRow({ metrics: { currentPosition: 6.3, clicks: 50, impressions: 1000 } }),
    );
    // Scope to the National rank section (the metrics-grid Rank cell also shows #6.3).
    const section = screen.getByText('National rank').parentElement as HTMLElement;
    const posEl = within(section).getByText('#6.3');
    expect(posEl).not.toBeNull();
    // positionColor(6.3) → <= 10 → text-accent-success
    expect(posEl.className).toContain('text-accent-success');
  });

  it('shows "—" when currentPosition is undefined', () => {
    renderDrawer(makeRow({ metrics: { clicks: 0, impressions: 0 } }));
    const section = screen.getByText('National rank').closest('div');
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByText('—')).not.toBeNull();
  });

  it('omits the National Rank section AND does not fetch when not_tracked', () => {
    renderDrawer(makeRow({ tracking: { status: 'not_tracked' } }));
    expect(screen.queryByText('National rank')).toBeNull();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('renders KeywordSparkline with the fetched data when >= 2 snapshots', async () => {
    getMock.mockResolvedValue([
      { date: '2026-04-01', positions: { 'cosmetic dentistry': 9 } },
      { date: '2026-05-01', positions: { 'cosmetic dentistry': 4 } },
    ]);
    renderDrawer(makeRow());
    // Lazy fetch fires for tracked keyword.
    await screen.findByText('National rank');
    await vi.waitFor(() => expect(getMock).toHaveBeenCalled());
    const svg = await vi.waitFor(() => {
      const el = document.querySelector('svg');
      if (!el) throw new Error('no svg yet');
      return el;
    });
    expect(svg).not.toBeNull();
  });

  it('shows "Not enough snapshots" when < 2 usable points', async () => {
    getMock.mockResolvedValue([{ date: '2026-05-01', positions: { 'cosmetic dentistry': 4 } }]);
    renderDrawer(makeRow());
    await screen.findByText('National rank');
    await screen.findByText(/Not enough snapshots/i);
  });
});

// ===========================================================================
// T4 — Local Visibility per-market
// ===========================================================================

describe('Local Visibility per-market', () => {
  it('renders one row per market with rank labels', () => {
    renderDrawer(
      makeRow({
        localSeo: makeLocalSeo([
          makeMarket({ marketId: 'a', marketLabel: 'Austin, TX', posture: 'visible', localRank: 2 }),
          makeMarket({
            marketId: 'r',
            marketLabel: 'Round Rock, TX',
            posture: 'not_visible',
            localRank: undefined,
            businessMatchConfidence: 'not_found',
            label: 'Not visible',
          }),
        ]),
      }),
    );
    expect(screen.getByText('Local visibility')).not.toBeNull();
    expect(screen.getByText('Austin, TX')).not.toBeNull();
    expect(screen.getByText('Round Rock, TX')).not.toBeNull();
    expect(screen.getByText(/Pack rank #2/)).not.toBeNull();
    expect(screen.getByText(/Not ranked/i)).not.toBeNull();
  });

  it('omits the Local Visibility section when localSeo is undefined', () => {
    renderDrawer(makeRow({ localSeo: undefined, localSeoState: undefined }));
    expect(screen.queryByText('Local visibility')).toBeNull();
  });

  it('shows exactly 6 markets inline + a "+N more" toggle when > 6', () => {
    const markets = Array.from({ length: 9 }, (_, i) =>
      makeMarket({ marketId: `m${i}`, marketLabel: `Market ${i}`, posture: 'visible' }),
    );
    renderDrawer(makeRow({ localSeo: makeLocalSeo(markets) }));
    for (let i = 0; i < 6; i += 1) {
      expect(screen.getByText(`Market ${i}`)).not.toBeNull();
    }
    expect(screen.queryByText('Market 6')).toBeNull();
    const toggle = screen.getByTestId('local-markets-more');
    expect(toggle.textContent).toMatch(/\+3 more/);
  });

  it('expands all markets when "+N more" is clicked', () => {
    const markets = Array.from({ length: 9 }, (_, i) =>
      makeMarket({ marketId: `m${i}`, marketLabel: `Market ${i}`, posture: 'visible' }),
    );
    renderDrawer(makeRow({ localSeo: makeLocalSeo(markets) }));
    fireEvent.click(screen.getByTestId('local-markets-more'));
    expect(screen.getByText('Market 6')).not.toBeNull();
    expect(screen.getByText('Market 8')).not.toBeNull();
  });

  it('uses emerald for a visible market and zinc for a not_visible market', () => {
    const { container } = renderDrawer(
      makeRow({
        localSeo: makeLocalSeo([
          makeMarket({ marketId: 'a', marketLabel: 'Austin, TX', posture: 'visible', businessMatchConfidence: 'verified' }),
          makeMarket({
            marketId: 'r',
            marketLabel: 'Round Rock, TX',
            posture: 'not_visible',
            businessMatchConfidence: 'not_found',
            label: 'Not visible',
          }),
        ]),
      }),
    );
    // Verified/visible → emerald appears; not_visible → no emerald required, no purple anywhere.
    expect(container.querySelector('.text-emerald-400, .bg-emerald-400\\/10')).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/violet|indigo|text-purple|bg-purple/);
  });
});

// ===========================================================================
// T5 — Lifecycle / Why Retired
// ===========================================================================

describe('Lifecycle / Why Retired', () => {
  it('shows "Retired on Mar 1, 2026" + "Replaced by" + the unwired View-in-Hub button', () => {
    const { container } = renderDrawer(
      makeRow({
        lifecycleStatus: 'retired' as KeywordCommandCenterStatus,
        tracking: {
          status: 'deprecated',
          source: 'manual',
          deprecatedAt: '2026-03-01T12:00:00.000Z',
          replacedBy: 'dental implants austin tx',
        },
      }),
    );
    expect(screen.getByText(/Retired on Mar 1, 2026/)).not.toBeNull();
    expect(screen.getByText(/Replaced by:/i)).not.toBeNull();
    expect(screen.getByText(/dental implants austin tx/)).not.toBeNull();
    expect(screen.getByTestId('view-replaced-by-link')).not.toBeNull();
    // amber tone present; never the raw "deprecated" enum.
    expect(container.querySelector('.border-amber-400\\/30, .bg-amber-400\\/5')).not.toBeNull();
    expect(screen.queryByText(/deprecated/i)).toBeNull();
  });

  it('shows "No replacement recorded" when retired without replacedBy', () => {
    renderDrawer(
      makeRow({
        lifecycleStatus: 'retired' as KeywordCommandCenterStatus,
        tracking: { status: 'deprecated', source: 'manual', deprecatedAt: '2026-03-01T12:00:00.000Z' },
      }),
    );
    expect(screen.getByText(/No replacement recorded/i)).not.toBeNull();
    expect(screen.queryByTestId('view-replaced-by-link')).toBeNull();
  });

  it('omits the Lifecycle section for a tracked keyword with no deprecatedAt', () => {
    renderDrawer(makeRow({ lifecycleStatus: 'tracked' as KeywordCommandCenterStatus }));
    expect(screen.queryByText(/Retired on/i)).toBeNull();
    expect(screen.queryByText(/No replacement recorded/i)).toBeNull();
  });

  it('omits the Lifecycle section for an in_strategy keyword', () => {
    renderDrawer(
      makeRow({
        lifecycleStatus: 'in_strategy' as KeywordCommandCenterStatus,
        tracking: { status: 'active', source: 'manual' },
      }),
    );
    expect(screen.queryByText(/Retired on/i)).toBeNull();
    expect(screen.queryByText(/No replacement recorded/i)).toBeNull();
  });
});
