import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client';
import { Dashboard } from '../../../src/App';
import { ToastProvider } from '../../../src/components/Toast';
import { KeywordsSurface } from '../../../src/components/keywords-rebuilt/KeywordsSurface';
import { queryKeys } from '../../../src/lib/queryKeys';
import { WS_EVENTS } from '../../../src/lib/wsEvents';
import { KEYWORD_COMMAND_CENTER_ACTIONS, KEYWORD_COMMAND_CENTER_FILTERS } from '../../../shared/types/keyword-command-center';
import type {
  KeywordCommandCenterFilterMeta,
  KeywordCommandCenterRow,
  KeywordCommandCenterRowsQuery,
  KeywordCommandCenterRowsResponse,
  KeywordCommandCenterSummaryResponse,
} from '../../../shared/types/keyword-command-center';
import { KEYWORD_LIFECYCLE_STAGES } from '../../../shared/types/keyword-command-center';
import { expectNoA11yViolations } from '../a11y';

const mockCreate = vi.fn();
const mockDelete = vi.fn();
const mockLink = vi.fn();
const mockUnlink = vi.fn();
const initialHookMock = vi.fn();
const summaryHookMock = vi.fn();
const rowsHookMock = vi.fn();
const detailHookMock = vi.fn();
const bulkMutateMock = vi.fn();
const rowActionMutateMock = vi.fn();
const hardDeleteMutateMock = vi.fn();
const pinMutateMock = vi.fn();
const nationalRefreshMutateMock = vi.fn();
const localRefreshMutateMock = vi.fn();
const addKeywordMutateMock = vi.fn();
const apiGetMock = vi.fn();
let capturedWorkspaceHandlers: Record<string, (data?: unknown) => void> = {};

const workspace = {
  id: 'ws-1',
  name: 'Acme',
  webflowSiteId: 'site-1',
  webflowSiteName: 'acme.com',
  folder: 'acme',
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

vi.mock('../../../src/hooks/admin', () => ({
  WORKSPACES_KEY: ['workspaces'],
  QUEUE_KEY: ['queue'],
  useWorkspaces: () => ({ data: [workspace] }),
  useHealthCheck: () => ({
    data: { hasOpenAIKey: false, hasWebflowToken: true },
    isSuccess: true,
  }),
  useQueue: () => ({ data: [] }),
  useWorkspaceBadges: () => ({ data: { pendingRequests: 0 } }),
  useCreateWorkspace: () => ({ mutateAsync: mockCreate }),
  useDeleteWorkspace: () => ({ mutateAsync: mockDelete }),
  useLinkSite: () => ({ mutateAsync: mockLink }),
  useUnlinkSite: () => ({ mutateAsync: mockUnlink }),
}));

vi.mock('../../../src/hooks/admin/useNotifications', () => ({
  useNotifications: () => ({ data: [] }),
}));

vi.mock('../../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useKeywordCommandCenterInitialView: (...args: unknown[]) => initialHookMock(...args),
  useKeywordCommandCenterSummary: (...args: unknown[]) => summaryHookMock(...args),
  useKeywordCommandCenterRows: (...args: unknown[]) => rowsHookMock(...args),
  useKeywordCommandCenterBulkAction: () => ({ mutate: bulkMutateMock, isPending: false }),
  useKeywordCommandCenterDetail: (...args: unknown[]) => detailHookMock(...args),
  useKeywordCommandCenterAction: () => ({ mutate: rowActionMutateMock, isPending: false, error: null, variables: undefined }),
  useKeywordHardDelete: () => ({ mutate: hardDeleteMutateMock, isPending: false, error: null }),
  useRankTrackingAddKeyword: () => ({ mutate: addKeywordMutateMock, isPending: false, error: null }),
  useRankTrackingTogglePin: () => ({ mutate: pinMutateMock, isPending: false, error: null }),
  useNationalSerpRefresh: () => ({ mutate: nationalRefreshMutateMock, isPending: false, error: null }),
}));

vi.mock('../../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeoRefresh: () => ({ mutate: localRefreshMutateMock, isPending: false, error: null }),
}));

