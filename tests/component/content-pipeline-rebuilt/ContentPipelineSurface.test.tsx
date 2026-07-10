// @ds-rebuilt
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate, useSearchParams } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentPipelineSurface } from '../../../src/components/content-pipeline-rebuilt/ContentPipelineSurface';
import { ToastProvider } from '../../../src/components/Toast';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { queryKeys } from '../../../src/lib/queryKeys';
import { expectNoA11yViolations } from '../a11y';

const mocks = vi.hoisted(() => ({
  featureFlagsList: vi.fn(),
  contentPipelineHook: vi.fn(),
  workspacesHook: vi.fn(),
  intelligenceHook: vi.fn(),
  workspaceHandlers: {} as Record<string, () => void>,
  contentPerformanceHook: vi.fn(),
  contentPerformanceTrendHook: vi.fn(),
  refreshMutate: vi.fn(),
}));

vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      list: (...args: unknown[]) => mocks.featureFlagsList(...args),
    },
  };
});

vi.mock('../../../src/hooks/admin', () => ({
  useContentPipeline: (...args: unknown[]) => mocks.contentPipelineHook(...args),
  useWorkspaces: (...args: unknown[]) => mocks.workspacesHook(...args),
  useWorkspaceIntelligence: (...args: unknown[]) => mocks.intelligenceHook(...args),
}));

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (_workspaceId: string, handlers: Record<string, () => void>) => {
    mocks.workspaceHandlers = handlers;
    return { send: vi.fn() };
  },
}));

vi.mock('../../../src/hooks/admin/useAdminContentPerformance', () => ({
  adminContentPerformanceKeys: {
    all: (workspaceId: string) => ['admin-content-performance', workspaceId] as const,
  },
  useAdminContentPerformance: (...args: unknown[]) => mocks.contentPerformanceHook(...args),
  useAdminContentPerformanceTrend: (...args: unknown[]) => mocks.contentPerformanceTrendHook(...args),
  useAdminContentPerformanceRefresh: () => ({
    mutate: mocks.refreshMutate,
    isPending: false,
  }),
}));

vi.mock('../../../src/components/ContentPlanner', () => ({
  ContentPlanner: ({ workspaceId, embedded }: { workspaceId: string; embedded?: boolean }) => (
    <div data-testid="legacy-planner">
      {!embedded && <h2>Content Planner</h2>}
      Planner {workspaceId}
      <button type="button">New Template</button>
      <button type="button">Build Matrix</button>
    </div>
  ),
}));

vi.mock('../../../src/components/ContentCalendar', () => ({
  ContentCalendar: ({ workspaceId, embedded }: { workspaceId: string; embedded?: boolean }) => {
    const navigate = useNavigate();
    return (
      <div data-testid="legacy-calendar">
        {!embedded && <h2>Content Calendar</h2>}
        Calendar {workspaceId}
        <button type="button">Suggest dates</button>
        <button type="button">Posts</button>
        <button
          type="button"
          onClick={() => navigate(`/ws/${workspaceId}/content-pipeline?tab=posts&post=post-calendar`)}
        >
          Open scheduled post
        </button>
      </div>
    );
  },
}));

vi.mock('../../../src/components/ContentBriefs', () => ({
  ContentBriefs: ({
    workspaceId,
    fixContext,
    clearFixContext,
    embedded,
  }: {
    workspaceId: string;
    fixContext?: { primaryKeyword?: string } | null;
    clearFixContext?: () => void;
    embedded?: boolean;
  }) => (
    <div data-testid="legacy-briefs">
      {!embedded && <h2>Content Briefs</h2>}
      Briefs {workspaceId} {fixContext?.primaryKeyword ?? 'no-fix-context'}
      <input aria-label="Search briefs" placeholder="Search briefs..." />
      <button type="button">Newest</button>
      <button type="button" onClick={clearFixContext}>Clear fix context</button>
    </div>
  ),
}));

vi.mock('../../../src/components/ContentManager', () => ({
  ContentManager: ({ workspaceId, embedded }: { workspaceId: string; embedded?: boolean }) => {
    const [params, setParams] = useSearchParams();
    const postId = params.get('post');
    return (
      <div data-testid="legacy-posts">
        {!embedded && <h2>Content Posts</h2>}
        Posts {workspaceId} post={postId ?? 'none'}
        <button type="button">Draft</button>
        <input aria-label="Search posts" placeholder="Search by title or keyword..." />
        <button
          type="button"
          onClick={() => {
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.delete('post');
              return next;
            }, { replace: true });
          }}
        >
          Close post
        </button>
      </div>
    );
  },
}));

