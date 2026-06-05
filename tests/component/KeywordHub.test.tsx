/**
 * KeywordHub.test.tsx — the full Hub shell assembly (P1-T4).
 *
 * Verifies:
 *   - initializes segment from ?tab=tracked (two-halves deep-link contract)
 *   - invalid ?tab= → all; no ?tab= → all
 *   - PageHeader "Keyword Hub"
 *   - HubSegmentBar with counts from summary
 *   - search input updates searchTerm (debounced → rows query)
 *   - renders HubAdvancedFilters
 *   - loading state when rows pending; rows when loaded
 *   - showLocalSeo true/false per `local-seo-visibility` flag
 *   - changing segment resets to page 1
 *   - useWorkspaceEvents registered for RANK_TRACKING_UPDATED + STRATEGY_UPDATED
 *   - bulk action mutation called when emitted from the list
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KeywordHub } from '../../src/components/KeywordHub';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  type KeywordCommandCenterRowsResponse,
  type KeywordCommandCenterSummaryResponse,
} from '../../shared/types/keyword-command-center';
import { WS_EVENTS } from '../../src/lib/wsEvents';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const summaryHookMock = vi.fn();
const rowsHookMock = vi.fn();
const bulkMutateMock = vi.fn();
const rowActionMutateMock = vi.fn();
const hardDeleteMutateMock = vi.fn();
const featureFlagMock = vi.fn();
const workspaceEventsMock = vi.fn();

vi.mock('../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useKeywordCommandCenterSummary: (...args: unknown[]) => summaryHookMock(...args),
  useKeywordCommandCenterRows: (...args: unknown[]) => rowsHookMock(...args),
  useKeywordCommandCenterBulkAction: () => ({ mutate: bulkMutateMock, isPending: false }),
  useKeywordCommandCenterAction: () => ({ mutate: rowActionMutateMock, isPending: false, variables: undefined }),
  useKeywordHardDelete: () => ({ mutate: hardDeleteMutateMock, isPending: false }),
  useKeywordCommandCenterDetail: () => ({ data: undefined, isFetching: false }),
}));

vi.mock('../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...args),
}));

vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (workspaceId: string, handlers: Record<string, unknown>) => {
    workspaceEventsMock(workspaceId, handlers);
    return { send: vi.fn() };
  },
}));

// Mock the HubKeywordList so we can drive its callbacks without the full table
vi.mock('../../src/components/keyword-hub/HubKeywordList', () => ({
  HubKeywordList: (props: {
    isLoading: boolean;
    rows: { normalizedKeyword: string }[];
    showLocalSeo: boolean;
    onToggleKey: (k: string) => void;
    onBulkAction: (action: string) => void;
    onSort: (key: string) => void;
  }) => (
    <div data-testid="hub-keyword-list">
      <span data-testid="list-loading">{props.isLoading ? 'loading' : 'ready'}</span>
      <span data-testid="list-row-count">{props.rows.length}</span>
      <span data-testid="list-show-local">{props.showLocalSeo ? 'true' : 'false'}</span>
      {/* Selecting a row routes through the shared hub state (real useKeywordHubState). */}
      <button
        data-testid="select-first"
        onClick={() => props.onToggleKey(props.rows[0]?.normalizedKeyword)}
      >
        select
      </button>
      <button
        data-testid="trigger-bulk"
        onClick={() => props.onBulkAction(KEYWORD_COMMAND_CENTER_ACTIONS.TRACK)}
      >
        bulk
      </button>
      {/* Drives the real useKeywordHubState.setSort, exercising the direction toggle. */}
      <button data-testid="sort-clicks" onClick={() => props.onSort('clicks')}>
        sort clicks
      </button>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const summaryPayload: KeywordCommandCenterSummaryResponse = {
  counts: {
    total: 42,
    inStrategy: 10,
    tracked: 8,
    needsReview: 4,
    evidence: 6,
    local: 5,
    localCandidates: 2,
    retired: 3,
    declined: 1,
  },
  filters: [
    { id: 'all', label: 'All', count: 42 },
    { id: 'in_strategy', label: 'In Strategy', count: 10 },
    { id: 'tracked', label: 'Tracked', count: 8 },
    { id: 'needs_review', label: 'Needs Review', count: 4 },
    { id: 'retired', label: 'Retired', count: 3 },
    { id: 'local', label: 'Local', count: 5 },
    { id: 'content', label: 'Content', count: 6 },
    { id: 'lost_visibility', label: 'Lost Visibility', count: 1 },
  ],
  rawEvidenceTotal: 6,
  rawEvidenceReturned: 6,
  summarizedAt: '2026-06-04T12:00:00.000Z',
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

function setupHooks(opts: { rowsLoading?: boolean; localFlag?: boolean } = {}) {
  summaryHookMock.mockReturnValue({ data: summaryPayload, isLoading: false, error: null });
  rowsHookMock.mockReturnValue({
    data: opts.rowsLoading ? undefined : rowsPayload,
    isLoading: opts.rowsLoading ?? false,
    isError: false,
    error: null,
  });
  featureFlagMock.mockImplementation((flag: string) =>
    flag === 'local-seo-visibility' ? (opts.localFlag ?? false) : false,
  );
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

describe('KeywordHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHooks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the PageHeader "Keyword Hub"', () => {
    renderHub();
    expect(screen.getByText('Keyword Hub')).toBeInTheDocument();
  });

  it('renders HubSegmentBar with counts from summary', () => {
    renderHub();
    expect(screen.getByLabelText('Keyword segments')).toBeInTheDocument();
    // "All" pill aria-label carries the count (42)
    expect(screen.getByLabelText(/All segment, 42 keywords/)).toBeInTheDocument();
  });

  it('initializes the segment from ?tab=tracked (two-halves deep-link contract)', () => {
    renderHub(['/ws/ws-1/seo-keywords?tab=tracked']);
    // The Tracked pill is active (aria-pressed=true)
    const tracked = screen.getByLabelText(/Tracked segment/);
    expect(tracked).toHaveAttribute('aria-pressed', 'true');
    // And the rows query was called with the tracked filter
    const lastRowsCall = rowsHookMock.mock.calls.at(-1);
    expect(lastRowsCall?.[1]).toMatchObject({ filter: 'tracked' });
  });

  it('falls back to "all" for an invalid ?tab= value', () => {
    renderHub(['/ws/ws-1/seo-keywords?tab=bogus']);
    const all = screen.getByLabelText(/All segment/);
    expect(all).toHaveAttribute('aria-pressed', 'true');
  });

  it('defaults to "all" when no ?tab= is present', () => {
    renderHub(['/ws/ws-1/seo-keywords']);
    const all = screen.getByLabelText(/All segment/);
    expect(all).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders HubAdvancedFilters', () => {
    renderHub();
    expect(screen.getByLabelText('Filters')).toBeInTheDocument();
  });

  it('renders the rows list when loaded', () => {
    renderHub();
    expect(screen.getByTestId('list-loading')).toHaveTextContent('ready');
    expect(screen.getByTestId('list-row-count')).toHaveTextContent('1');
  });

  it('passes loading state to the list when rows are pending', () => {
    setupHooks({ rowsLoading: true });
    renderHub();
    expect(screen.getByTestId('list-loading')).toHaveTextContent('loading');
  });

  it('passes showLocalSeo=true only when local-seo-visibility flag is on', () => {
    setupHooks({ localFlag: true });
    renderHub();
    expect(screen.getByTestId('list-show-local')).toHaveTextContent('true');
  });

  it('passes showLocalSeo=false when local-seo-visibility flag is off', () => {
    setupHooks({ localFlag: false });
    renderHub();
    expect(screen.getByTestId('list-show-local')).toHaveTextContent('false');
  });

  it('updates the search term and feeds debouncedSearch to the rows query', () => {
    vi.useFakeTimers();
    renderHub();
    const input = screen.getByLabelText('Search keywords');
    fireEvent.change(input, { target: { value: 'dentist' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const lastRowsCall = rowsHookMock.mock.calls.at(-1);
    expect(lastRowsCall?.[1]).toMatchObject({ search: 'dentist' });
  });

  it('registers useWorkspaceEvents for RANK_TRACKING_UPDATED and STRATEGY_UPDATED', () => {
    renderHub();
    expect(workspaceEventsMock).toHaveBeenCalled();
    const [wsId, handlers] = workspaceEventsMock.mock.calls.at(-1)!;
    expect(wsId).toBe('ws-1');
    expect(handlers).toHaveProperty(WS_EVENTS.RANK_TRACKING_UPDATED);
    expect(handlers).toHaveProperty(WS_EVENTS.STRATEGY_UPDATED);
  });

  it('calls the bulk action mutation with the selected keys when the list emits a bulk action', () => {
    renderHub();
    // Select a row first (mirrors real flow: the bulk bar only renders when something is selected).
    fireEvent.click(screen.getByTestId('select-first'));
    fireEvent.click(screen.getByTestId('trigger-bulk'));
    expect(bulkMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: KEYWORD_COMMAND_CENTER_ACTIONS.TRACK,
        keywords: ['cosmetic dentistry'],
      }),
      expect.anything(),
    );
  });

  it('maps the Clicks column to sort=clicks and threads the toggled direction into rowsQuery', () => {
    renderHub();
    // First click on a new column → sort=clicks, direction resets to 'asc'.
    fireEvent.click(screen.getByTestId('sort-clicks'));
    const afterFirst = rowsHookMock.mock.calls.at(-1);
    expect(afterFirst?.[1]).toMatchObject({ sort: 'clicks', direction: 'asc' });

    // Clicking the same column again flips the direction → 'desc', proving the
    // toggle is wired all the way into the rows query (not stuck on the default).
    fireEvent.click(screen.getByTestId('sort-clicks'));
    const afterSecond = rowsHookMock.mock.calls.at(-1);
    expect(afterSecond?.[1]).toMatchObject({ sort: 'clicks', direction: 'desc' });
  });

  it('resets to page 1 when the segment changes', () => {
    renderHub(['/ws/ws-1/seo-keywords?tab=tracked']);
    // Switch to the "Retired" segment
    fireEvent.click(screen.getByLabelText(/Retired segment/));
    const lastRowsCall = rowsHookMock.mock.calls.at(-1);
    expect(lastRowsCall?.[1]).toMatchObject({ filter: 'retired', page: 1 });
  });
});