vi.mock('../../../src/components/strategy/hooks/useKeywordFeedback', () => ({
  useKeywordFeedback: () => ({
    rows: [
      {
        keyword: 'dental implants',
        status: 'requested',
        reason: 'Client wants this service prioritized.',
        source: 'content_gap',
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        declined_by: null,
      },
      {
        keyword: 'cheap veneers',
        status: 'declined',
        reason: 'Off-brand query.',
        source: 'opportunity',
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        declined_by: 'client',
      },
    ],
    addError: null,
    setAddError: vi.fn(),
    addRequestedKeyword: vi.fn(),
    addPending: false,
  }),
}));

vi.mock('../../../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/client')>('../../../src/api/client');
  return {
    ...actual,
    get: (...args: unknown[]) => apiGetMock(...args),
  };
});

vi.mock('../../../src/hooks/useGlobalAdminEvents', () => ({
  useGlobalAdminEvents: vi.fn(),
}));

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (_workspaceId: string | undefined, handlers: Record<string, (data?: unknown) => void>) => {
    capturedWorkspaceHandlers = handlers;
    return { send: vi.fn() };
  },
}));

vi.mock('../../../src/hooks/useWsInvalidation', () => ({
  useWsInvalidation: vi.fn(),
}));

vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      list: () => Promise.resolve({ 'ui-rebuild-shell': true }),
    },
  };
});

vi.mock('../../../src/components/KeywordHub', () => ({
  KeywordHub: () => <div data-testid="legacy-keyword-hub">Legacy Keyword Hub</div>,
}));

vi.mock('../../../src/components/layout/Sidebar', () => ({
  Sidebar: () => <aside data-testid="legacy-sidebar">Legacy sidebar</aside>,
}));

vi.mock('../../../src/components/layout/Breadcrumbs', () => ({
  Breadcrumbs: () => <nav data-testid="legacy-breadcrumbs">Legacy breadcrumbs</nav>,
}));

vi.mock('../../../src/components/StatusBar', () => ({
  StatusBar: () => <footer data-testid="legacy-status">Legacy status</footer>,
}));

