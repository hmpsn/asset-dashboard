import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../../src/App';
import { KeywordsSurface } from '../../../src/components/keywords-rebuilt/KeywordsSurface';
import { KEYWORD_COMMAND_CENTER_ACTIONS } from '../../../shared/types/keyword-command-center';
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
const summaryHookMock = vi.fn();
const rowsHookMock = vi.fn();
const detailHookMock = vi.fn();
const bulkMutateMock = vi.fn();
const rowActionMutateMock = vi.fn();
const hardDeleteMutateMock = vi.fn();
const pinMutateMock = vi.fn();
const nationalRefreshMutateMock = vi.fn();
const localRefreshMutateMock = vi.fn();
const apiGetMock = vi.fn();

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
  useKeywordCommandCenterSummary: (...args: unknown[]) => summaryHookMock(...args),
  useKeywordCommandCenterRows: (...args: unknown[]) => rowsHookMock(...args),
  useKeywordCommandCenterBulkAction: () => ({ mutate: bulkMutateMock, isPending: false }),
  useKeywordCommandCenterDetail: (...args: unknown[]) => detailHookMock(...args),
  useKeywordCommandCenterAction: () => ({ mutate: rowActionMutateMock, isPending: false, error: null, variables: undefined }),
  useKeywordHardDelete: () => ({ mutate: hardDeleteMutateMock, isPending: false, error: null }),
  useRankTrackingTogglePin: () => ({ mutate: pinMutateMock, isPending: false, error: null }),
  useNationalSerpRefresh: () => ({ mutate: nationalRefreshMutateMock, isPending: false, error: null }),
}));

vi.mock('../../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeoRefresh: () => ({ mutate: localRefreshMutateMock, isPending: false, error: null }),
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
    { id: 'tracked', label: 'Tracked', count: 2 },
    { id: 'page_assigned', label: 'Page assigned', count: 2 },
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
  summaryHookMock.mockReturnValue({
    data: summaryPayload,
    isLoading: false,
    isError: false,
    error: null,
  });
  rowsHookMock.mockImplementation((_workspaceId: string, query: KeywordCommandCenterRowsQuery) => {
    const page = query.page ?? 1;
    const response: KeywordCommandCenterRowsResponse = {
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
  hardDeleteMutateMock.mockImplementation((_vars: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
  });
  apiGetMock.mockResolvedValue([
    { date: '2026-07-01', positions: { 'cosmetic dentistry': 8, 'emergency dentist': 16 } },
    { date: '2026-07-02', positions: { 'cosmetic dentistry': 6, 'emergency dentist': 14 } },
  ]);
}

function renderSurface(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <KeywordsSurface workspaceId="ws-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderDashboard(path = '/ws/ws-1/seo-keywords?tab=lifecycle') {
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
    const { container } = renderSurface('/ws/ws-1/seo-keywords?tab=lifecycle&filter=tracked&search=cosmetic&page=3&q=emergency+dentist');

    expect(screen.getByRole('radio', { name: /Lifecycle/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Tracked' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('searchbox')).toHaveValue('cosmetic');
    expect(rowsHookMock.mock.calls.at(-1)?.[1]).toMatchObject({ filter: 'tracked', search: 'cosmetic', page: 3 });
    expect(screen.getByRole('button', { name: 'emergency dentist' })).toBeInTheDocument();

    await expectNoA11yViolations(container);
  }, 15_000);

  it('preserves legacy ?tab segment links by treating them as filters', () => {
    renderSurface('/ws/ws-1/seo-keywords?tab=tracked&q=cosmetic+dentistry');

    expect(screen.getByRole('radio', { name: /Rankings/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Tracked' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'cosmetic dentistry' })).toBeInTheDocument();
  });

  it('renders keyword rows, provenance, opportunity, and money empty states without fabricating dollars', () => {
    renderSurface('/ws/ws-1/seo-keywords');

    expect(screen.getByText('cosmetic dentistry')).toBeInTheDocument();
    expect(screen.getByText('Commercial')).toBeInTheDocument();
    expect(screen.getByText('#6')).toBeInTheDocument();
    expect(screen.getAllByText('$1,234').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('From gap')).toBeInTheDocument();
    expect(screen.getByText('Auto-managed')).toBeInTheDocument();
    expect(screen.getByText('No CPC')).toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: /45 more keywords hidden/i })).toBeInTheDocument();
  });

  it('threads sort and pagination controls into the rows query', async () => {
    renderSurface('/ws/ws-1/seo-keywords');

    expect(rowsHookMock.mock.calls.at(-1)?.[1]).toMatchObject({ sort: 'rank', direction: 'asc' });

    fireEvent.click(screen.getByRole('button', { name: 'Clicks' }));
    await waitFor(() => {
      expect(rowsHookMock.mock.calls.at(-1)?.[1]).toMatchObject({ sort: 'clicks', direction: 'asc' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(rowsHookMock.mock.calls.at(-1)?.[1]).toMatchObject({ page: 2 });
    });
  });

  it('switches lenses, updates the URL-backed query, and renders grouped shapes', async () => {
    renderSurface('/ws/ws-1/seo-keywords');

    fireEvent.click(screen.getByRole('radio', { name: /Opportunities/ }));
    await waitFor(() => {
      expect(rowsHookMock.mock.calls.at(-1)?.[1]).toMatchObject({ sort: 'opportunity', direction: 'desc' });
    });

    fireEvent.click(screen.getByRole('radio', { name: /Pages/ }));
    await waitFor(() => {
      expect(screen.getAllByText('Cosmetic Dentistry').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Cannibalization risk')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Clusters/ }));
    await waitFor(() => {
      expect(screen.getByText('Dental services')).toBeInTheDocument();
    });
    expect(screen.getByText('2/3 covered')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Lifecycle/ }));
    await waitFor(() => {
      expect(screen.getByText('Ranking')).toBeInTheDocument();
      expect(screen.getByText('Winning')).toBeInTheDocument();
    });
    expect(screen.getByText('cosmetic dentistry')).toBeInTheDocument();
    expect(screen.getByText('emergency dentist')).toBeInTheDocument();
  });

  it('opens the detail drawer from a row click and renders value, provenance, and outcome context', async () => {
    renderSurface('/ws/ws-1/seo-keywords');

    fireEvent.click(screen.getAllByText('cosmetic dentistry')[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'cosmetic dentistry' })).toBeInTheDocument();
    expect(within(dialog).getByText('#14 → #6 · Win · 30d')).toBeInTheDocument();
    expect(within(dialog).getByText('Why this score')).toBeInTheDocument();
    expect(within(dialog).getByText('Page-one rankings with meaningful click volume.')).toBeInTheDocument();
    expect(within(dialog).getByText('$2,400/mo')).toBeInTheDocument();
    expect(within(dialog).getByText('strategy primary')).toBeInTheDocument();
    expect(within(dialog).getByText('Austin')).toBeInTheDocument();
    expect(within(dialog).getByText('Live SERP #4')).toBeInTheDocument();
    expect(within(dialog).getByText('featured snippet')).toBeInTheDocument();
  });

  it('opens the detail drawer from a ?q deep link', async () => {
    renderSurface('/ws/ws-1/seo-keywords?q=emergency+dentist');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'emergency dentist' })).toBeInTheDocument();
    expect(within(dialog).getByText('Tracked client keyword')).toBeInTheDocument();
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
    );

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Refresh local visibility' })[0]);
    expect(localRefreshMutateMock).toHaveBeenCalledWith({ keywords: ['cosmetic dentistry'] });
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
  });
});