vi.mock('../../../src/components/ContentSubscriptions', () => ({
  ContentSubscriptions: ({ workspaceId, embedded }: { workspaceId: string; embedded?: boolean }) => (
    <div data-testid="legacy-subscriptions">
      {!embedded && <h2>Content Subscriptions</h2>}
      Subscriptions {workspaceId}
      <button type="button">New Subscription</button>
    </div>
  ),
}));

vi.mock('../../../src/components/pipeline/AiSuggested', () => ({
  AiSuggested: ({
    workspaceId,
    onCreateBrief,
  }: {
    workspaceId: string;
    onCreateBrief?: (keyword: string, pageUrl?: string, suggestedBriefId?: string) => void;
  }) => (
    <div data-testid="legacy-intake">
      Intake {workspaceId}
      <button
        type="button"
        onClick={() => onCreateBrief?.('decay keyword', '/decay-page', 'suggested-1')}
      >
        Create suggested brief
      </button>
    </div>
  ),
}));

vi.mock('../../../src/components/ContentPipelineGuide', () => ({
  ContentPipelineGuide: () => <div data-testid="legacy-guide">Guide</div>,
}));

const workspaceId = 'ws-content';

const workspace = {
  id: workspaceId,
  name: 'Acme Dental',
  folder: 'acme',
  webflowSiteId: 'site-1',
  webflowSiteName: 'acme.example',
  gscPropertyUrl: 'https://acme.example',
  tier: 'growth',
  createdAt: '2026-07-01T12:00:00.000Z',
};

const pipelineData = {
  summary: {
    briefs: 4,
    posts: 3,
    matrices: 2,
    cells: 12,
    published: 5,
  },
  decay: {
    critical: 1,
    warning: 2,
    totalDecaying: 3,
    avgDeclinePct: -18,
  },
};

const contentPipelineSlice = {
  briefs: { total: 4, byStatus: { draft: 2 } },
  posts: { total: 3, byStatus: { draft: 1 } },
  matrices: { total: 2, cellsPlanned: 12, cellsPublished: 5 },
  requests: { pending: 1, inProgress: 2, delivered: 1 },
  workOrders: { active: 1 },
  coverageGaps: [],
  seoEdits: { pending: 0, applied: 1, inReview: 0 },
  suggestedBriefs: 2,
  decayAlerts: [
    {
      pageUrl: '/old-guide',
      clickDrop: 32,
      detectedAt: '2026-07-04T12:00:00.000Z',
      hasRefreshBrief: false,
      isRepeatDecay: true,
    },
  ],
  cannibalizationWarnings: [
    {
      keyword: 'dental implants',
      pages: ['/implants', '/services/implants'],
      severity: 'high',
    },
  ],
};

const publishedResponse = {
  items: [
    {
      requestId: 'req-1',
      topic: 'Dental implant guide',
      targetKeyword: 'dental implants',
      targetPageSlug: '/dental-implants',
      pageType: 'blog',
      status: 'published',
      publishedAt: '2026-06-01T12:00:00.000Z',
      daysSincePublish: 36,
      source: 'request',
      gsc: { clicks: 1200, impressions: 45000, ctr: 2.7, position: 5.4 },
      ga4: { sessions: 640, users: 520, bounceRate: 42.3, avgEngagementTime: 95, conversions: 8 },
      coverage: {
        status: 'partial',
        coveragePct: 72,
        requiredCount: 18,
        matchedCount: 13,
        missingCount: 5,
        missingTerms: ['osseointegration', 'healing cap'],
      },
      joinback: {
        briefId: 'brief-1',
        postId: 'post-1',
        briefTitle: 'Implant brief',
        postTitle: 'Implant post',
        hasSourceEvidence: true,
        evidenceSourceCounts: {
          scrapedReferences: 3,
          serpResults: 5,
          styleExamples: 1,
          peopleAlsoAsk: 4,
        },
      },
      outcome: {
        actionId: 'action-1',
        actionType: 'content_refresh',
        score: 'win',
        checkpointDays: 90,
        primaryMetric: 'clicks',
        direction: 'improved',
        baselineValue: 900,
        currentValue: 1200,
        baselinePosition: null,
        currentPosition: null,
        baselineClicks: 900,
        currentClicks: 1200,
        measuredAt: '2026-07-01T12:00:00.000Z',
      },
    },
    {
      requestId: 'req-2',
      topic: 'Veneers service page',
      targetKeyword: 'veneers',
      targetPageSlug: '/veneers',
      pageType: 'service',
      status: 'delivered',
      publishedAt: undefined,
      daysSincePublish: 7,
      source: 'matrix',
      gsc: null,
      ga4: null,
      coverage: {
        status: 'unavailable',
        coveragePct: null,
        requiredCount: 0,
        matchedCount: 0,
        missingCount: 0,
        missingTerms: [],
        reason: 'No brief terms available.',
      },
    },
  ],
};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