vi.mock('../../../src/components/CommandPalette', () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

vi.mock('../../../src/components/AdminChat', () => ({
  AdminChat: () => <div data-testid="admin-chat" />,
}));

const summaryPayload: KeywordCommandCenterSummaryResponse = {
  counts: {
    total: 2,
    inStrategy: 1,
    tracked: 1,
    needsReview: 0,
    evidence: 0,
    local: 1,
    localCandidates: 0,
    retired: 0,
    declined: 0,
  },
  filters: [
    { id: 'all', label: 'All', count: 2 },
    { id: 'tracked', label: 'Tracked', count: 2 },
    { id: 'page_assigned', label: 'Page assigned', count: 2 },
    { id: 'requested', label: 'Requested', count: 1 },
    { id: 'lost_visibility', label: 'Lost visibility', count: 1 },
  ] as KeywordCommandCenterFilterMeta[],
  rawEvidenceTotal: 120,
  rawEvidenceReturned: 75,
  summarizedAt: '2026-07-05T12:00:00.000Z',
  trafficValueMonthly: 1234,
  topicClusters: [
    {
      topic: 'Dental services',
      keywords: ['cosmetic dentistry', 'emergency dentist'],
      ownedCount: 2,
      totalCount: 3,
      coveragePercent: 67,
      avgPosition: 10,
      gap: ['dental implants'],
    },
  ],
  cannibalization: [
    {
      keyword: 'cosmetic dentistry',
      pages: [{ path: '/cosmetic-dentistry', source: 'keyword_map' }],
      severity: 'high',
      recommendation: 'Pick a canonical service page.',
    },
  ],
};

const rows: KeywordCommandCenterRow[] = [
  {
    keyword: 'cosmetic dentistry',
    normalizedKeyword: 'cosmetic dentistry',
    lifecycleStatus: 'in_strategy',
    statusLabel: 'In Strategy',
    sourceLabels: [],
    metrics: {
      intent: 'commercial',
      currentPosition: 6,
      nationalPosition: 4,
      matchedUrl: 'https://acme.com/cosmetic-dentistry',
      serpFeatures: ['featured_snippet'],
      aiOverviewPresent: true,
      aiOverviewCited: true,
      clicks: 42,
      impressions: 900,
      volume: 700,
      difficulty: 29,
    },
    assignment: { pagePath: '/cosmetic-dentistry', pageTitle: 'Cosmetic Dentistry', topicCluster: 'Dental services' },
    tracking: { status: 'active', source: 'strategy_primary', sourceGapKey: 'gap-1', strategyOwned: true },
    nextActions: [
      {
        type: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
        label: 'Retire keyword',
        detail: 'Pause active tracking once the page is no longer strategic.',
        tone: 'amber',
        keyword: 'cosmetic dentistry',
      },
      {
        type: 'check_local_visibility',
        label: 'Refresh local visibility',
        detail: 'Refresh local pack visibility for this keyword.',
        tone: 'teal',
        keyword: 'cosmetic dentistry',
      },
      {
        type: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
        label: 'Pause tracking',
        detail: 'Pause rank tracking while retaining history.',
        tone: 'amber',
        keyword: 'cosmetic dentistry',
      },
      {
        type: KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
        label: 'Decline keyword',
        detail: 'Mark this keyword as declined.',
        tone: 'red',
        keyword: 'cosmetic dentistry',
      },
      {
        type: KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE,
        label: 'Restore keyword',
        detail: 'Restore this keyword to active consideration.',
        tone: 'teal',
        keyword: 'cosmetic dentistry',
      },
      {
        type: 'review_page',
        label: 'Review page',
        detail: 'Open the assigned page for review.',
        tone: 'blue',
        keyword: 'cosmetic dentistry',
        pagePath: '/cosmetic-dentistry',
      },
      {
        type: 'generate_brief',
        label: 'Generate brief',
        detail: 'Create a content brief for this keyword.',
        tone: 'blue',
        keyword: 'cosmetic dentistry',
      },
    ],
    isProtected: false,
    localSeoState: {
      lifecycle: 'checked',
      lifecycleLabel: 'Tracked locally',
      priority: 'high_opportunity',
      priorityLabel: 'High opportunity',
      detail: 'Primary service market',
      checked: true,
      marketLabel: 'Austin',
      sourceLabels: ['GBP'],
      localPackPresent: true,
      businessMatchConfidence: 'verified',
    },
    localSeo: {
      keyword: 'cosmetic dentistry',
      normalizedKeyword: 'cosmetic dentistry',
      marketId: 'market-austin',
      marketLabel: 'Austin',
      capturedAt: '2026-07-01T00:00:00.000Z',
      posture: 'visible',
      label: 'Visible #2',
      detail: 'Business appears in local results.',
      localPackPresent: true,
      businessFound: true,
      businessMatchConfidence: 'verified',
      localRank: 2,
      sourceEndpoint: 'google_maps',
      provider: 'dataforseo',
      topCompetitors: [
        { title: 'Austin Smile Studio', rank: 1, domain: 'smile.example' },
      ],
      marketCount: 1,
      markets: [
        {
          keyword: 'cosmetic dentistry',
          normalizedKeyword: 'cosmetic dentistry',
          marketId: 'market-austin',
          marketLabel: 'Austin',
          capturedAt: '2026-07-01T00:00:00.000Z',
          posture: 'visible',
          label: 'Visible #2',
          detail: 'Business appears in local results.',
          localPackPresent: true,
          businessFound: true,
          businessMatchConfidence: 'verified',
          localRank: 2,
          sourceEndpoint: 'google_maps',
          provider: 'dataforseo',
        },
      ],
      visibleMarketCount: 1,
      possibleMatchMarketCount: 0,
      localPackOnlyMarketCount: 0,
      notVisibleMarketCount: 0,
      degradedMarketCount: 0,
    },
    opportunityScore: 84,
    currentMonthly: 1234,
    upsideMonthly: 2400,
    valueReasons: ['Page-one rankings with meaningful click volume.', 'Commercial intent supports revenue tracking.'],
    lifecycleStage: KEYWORD_LIFECYCLE_STAGES.RANKING,
  },
  {
    keyword: 'emergency dentist',
    normalizedKeyword: 'emergency dentist',
    lifecycleStatus: 'tracked',
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: { intent: 'local', currentPosition: 14, clicks: 5, impressions: 240, volume: 300, difficulty: 18 },
    assignment: { pagePath: '/emergency-dentist', pageTitle: 'Emergency Dentist', topicCluster: 'Dental services' },
    tracking: { status: 'active', source: 'manual', strategyOwned: false, pinned: false },
    nextActions: [
      {
        type: KEYWORD_COMMAND_CENTER_ACTIONS.TRACK,
        label: 'Track keyword',
        detail: 'Keep this keyword in active rank tracking.',
        tone: 'teal',
        keyword: 'emergency dentist',
      },
    ],
    isProtected: true,
    protectionReason: 'Tracked client keyword',
    opportunityScore: 66,
    lifecycleStage: KEYWORD_LIFECYCLE_STAGES.WINNING,
  },
];

function setupKeywordHooks() {
  capturedWorkspaceHandlers = {};
  summaryHookMock.mockReturnValue({
    data: summaryPayload,
    isLoading: false,
    isError: false,
    error: null,
  });
  const rowsResponse = (query: KeywordCommandCenterRowsQuery): KeywordCommandCenterRowsResponse => {
    const page = query.page ?? 1;
    return {
      rows,
      pageInfo: {
        page,
        pageSize: query.pageSize ?? 50,
        totalRows: rows.length,
        totalPages: 3,
        hasNextPage: page < 3,
        hasPreviousPage: page > 1,
      },
    };
  };
  initialHookMock.mockImplementation((_workspaceId: string, query: KeywordCommandCenterRowsQuery) => ({
    data: {
      summary: summaryPayload,
      rows: rowsResponse(query),
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }));
  rowsHookMock.mockImplementation((_workspaceId: string, query: KeywordCommandCenterRowsQuery) => {
    const response = rowsResponse(query);
    return {
      data: response,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
  });
  detailHookMock.mockImplementation((_workspaceId: string, keyword: string | null) => {
    const row = keyword ? rows.find((candidate) => candidate.normalizedKeyword === keyword || candidate.keyword === keyword) : undefined;
    return {
      data: row ? {
        row,
        outcome: row.keyword === 'cosmetic dentistry'
          ? {
              actionId: 'act-1',
              actionType: 'strategy_keyword_added',
              score: 'win',
              checkpointDays: 30,
              primaryMetric: 'position',
              direction: 'improved',
              baselineValue: 14,
              currentValue: 6,
              baselinePosition: 14,
              currentPosition: 6,
              baselineClicks: null,
              currentClicks: null,
              measuredAt: '2026-07-01T00:00:00.000Z',
            }
          : undefined,
      } : undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    };
  });
  bulkMutateMock.mockImplementation((_body: unknown, options?: { onSuccess?: (result: { message: string }) => void }) => {
    options?.onSuccess?.({ message: 'Bulk action complete' });
  });
  rowActionMutateMock.mockImplementation((_body: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
  });
  hardDeleteMutateMock.mockImplementation((_vars: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
  });
  pinMutateMock.mockImplementation((_keyword: string, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
  });
  nationalRefreshMutateMock.mockImplementation((_vars?: void, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
  });
  localRefreshMutateMock.mockImplementation((_body: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
  });
  addKeywordMutateMock.mockImplementation((_keyword: string, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
  });
  apiGetMock.mockResolvedValue([
    { date: '2026-07-01', positions: { 'cosmetic dentistry': 8, 'emergency dentist': 16 } },
    { date: '2026-07-02', positions: { 'cosmetic dentistry': 6, 'emergency dentist': 14 } },
  ]);
}

function renderSurface(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <KeywordsSurface workspaceId="ws-1" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function renderDashboard(path = '/ws/ws-1/seo-keywords?lens=lifecycle') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Dashboard theme="dark" toggleTheme={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KeywordsSurface rebuilt pilot scaffold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupKeywordHooks();
  });

  it('receives rebuilt lens, filter, search, page, and keyword deep-link params', async () => {
    const { container } = renderSurface('/ws/ws-1/seo-keywords?lens=lifecycle&filter=tracked&search=cosmetic&page=3&q=emergency+dentist');

    expect(screen.getByRole('radio', { name: /Lifecycle/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: /^Tracked/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('searchbox')).toHaveValue('cosmetic');
    expect(initialHookMock.mock.calls.at(-1)?.[1]).toMatchObject({ filter: 'tracked', search: 'cosmetic', page: 3 });
    // The keyword deep-link opens the detail drawer (the stray keyword-labeled button
    // above the lenses was removed as dead UI); the drawer's title carries the keyword.
    expect(screen.getByRole('dialog', { name: /emergency dentist/i })).toBeInTheDocument();

    await expectNoA11yViolations(container);
  }, 15_000);

  it('preserves legacy ?tab segment links by treating them as filters', () => {
    renderSurface('/ws/ws-1/seo-keywords?tab=tracked&q=cosmetic+dentistry');

    expect(screen.getByRole('radio', { name: /Rankings/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: /^Tracked/ })).toHaveAttribute('aria-pressed', 'true');
    // Keyword deep-link opens the detail drawer, titled with the keyword.
    expect(screen.getByRole('dialog', { name: /cosmetic dentistry/i })).toBeInTheDocument();
  });

  it('keeps an inbound ?tab filter when the user switches lens (review PR #1480)', () => {
    renderSurface('/ws/ws-1/seo-keywords?tab=tracked');
    expect(screen.getByRole('button', { name: /^Tracked/ })).toHaveAttribute('aria-pressed', 'true');

    // Switching lens must NOT clobber the inbound filter: the lens now owns its own
    // `?lens=` param, not the shared `?tab=` segment that carries the filter. Previously
    // setLens overwrote `tab`, silently dropping the filter back to 'all'.
    fireEvent.click(screen.getByRole('radio', { name: /Opportunities/ }));

    expect(screen.getByRole('radio', { name: /Opportunities/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: /^Tracked/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses the combined initial view except for the local-candidates full-model exception', () => {
    renderSurface(`/ws/ws-1/seo-keywords?filter=${KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES}`);

    expect(initialHookMock.mock.calls.at(-1)?.[2]).toMatchObject({ enabled: false });
    expect(summaryHookMock.mock.calls.at(-1)?.[1]).toMatchObject({ enabled: true });
    expect(rowsHookMock.mock.calls.at(-1)?.[1]).toMatchObject({ filter: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES });
  });

  it('composes four truthful summary cells before the lens tray and separate working tools', () => {
    renderSurface('/ws/ws-1/seo-keywords');

    const surface = screen.getByTestId('keywords-surface');
    const summary = within(surface).getByTestId('keywords-summary');
    const lensTray = within(surface).getByTestId('keywords-lens-tray');
    const tools = within(surface).getByTestId('keywords-tools');

    expect(surface).toHaveClass('max-w-[1128px]');
    expect(within(summary).getAllByTestId('keywords-summary-cell')).toHaveLength(4);
    expect(within(summary).getByText('Total keywords')).toBeInTheDocument();
    expect(within(summary).getByText('Rank tracked')).toBeInTheDocument();
    expect(within(summary).getByText('Needs review')).toBeInTheDocument();
    expect(within(summary).getByText('Monthly value')).toBeInTheDocument();
    expect(summary.compareDocumentPosition(lensTray) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lensTray.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(tools).getByRole('searchbox')).toBeInTheDocument();
    expect(within(tools).getByLabelText('Advanced keyword filter')).toBeInTheDocument();
  });

  it('renders keyword rows, provenance, opportunity, and money empty states without fabricating dollars', () => {
    renderSurface('/ws/ws-1/seo-keywords');

    expect(screen.getByText('cosmetic dentistry')).toBeInTheDocument();
    expect(screen.getByText('Commercial')).toBeInTheDocument();
    expect(screen.getByText('#6')).toBeInTheDocument();
    expect(screen.getAllByText('$1,234').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('700')).toBeInTheDocument();
    expect(screen.getByText('29')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Tracked locally')).toBeInTheDocument();
    expect(screen.getByText('From gap')).toBeInTheDocument();
    expect(screen.getByText('Auto-managed')).toBeInTheDocument();
    // Empty money/number cells render a quiet em-dash placeholder — never a word
    // ("No CPC") in the bright numeric column, and never a fabricated $0.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
    expect(screen.queryByText('No CPC')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: /45 more keywords hidden/i })).toBeInTheDocument();
  });

  it('gives the Opportunities lens its own upside-focused shape (Est. gain + Fix, not the Rankings grid)', () => {
    renderSurface('/ws/ws-1/seo-keywords?lens=opportunities');

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    // Distinct triage columns…
    expect(headers).toContain('Est. gain');
    expect(headers).toContain('Fix');
    // …and NOT the wide Rankings grid re-sorted.
    expect(headers).not.toContain('Clicks');
    expect(headers).not.toContain('KD');
  });

  it('threads sort and pagination controls into the rows query', async () => {
    renderSurface('/ws/ws-1/seo-keywords');

    expect(initialHookMock.mock.calls.at(-1)?.[1]).toMatchObject({ sort: 'rank', direction: 'asc' });

    fireEvent.click(screen.getByRole('button', { name: 'Clicks' }));
    await waitFor(() => {
      expect(initialHookMock.mock.calls.at(-1)?.[1]).toMatchObject({ sort: 'clicks', direction: 'asc' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(initialHookMock.mock.calls.at(-1)?.[1]).toMatchObject({ page: 2 });
    });
  });

  it('supports manual add, advanced filters, select-visible, and client feedback actions', async () => {
    renderSurface('/ws/ws-1/seo-keywords');

    fireEvent.change(screen.getByLabelText('Add keyword'), { target: { value: 'dental crowns' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(addKeywordMutateMock).toHaveBeenCalledWith('dental crowns', expect.anything());
    expect(screen.getByText('Keyword added to rank tracking')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Advanced keyword filter'), { target: { value: 'requested' } });
    await waitFor(() => {
      expect(initialHookMock.mock.calls.at(-1)?.[1]).toMatchObject({ filter: 'requested' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Select visible 2' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    expect(screen.getByText('Client keyword feedback')).toBeInTheDocument();
    expect(screen.getByText('dental implants')).toHaveClass('t-ui');
    expect(screen.getByText('Client wants this service prioritized.')).toHaveClass('t-caption-sm');
    expect(screen.getByText(/Clicks & impressions:/)).toHaveClass('t-body');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to strategy' }).at(-1)!);
    expect(rowActionMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
        keyword: 'dental implants',
      }),
      expect.anything(),
    );
  });

  it('switches lenses, updates the URL-backed query, and renders grouped shapes', async () => {
    const { container } = renderSurface('/ws/ws-1/seo-keywords');
    await expectNoA11yViolations(container);

    fireEvent.click(screen.getByRole('radio', { name: /Opportunities/ }));
    await waitFor(() => {
      expect(initialHookMock.mock.calls.at(-1)?.[1]).toMatchObject({ sort: 'opportunity', direction: 'desc' });
    });
    await expectNoA11yViolations(container);

    fireEvent.click(screen.getByRole('radio', { name: /Pages/ }));
    await waitFor(() => {
      expect(screen.getAllByText('Cosmetic Dentistry').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Cannibalization risk')).toBeInTheDocument();
    await expectNoA11yViolations(container);

    fireEvent.click(screen.getByRole('radio', { name: /Clusters/ }));
    await waitFor(() => {
      expect(screen.getByText('Dental services')).toBeInTheDocument();
    });
    expect(screen.getByText('2/3 covered')).toBeInTheDocument();
    await expectNoA11yViolations(container);

    fireEvent.click(screen.getByRole('radio', { name: /Lifecycle/ }));
    await waitFor(() => {
      expect(screen.getByText('Ranking')).toBeInTheDocument();
      expect(screen.getByText('Winning')).toBeInTheDocument();
    });
    expect(screen.getByText('cosmetic dentistry')).toBeInTheDocument();
    expect(screen.getByText('emergency dentist')).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('opens the detail drawer from a row click and renders value, provenance, and outcome context', async () => {
    const { container } = renderSurface('/ws/ws-1/seo-keywords');

    fireEvent.click(screen.getAllByText('cosmetic dentistry')[0]);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveStyle({ width: '440px' });
    expect(within(dialog).getByRole('heading', { name: 'cosmetic dentistry' })).toBeInTheDocument();
    expect(within(dialog).getByText('#14 → #6 · Win · 30d')).toBeInTheDocument();
    expect(within(dialog).getByText('Why this score')).toBeInTheDocument();
    expect(within(dialog).getByText('Page-one rankings with meaningful click volume.')).toBeInTheDocument();
    expect(within(dialog).getByText('$2,400/mo')).toBeInTheDocument();
    expect(within(dialog).getByText('strategy primary')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Austin').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Live SERP #4')).toHaveClass('t-ui');
    expect(within(dialog).getByText('Cited in AI Overview')).toBeInTheDocument();
    expect(within(dialog).getByText('Snippet')).toBeInTheDocument();
    expect(within(dialog).getByText('Visible #2')).toBeInTheDocument();
    expect(within(dialog).getByText(/Austin Smile Studio/)).toHaveClass('t-ui');
    expect(within(dialog).getByText('Top local result evidence')).toHaveClass('t-ui');
    expect(within(dialog).getByText(/Local SEO is market-specific local-pack visibility/)).toHaveClass('t-body');
    expect(within(dialog).getByRole('button', { name: 'Generate brief' })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('opens the detail drawer from a ?q deep link', async () => {
    renderSurface('/ws/ws-1/seo-keywords?q=emergency+dentist');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'emergency dentist' })).toBeInTheDocument();
    expect(within(dialog).getByText('Tracked client keyword')).toBeInTheDocument();
    expect(within(dialog).getByText('No sources linked')).toBeInTheDocument();
    expect(within(dialog).getAllByText('—').length).toBeGreaterThan(0);
    expect(within(dialog).queryByText('No CPC')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Keyword command center/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/No source labels/i)).not.toBeInTheDocument();
  });

  it('invalidates the keyword command-center prefix for live workspace events', () => {
    const { queryClient } = renderSurface('/ws/ws-1/seo-keywords');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => {
      capturedWorkspaceHandlers[WS_EVENTS.RANK_TRACKING_UPDATED]?.();
      capturedWorkspaceHandlers[WS_EVENTS.SERP_SNAPSHOTS_REFRESHED]?.();
      capturedWorkspaceHandlers[WS_EVENTS.STRATEGY_UPDATED]?.();
    });

    const invalidatedKeys = invalidateSpy.mock.calls
      .map(([arg]) => (arg as { queryKey?: readonly unknown[] }).queryKey)
      .filter((key): key is readonly unknown[] => Array.isArray(key));

    expect(invalidatedKeys).toEqual([
      queryKeys.admin.keywordCommandCenter('ws-1'),
      queryKeys.admin.keywordCommandCenter('ws-1'),
      queryKeys.admin.keywordCommandCenter('ws-1'),
    ]);
  });

  it('renders loading shimmers without fabricating zero-value metrics', () => {
    initialHookMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() });
    summaryHookMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null });
    rowsHookMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() });

    const { container } = renderSurface('/ws/ws-1/seo-keywords');

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
    expect(screen.queryByText('Monthly Value')).not.toBeInTheDocument();
  });

  it('renders an action-oriented empty state for a workspace with no keyword data', () => {
    initialHookMock.mockReturnValue({
      data: {
        summary: { ...summaryPayload, counts: { ...summaryPayload.counts, total: 0 }, rawEvidenceTotal: 0, rawEvidenceReturned: 0 },
        rows: {
          rows: [],
          pageInfo: { page: 1, pageSize: 50, totalRows: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    summaryHookMock.mockReturnValue({
      data: { ...summaryPayload, counts: { ...summaryPayload.counts, total: 0 }, rawEvidenceTotal: 0, rawEvidenceReturned: 0 },
      isLoading: false,
      isError: false,
      error: null,
    });
    rowsHookMock.mockReturnValue({
      data: {
        rows: [],
        pageInfo: { page: 1, pageSize: 50, totalRows: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderSurface('/ws/ws-1/seo-keywords');

    expect(screen.getByText('No keywords yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open strategy' })).toBeInTheDocument();
  });

  it('renders a filtered empty state with a clear action', () => {
    initialHookMock.mockReturnValue({
      data: {
        summary: summaryPayload,
        rows: {
          rows: [],
          pageInfo: { page: 1, pageSize: 50, totalRows: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    rowsHookMock.mockReturnValue({
      data: {
        rows: [],
        pageInfo: { page: 1, pageSize: 50, totalRows: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderSurface('/ws/ws-1/seo-keywords?filter=tracked&search=missing');

    expect(screen.getByText('No keywords match this view')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    return waitFor(() => {
      expect(screen.getByRole('searchbox')).toHaveValue('');
    });
  });

  it('renders row errors inline while preserving stale row data and retry', () => {
    const refetch = vi.fn();
    initialHookMock.mockImplementation((_workspaceId: string, query: KeywordCommandCenterRowsQuery) => ({
      data: {
        summary: summaryPayload,
        rows: {
          rows,
          pageInfo: {
            page: query.page ?? 1,
            pageSize: query.pageSize ?? 50,
            totalRows: rows.length,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        },
      },
      isLoading: false,
      isError: true,
      error: new Error('network down'),
      refetch,
    }));

    renderSurface('/ws/ws-1/seo-keywords');

    expect(screen.getByText('Could not load keywords')).toBeInTheDocument();
    expect(screen.getByText('cosmetic dentistry')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders locked keyword access as a permission state', () => {
    initialHookMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(403, 'Upgrade required'),
      refetch: vi.fn(),
    });
    summaryHookMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(403, 'Upgrade required'),
      refetch: vi.fn(),
    });

    renderSurface('/ws/ws-1/seo-keywords');

    expect(screen.getByText('Keyword intelligence is locked')).toBeInTheDocument();
    expect(screen.queryByText(/command-center access/i)).not.toBeInTheDocument();
    expect(screen.queryByText('cosmetic dentistry')).not.toBeInTheDocument();
  });

  it('dispatches drawer lifecycle and local-refresh actions', async () => {
    renderSurface('/ws/ws-1/seo-keywords');
    fireEvent.click(screen.getAllByText('cosmetic dentistry')[0]);

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retire keyword' }));
    expect(rowActionMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
        keyword: 'cosmetic dentistry',
      }),
      expect.anything(),
    );
    expect(screen.getByText('Retire keyword complete')).toBeInTheDocument();

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Refresh local visibility' })[0]);
    expect(localRefreshMutateMock).toHaveBeenCalledWith({ keywords: ['cosmetic dentistry'] }, expect.anything());
    expect(screen.getAllByText('Local visibility refresh started').length).toBeGreaterThan(0);
  });

  it('shows hard delete only for eligible manual rows and closes after confirmed delete', async () => {
    renderSurface('/ws/ws-1/seo-keywords?q=emergency+dentist');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(hardDeleteMutateMock).toHaveBeenCalledWith(
      { keyword: 'emergency dentist' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(screen.getByText('Keyword permanently deleted')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows the bulk bar on selection and fires non-protected bulk actions immediately', () => {
    renderSurface('/ws/ws-1/seo-keywords');

    fireEvent.click(screen.getByLabelText('Select cosmetic dentistry'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Track' }));
    expect(bulkMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: KEYWORD_COMMAND_CENTER_ACTIONS.TRACK,
        keywords: ['cosmetic dentistry'],
      }),
      expect.anything(),
    );
    expect(screen.getAllByText('Bulk action complete').length).toBeGreaterThan(0);
  });

  it('gates protected bulk actions behind confirmation before sending force', () => {
    renderSurface('/ws/ws-1/seo-keywords');

    fireEvent.click(screen.getByLabelText('Select emergency dentist'));
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));

    expect(bulkMutateMock).not.toHaveBeenCalled();
    expect(screen.getByText(/protected keyword/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Retire' }).at(-1)!);
    expect(bulkMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
        keywords: ['emergency dentist'],
        force: true,
      }),
      expect.anything(),
    );
  });

  it('mounts at the app shell root after the real feature-flag query resolves ON', async () => {
    renderDashboard();

    expect(screen.getByTestId('legacy-sidebar')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Keywords' })).toBeInTheDocument();
    });

    expect(screen.queryByTestId('legacy-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legacy-keyword-hub')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument();

    // Global overlay chrome must SURVIVE the rebuilt mount (review PR #1480 regression:
    // the rebuilt branch dropped these). CommandPalette renders unconditionally — it
    // hosts the global ⌘K listener, so losing it kills the shortcut on every rebuilt
    // surface. (AdminChat is gated on hasOpenAIKey — false in this fixture. StatusBar is
    // intentionally deferred to an AppShell footer slot, DEF-shell-005.)
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-status')).not.toBeInTheDocument();
  });
});
