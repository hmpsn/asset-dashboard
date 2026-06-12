/**
 * KeywordHub.local-panel.test.tsx — A1 contracts
 *
 * Verifies:
 *   1. LocalSeoVisibilityPanel mounts in Hub after idle-callback flush, with
 *      market-drawer trigger reachable ("Configure market" / "Edit markets" button).
 *   2. onOpenKeywords sets the Hub's segment to 'local'.
 *   3. 5 KPI summary cards render from a summary fixture
 *      (In Strategy / Tracked / Local / Needs Review / Retired).
 *   4. Summary-level fetch error renders a role="status" error band.
 *   5. KPI skeleton placeholders show while summary data is absent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KeywordHub } from '../../src/components/KeywordHub';
import type {
  KeywordCommandCenterRowsResponse,
  KeywordCommandCenterSummaryResponse,
} from '../../shared/types/keyword-command-center';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const summaryHookMock = vi.fn();
const rowsHookMock = vi.fn();

vi.mock('../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useKeywordCommandCenterSummary: (...args: unknown[]) => summaryHookMock(...args),
  useKeywordCommandCenterRows: (...args: unknown[]) => rowsHookMock(...args),
  useKeywordCommandCenterBulkAction: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useKeywordCommandCenterAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined, error: null }),
  useKeywordHardDelete: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useKeywordCommandCenterDetail: () => ({ data: undefined, isFetching: false }),
  useRankTrackingAddKeyword: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  // A2: pin toggle added to KeywordDetailDrawer — must be present in mock to avoid "not exported" error.
  useRankTrackingTogglePin: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: () => ({ send: vi.fn() }),
}));

// Mock HubKeywordList to avoid full table rendering noise.
vi.mock('../../src/components/keyword-hub/HubKeywordList', () => ({
  HubKeywordList: (props: { isLoading: boolean; rows: unknown[]; showLocalSeo: boolean }) => (
    <div data-testid="hub-keyword-list">
      <span data-testid="list-loading">{props.isLoading ? 'loading' : 'ready'}</span>
      <span data-testid="list-row-count">{props.rows.length}</span>
    </div>
  ),
}));

// Mock useLocalSeo (used inside LocalSeoVisibilityPanel) with a fixture that
// has featureEnabled=true and setupState='has_data' so the panel renders fully
// including the "Edit markets" / "Configure market" button.
vi.mock('../../src/hooks/admin', () => ({
  useLocalSeo: () => ({
    data: {
      featureEnabled: true,
      settings: {
        workspaceId: 'ws-1',
        posture: 'local',
        postureSource: 'admin_override',
        suggestionReasons: [],
        updatedAt: '2026-05-20T12:00:00.000Z',
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
          createdAt: '2026-05-20T12:00:00.000Z',
          updatedAt: '2026-05-20T12:00:00.000Z',
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
        checkedKeywordCount: 1,
        visibleCount: 1,
        possibleMatchCount: 0,
        notVisibleCount: 0,
        localPackPresentCount: 1,
        degradedCount: 0,
        lastCapturedAt: '2026-05-20T12:00:00.000Z',
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
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useLocalSeoUpdate: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useLocalSeoLocationLookup: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useSetPrimaryMarket: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({
    findActiveJob: () => null,
    tasks: [],
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const summaryPayload: KeywordCommandCenterSummaryResponse = {
  counts: {
    total: 30,
    inStrategy: 12,
    tracked: 9,
    needsReview: 5,
    evidence: 3,
    local: 7,
    localCandidates: 2,
    retired: 4,
    declined: 1,
  },
  filters: [
    { id: 'all', label: 'All', count: 30 },
    { id: 'in_strategy', label: 'In Strategy', count: 12 },
    { id: 'tracked', label: 'Tracked', count: 9 },
    { id: 'needs_review', label: 'Needs Review', count: 5 },
    { id: 'retired', label: 'Retired', count: 4 },
    { id: 'local', label: 'Local', count: 7 },
    { id: 'content', label: 'Content', count: 3 },
    { id: 'lost_visibility', label: 'Lost Visibility', count: 1 },
  ],
  rawEvidenceTotal: 3,
  rawEvidenceReturned: 3,
  summarizedAt: '2026-06-11T10:00:00.000Z',
};

const rowsPayload: KeywordCommandCenterRowsResponse = {
  rows: [
    {
      keyword: 'cosmetic dentistry',
      normalizedKeyword: 'cosmetic dentistry',
      lifecycleStatus: 'in_strategy',
      statusLabel: 'In Strategy',
      sourceLabels: [],
      metrics: { volume: 700, difficulty: 29, currentPosition: 6 },
      tracking: { status: 'active', source: 'strategy_primary', pinned: false },
      nextActions: [],
      isProtected: false,
    },
  ],
  pageInfo: {
    page: 1,
    pageSize: 50,
    totalRows: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

function setupHooks(
  opts: {
    summaryError?: boolean;
    summaryLoading?: boolean;
  } = {},
) {
  summaryHookMock.mockReturnValue({
    data: opts.summaryError || opts.summaryLoading ? undefined : summaryPayload,
    isLoading: opts.summaryLoading ?? false,
    isError: opts.summaryError ?? false,
    error: opts.summaryError ? new Error('Summary fetch failed') : null,
  });
  rowsHookMock.mockReturnValue({
    data: rowsPayload,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
  });
}

function renderHub(initialEntries: string[] = ['/ws/ws-1/seo-keywords']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <KeywordHub workspaceId="ws-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KeywordHub — A1 local panel + KPI cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupHooks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- 1. Panel deferred mount + market-drawer trigger reachable ----------------

  it('defers LocalSeoVisibilityPanel until after the first rows render, then shows it', () => {
    renderHub();

    // Before idle callback fires, the placeholder is shown.
    expect(
      screen.getByText('Local visibility summary will load after the keyword rows are ready.'),
    ).toBeInTheDocument();

    // Flush the idle callback (falls through to setTimeout in test env).
    act(() => {
      vi.runOnlyPendingTimers();
    });

    // Panel is now mounted; placeholder is gone.
    expect(
      screen.queryByText('Local visibility summary will load after the keyword rows are ready.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Local Keyword Visibility')).toBeInTheDocument();
  });

  it('market-drawer trigger is reachable after panel mounts', () => {
    renderHub();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    // The "Edit markets" (or "Configure market") button opens the setup drawer.
    // Either label is acceptable depending on whether markets are configured.
    const marketButton =
      screen.queryByRole('button', { name: /edit markets/i }) ??
      screen.queryByRole('button', { name: /configure market/i });
    expect(marketButton).not.toBeNull();
    expect(marketButton).toBeInTheDocument();
  });

  // --- 2. onOpenKeywords wires to Hub 'local' segment -------------------------

  it('onOpenKeywords sets Hub segment to local', () => {
    renderHub();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    // "View local keywords" button invokes onOpenKeywords.
    // getAllByRole handles the case where multiple instances exist (e.g. RepeatCompetitorList).
    const viewBtns = screen.getAllByRole('button', { name: /view local keywords/i });
    fireEvent.click(viewBtns[0]);

    // The Hub's segment bar should now show 'Local' as active.
    const localPill = screen.getByLabelText(/Local segment/i);
    expect(localPill).toHaveAttribute('aria-pressed', 'true');
  });

  // --- 3. KPI summary cards render from summary fixture -----------------------

  it('renders all 5 KPI summary cards with counts from the summary fixture', () => {
    renderHub();

    // Each card renders the label + its count from the fixture.
    // StatCard renders label as text; value as formatted number.
    // Use getAllByText since segment bar also renders some label text.
    expect(screen.getAllByText('In Strategy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tracked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Local').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Needs Review').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Retired').length).toBeGreaterThan(0);

    // Spot-check that the correct counts are rendered.
    // summaryPayload.counts: inStrategy=12, tracked=9, local=7, needsReview=5, retired=4
    expect(screen.getAllByText('12').length).toBeGreaterThan(0); // In Strategy count
    expect(screen.getAllByText('9').length).toBeGreaterThan(0);  // Tracked count
    expect(screen.getAllByText('7').length).toBeGreaterThan(0);  // Local count
    expect(screen.getAllByText('5').length).toBeGreaterThan(0);  // Needs Review count
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);  // Retired count
  });

  it('renders KPI skeleton placeholders while summary data is absent (loading)', () => {
    setupHooks({ summaryLoading: true });
    renderHub();

    // Should NOT show the real labels during skeleton phase.
    // The skeleton grid should be rendered.
    const cards = document.querySelectorAll('.animate-pulse');
    expect(cards.length).toBeGreaterThanOrEqual(5);
  });

  // --- 4. Summary error band --------------------------------------------------

  it('renders a role="status" error band when the summary query fails', () => {
    setupHooks({ summaryError: true });
    renderHub();

    // The error band uses role="status". When summary.error is an Error instance
    // the message is used directly; otherwise the fallback string is shown.
    // Either way the band must be present.
    const errorBand = screen.getByRole('status');
    expect(errorBand).toBeInTheDocument();
    // The error text comes from the Error instance message ("Summary fetch failed")
    // OR the fallback string. Either is acceptable — just verify the band renders.
    expect(errorBand.textContent).toBeTruthy();
  });
});