function createQueryClient(seedFlag = true): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  if (seedFlag) {
    client.setQueryData(queryKeys.shared.featureFlags(), { 'ui-rebuild-shell': true });
  }
  return client;
}

function renderSurface(path = `/ws/${workspaceId}/content-pipeline?tab=briefs`, client = createQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <ContentPipelineSurface workspaceId={workspaceId} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function FlaggedContentPipeline() {
  const enabled = useFeatureFlag('ui-rebuild-shell');
  return enabled ? <ContentPipelineSurface workspaceId={workspaceId} /> : <div data-testid="legacy-content-pipeline">Legacy Content Pipeline</div>;
}

function renderFlagged(client = createQueryClient(false)) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/ws/${workspaceId}/content-pipeline?tab=briefs`]}>
        <ToastProvider>
          <FlaggedContentPipeline />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.featureFlagsList.mockResolvedValue({ 'ui-rebuild-shell': true });
  mocks.contentPipelineHook.mockReturnValue({
    data: pipelineData,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn().mockResolvedValue({ data: pipelineData }),
  });
  mocks.workspacesHook.mockReturnValue({
    data: [workspace],
    isLoading: false,
    isFetching: false,
  });
  mocks.intelligenceHook.mockReturnValue({
    data: { contentPipeline: contentPipelineSlice },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn().mockResolvedValue({ data: { contentPipeline: contentPipelineSlice } }),
  });
  mocks.contentPerformanceHook.mockReturnValue({
    data: publishedResponse,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mocks.contentPerformanceTrendHook.mockReturnValue({
    data: {
      trend: [
        { date: '2026-07-01', clicks: 10, impressions: 300, ctr: 3.3, position: 8.1 },
        { date: '2026-07-02', clicks: 18, impressions: 420, ctr: 4.2, position: 6.5 },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mocks.refreshMutate.mockImplementation((_vars: undefined, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
  });
});

describe('ContentPipelineSurface rebuilt cockpit', () => {
  it('uses the real feature flag hook through loading(default) to loaded(true)', async () => {
    let resolveFlags: (value: { 'ui-rebuild-shell': boolean }) => void = () => {};
    mocks.featureFlagsList.mockReturnValue(new Promise((resolve) => {
      resolveFlags = resolve;
    }));

    const client = createQueryClient(false);
    renderFlagged(client);

    expect(screen.getByTestId('legacy-content-pipeline')).toBeInTheDocument();

    act(() => {
      resolveFlags({ 'ui-rebuild-shell': true });
    });

    expect(await screen.findByRole('heading', { name: 'Content Pipeline' })).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-content-pipeline')).not.toBeInTheDocument();
    expect(screen.getByTestId('content-pipeline-board')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-briefs')).not.toBeInTheDocument();
  });

  it('opens bare and briefs URLs on the lifecycle Board with brief work focused', async () => {
    const bare = renderSurface(`/ws/${workspaceId}/content-pipeline`);

    expect(await screen.findByTestId('content-pipeline-board')).toHaveAttribute('data-board-focus', 'brief');
    expect(screen.getByTestId('content-pipeline-board-stage-brief')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-briefs')).not.toBeInTheDocument();

    bare.unmount();
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=briefs`);

    expect(await screen.findByTestId('content-pipeline-board')).toHaveAttribute('data-board-focus', 'brief');
    expect(screen.getByTestId('content-pipeline-board-stage-brief')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-briefs')).not.toBeInTheDocument();
  });

  it('receives ?tab=published and renders the shared content-performance read', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=published`);

    expect(await screen.findByRole('radio', { name: /Published/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('content-pipeline-published-lens')).toBeInTheDocument();
    expect(mocks.contentPerformanceHook).toHaveBeenCalledWith(workspaceId);
    expect(screen.getByText('Published proof queue')).toBeInTheDocument();
    expect(screen.getByText('1 win ready')).toBeInTheDocument();
    expect(screen.getByText(/Wins with measured lift graduate into Insights Engine/i)).toHaveClass('t-body');
    expect(screen.getByText('Dental implant guide')).toBeInTheDocument();
    expect(screen.getAllByText('45,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('72% covered')).toBeInTheDocument();
  });

  it('preserves the calendar ?tab=posts&post= receiver and clears only post on close', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=calendar`);

    expect(await screen.findByTestId('legacy-calendar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open scheduled post' }));

    expect(await screen.findByTestId('legacy-posts')).toHaveTextContent('post=post-calendar');
    expect(screen.getByRole('radio', { name: /Board/i })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Close post' }));

    await waitFor(() => {
      expect(screen.getByTestId('legacy-posts')).toHaveTextContent('post=none');
    });
    expect(screen.getByRole('radio', { name: /Board/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('routes AI-suggested intake into the Briefs workspace with fix-context intact', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=intake`);

    expect(await screen.findByTestId('content-pipeline-board')).toHaveAttribute('data-intake-state', 'expanded');
    expect(await screen.findByTestId('legacy-intake')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create suggested brief' }));

    expect(await screen.findByTestId('legacy-briefs')).toHaveTextContent('decay keyword');
    expect(screen.getByRole('radio', { name: /Board/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('falls back from a bad tab and preserves the subscriptions alias', async () => {
    const firstRender = renderSurface(`/ws/${workspaceId}/content-pipeline?tab=unknown`);

    expect(await screen.findByTestId('content-pipeline-board')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-briefs')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Board/i })).toHaveAttribute('aria-checked', 'true');

    firstRender.unmount();
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=subscriptions`);
    expect(await screen.findByTestId('legacy-subscriptions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Content capacity' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps internal rebuild and migration language out of the visible shell', async () => {
    const { container } = renderSurface(`/ws/${workspaceId}/content-pipeline?tab=briefs`);

    expect(await screen.findByRole('heading', { name: 'Content Pipeline' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/receiver|carried-over|carry-over|mounted below|shell owns|subscriptions alias|\?tab=|legacy|migration|rebuild/i);
  });

  it('keeps header actions stackable on narrow viewports', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=briefs`);

    const actionGroup = await screen.findByTestId('content-pipeline-header-actions');
    expect(actionGroup).toHaveClass('flex-col');
    expect(actionGroup).toHaveClass('sm:flex-row');
    expect(actionGroup).toHaveClass('max-w-full');
  });

  it('keeps legacy workspaces reachable exactly once without duplicating the page title', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline`);

    fireEvent.click(await screen.findByRole('button', { name: /Open briefs/i }));
    expect(await screen.findByTestId('legacy-briefs')).toBeInTheDocument();
    expect(screen.getAllByTestId('legacy-briefs')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: 'Content Pipeline' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Open drafts/i }));
    expect(await screen.findByTestId('legacy-posts')).toBeInTheDocument();
    expect(screen.getAllByTestId('legacy-posts')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: 'Content Pipeline' })).toHaveLength(1);
  });

  it('renders one page title per compatible mode while preserving embedded controls', async () => {
    const cases = [
      {
        tab: 'posts',
        testId: 'legacy-posts',
        legacyTitle: 'Content Posts',
        assertControls: () => {
          expect(screen.getByRole('button', { name: 'Draft' })).toBeInTheDocument();
          expect(screen.getByLabelText('Search posts')).toBeInTheDocument();
        },
      },
      {
        tab: 'publish',
        testId: 'legacy-subscriptions',
        legacyTitle: 'Content Subscriptions',
        assertControls: () => {
          expect(screen.getByRole('button', { name: 'New Subscription' })).toBeInTheDocument();
        },
      },
      {
        tab: 'planner',
        testId: 'legacy-planner',
        legacyTitle: 'Content Planner',
        assertControls: () => {
          expect(screen.getByRole('button', { name: 'New Template' })).toBeInTheDocument();
          expect(screen.getByRole('button', { name: 'Build Matrix' })).toBeInTheDocument();
        },
      },
      {
        tab: 'calendar',
        testId: 'legacy-calendar',
        legacyTitle: 'Content Calendar',
        assertControls: () => {
          expect(screen.getByRole('button', { name: 'Suggest dates' })).toBeInTheDocument();
          expect(screen.getByRole('button', { name: 'Posts' })).toBeInTheDocument();
        },
      },
    ] as const;

    for (const lens of cases) {
      const view = renderSurface(`/ws/${workspaceId}/content-pipeline?tab=${lens.tab}`);
      expect(await screen.findByTestId(lens.testId)).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { name: 'Content Pipeline' })).toHaveLength(1);
      expect(screen.queryByRole('heading', { name: lens.legacyTitle })).not.toBeInTheDocument();
      lens.assertControls();
      view.unmount();
    }
  });

  it('meets the rebuilt a11y floor after animate-pulse settles', async () => {
    const { container } = renderSurface(`/ws/${workspaceId}/content-pipeline?tab=content-health`);

    expect(await screen.findByRole('heading', { name: 'Content Pipeline' })).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelectorAll('.animate-pulse').length).toBe(0);
    });
    await expectNoA11yViolations(container);
  }, 15_000);
});
