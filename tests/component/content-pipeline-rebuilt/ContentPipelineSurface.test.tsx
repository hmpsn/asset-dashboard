// @ds-rebuilt
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentPipelineSurface } from '../../../src/components/content-pipeline-rebuilt/ContentPipelineSurface';
import { deriveLifecycleBoardItems } from '../../../src/components/content-pipeline-rebuilt/ContentLifecycleBoard';
import { deriveContentIntake, isContentWorkOrder } from '../../../src/components/content-pipeline-rebuilt/ContentPipelineIntake';
import { ToastProvider } from '../../../src/components/Toast';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { queryKeys } from '../../../src/lib/queryKeys';
import { expectNoA11yViolations } from '../a11y';

const mocks = vi.hoisted(() => ({
  featureFlagsList: vi.fn(),
  contentPipelineHook: vi.fn(),
  workspacesHook: vi.fn(),
  intelligenceHook: vi.fn(),
  briefsHook: vi.fn(),
  requestsHook: vi.fn(),
  postsHook: vi.fn(),
  suggestionsHook: vi.fn(),
  workOrdersHook: vi.fn(),
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
  useAdminBriefsList: (...args: unknown[]) => mocks.briefsHook(...args),
  useAdminRequestsList: (...args: unknown[]) => mocks.requestsHook(...args),
  useAdminPostsList: (...args: unknown[]) => mocks.postsHook(...args),
  useAiSuggestedBriefs: (...args: unknown[]) => mocks.suggestionsHook(...args),
}));

vi.mock('../../../src/hooks/admin/useWorkOrders', () => ({
  useAdminWorkOrders: (...args: unknown[]) => mocks.workOrdersHook(...args),
}));

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (_workspaceId: string, handlers: Record<string, () => void>) => {
    mocks.workspaceHandlers = handlers;
    return { send: vi.fn() };
  },
}));

vi.mock('../../../src/hooks/admin/useAdminContentPerformance', () => ({
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
    initialBriefId,
    display,
    requestIds,
  }: {
    workspaceId: string;
    fixContext?: { primaryKeyword?: string } | null;
    clearFixContext?: () => void;
    embedded?: boolean;
    initialBriefId?: string | null;
    display?: 'full' | 'generator' | 'requests';
    requestIds?: readonly string[];
  }) => (
    <div
      data-testid="legacy-briefs"
      data-initial-brief={initialBriefId ?? ''}
      data-display={display ?? 'full'}
      data-request-ids={requestIds?.join(',') ?? ''}
    >
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
    const [initializedPostId] = useState(postId);
    return (
      <div data-testid="legacy-posts" data-initial-post={initializedPostId ?? 'none'}>
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
  liveDomain: 'https://live.acme.example',
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
  subscriptions: { active: 0, totalPages: 0 },
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

const briefs = [
  {
    id: 'brief-linked',
    workspaceId,
    targetKeyword: 'linked keyword',
    secondaryKeywords: [],
    suggestedTitle: 'Linked brief title',
    suggestedMetaDesc: 'Linked description',
    outline: [],
    wordCountTarget: 1200,
    intent: 'informational',
    audience: 'buyers',
    competitorInsights: '',
    internalLinkSuggestions: [],
    pageType: 'blog' as const,
    createdAt: '2026-07-02T12:00:00.000Z',
  },
  {
    id: 'brief-standalone',
    workspaceId,
    targetKeyword: 'standalone keyword',
    secondaryKeywords: ['supporting keyword'],
    suggestedTitle: 'Standalone brief title',
    suggestedMetaDesc: 'Standalone description',
    outline: [],
    wordCountTarget: 1500,
    intent: 'commercial',
    audience: 'operators',
    competitorInsights: '',
    internalLinkSuggestions: [],
    pageType: 'service' as const,
    keywordSource: 'manual' as const,
    createdAt: '2026-07-03T12:00:00.000Z',
  },
];

const requests = [
  {
    id: 'request-linked',
    workspaceId,
    topic: 'Linked request title',
    targetKeyword: 'linked keyword',
    intent: 'informational',
    priority: 'high',
    rationale: 'Client asked for it',
    status: 'in_progress' as const,
    briefId: 'brief-linked',
    source: 'strategy' as const,
    pageType: 'blog' as const,
    requestedAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-04T12:00:00.000Z',
  },
  {
    id: 'request-queued',
    workspaceId,
    topic: 'Client-requested service page',
    targetKeyword: 'queued keyword',
    intent: 'commercial',
    priority: 'medium',
    rationale: 'New service launch',
    status: 'requested' as const,
    source: 'client' as const,
    pageType: 'service' as const,
    requestedAt: '2026-07-05T12:00:00.000Z',
    updatedAt: '2026-07-05T12:00:00.000Z',
  },
];

const posts = [
  {
    id: 'post-linked',
    workspaceId,
    briefId: 'brief-linked',
    targetKeyword: 'linked keyword',
    title: 'Linked draft title',
    metaDescription: '',
    introduction: '',
    sections: [],
    conclusion: '',
    totalWordCount: 820,
    targetWordCount: 1200,
    status: 'draft' as const,
    createdAt: '2026-07-04T12:00:00.000Z',
    updatedAt: '2026-07-05T12:00:00.000Z',
  },
  {
    id: 'post-review',
    workspaceId,
    briefId: 'brief-review-missing',
    targetKeyword: 'review keyword',
    title: 'Review-ready draft',
    metaDescription: '',
    introduction: '',
    sections: [],
    conclusion: '',
    totalWordCount: 1400,
    targetWordCount: 1400,
    status: 'review' as const,
    createdAt: '2026-07-04T12:00:00.000Z',
    updatedAt: '2026-07-06T12:00:00.000Z',
  },
];

const suggestions = [{
  id: 'suggestion-1',
  workspaceId,
  keyword: 'decay refresh keyword',
  pageUrl: '/older-page',
  source: 'content_decay',
  reason: 'Traffic has declined',
  priority: 'high' as const,
  status: 'pending' as const,
  createdAt: '2026-07-05T12:00:00.000Z',
  resolvedAt: null,
  snoozedUntil: null,
  dismissedKeywordHash: null,
}];

const workOrders = [{
  id: 'work-order-1',
  workspaceId,
  paymentId: 'payment-1',
  productType: 'post_polished' as const,
  status: 'in_progress' as const,
  pageIds: [],
  quantity: 1,
  notes: 'Polish launch announcement',
  createdAt: '2026-07-05T12:00:00.000Z',
  updatedAt: '2026-07-06T12:00:00.000Z',
}];

const nonContentWorkOrders = [
  { ...workOrders[0], id: 'work-order-schema', productType: 'schema_page' as const },
  { ...workOrders[0], id: 'work-order-fix', productType: 'fix_meta' as const },
  { ...workOrders[0], id: 'work-order-plan', productType: 'plan_growth' as const },
  { ...workOrders[0], id: 'work-order-strategy', productType: 'strategy' as const },
];

const publishedResponse = {
  summary: {
    piecesTracked: 2,
    piecesPublished: 1,
    piecesDelivered: 1,
    totalClicks: 1200,
    totalImpressions: 45000,
    totalSessions: 640,
    averagePosition: 5.4,
    measuredOutcomes: 1,
    wins: 1,
    averagePositionGain: 3.2,
  },
  items: [
    {
      itemId: 'request:req-1',
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
      itemId: 'matrix:req-2',
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

function renderSurface(
  path = `/ws/${workspaceId}/content-pipeline?tab=briefs`,
  client = createQueryClient(),
  showUrlControls = false,
) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <ContentPipelineSurface workspaceId={workspaceId} />
          <LocationProbe />
          {showUrlControls && <ContentPipelineUrlControls />}
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function ContentPipelineUrlControls() {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() => navigate(`/ws/${workspaceId}/content-pipeline?tab=posts&post=post-review`)}
      >
        Focus review post
      </button>
      <button
        type="button"
        onClick={() => navigate(`/ws/${workspaceId}/content-pipeline?tab=posts&post=missing-post-b`)}
      >
        Focus missing post B
      </button>
      <button
        type="button"
        onClick={() => navigate(`/ws/${workspaceId}/content-pipeline?tab=posts`)}
      >
        Clear focused post
      </button>
    </>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search" data-search={location.search} />;
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
    refetch: vi.fn().mockResolvedValue({ data: pipelineData, error: null }),
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
    refetch: vi.fn().mockResolvedValue({ data: { contentPipeline: contentPipelineSlice }, error: null }),
  });
  mocks.briefsHook.mockReturnValue({ data: briefs, isLoading: false, isError: false, refetch: vi.fn().mockResolvedValue({ data: briefs, error: null }) });
  mocks.requestsHook.mockReturnValue({ data: requests, isLoading: false, isError: false, refetch: vi.fn().mockResolvedValue({ data: requests, error: null }) });
  mocks.postsHook.mockReturnValue({ data: posts, isLoading: false, isError: false, refetch: vi.fn().mockResolvedValue({ data: posts, error: null }) });
  mocks.suggestionsHook.mockReturnValue({ data: suggestions, isLoading: false, isError: false, refetch: vi.fn().mockResolvedValue({ data: suggestions, error: null }) });
  mocks.workOrdersHook.mockReturnValue({ data: workOrders, isLoading: false, isError: false, refetch: vi.fn().mockResolvedValue({ data: workOrders, error: null }) });
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
      availability: 'available',
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
  it('derives one truthful card at the most advanced persisted stage', () => {
    const items = deriveLifecycleBoardItems({ briefs, requests, posts }, new Date('2026-07-10T12:00:00.000Z'));

    expect(items.map((item) => item.title)).toContain('Linked draft title');
    expect(items.map((item) => item.title)).not.toContain('Linked brief title');
    expect(items.map((item) => item.title)).not.toContain('Linked request title');
    expect(items.find((item) => item.id === 'post:post-linked')).toMatchObject({
      stage: 'draft',
      sourceLabel: 'Strategy',
      keyword: 'linked keyword',
      pageType: 'Blog',
      statusLabel: 'Draft',
      nextAction: 'Continue draft',
    });
  });

  it('separates pending intake artifacts and excludes non-content work orders', () => {
    const snapshot = deriveContentIntake({
      briefs,
      requests,
      posts,
      suggestions,
      workOrders: [...workOrders, ...nonContentWorkOrders],
    });

    expect(snapshot.requests.map((request) => request.id)).toEqual(['request-queued']);
    expect(snapshot.suggestions.map((suggestion) => suggestion.id)).toEqual(['suggestion-1']);
    expect(snapshot.workOrders.map((order) => order.id)).toEqual(['work-order-1']);
    expect(snapshot.total).toBe(3);
    expect(isContentWorkOrder(workOrders[0])).toBe(true);
    expect(nonContentWorkOrders.every((order) => !isContentWorkOrder(order))).toBe(true);
  });

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

  it('uses authoritative Board lists without asking the aggregate query to download them again', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=briefs`);

    expect(await screen.findByTestId('content-pipeline-board')).toBeInTheDocument();
    expect(mocks.contentPipelineHook).toHaveBeenLastCalledWith(
      workspaceId,
      { includeContentLists: false },
    );
    expect(mocks.briefsHook).toHaveBeenLastCalledWith(workspaceId);
    expect(mocks.requestsHook).toHaveBeenLastCalledWith(workspaceId, true);
    expect(mocks.postsHook).toHaveBeenLastCalledWith(workspaceId);
    expect(mocks.suggestionsHook).toHaveBeenLastCalledWith(workspaceId, true);
    expect(mocks.workOrdersHook).toHaveBeenLastCalledWith(workspaceId, true);
  });

  it('gates Board-only detail queries on inactive lenses and restores them on a Board transition', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=published`);

    expect(await screen.findByTestId('content-pipeline-published-lens')).toBeInTheDocument();
    expect(mocks.briefsHook).toHaveBeenLastCalledWith(workspaceId);
    expect(mocks.requestsHook).toHaveBeenLastCalledWith(workspaceId, false);
    expect(mocks.postsHook).toHaveBeenLastCalledWith(workspaceId);
    expect(mocks.suggestionsHook).toHaveBeenLastCalledWith(workspaceId, false);
    expect(mocks.workOrdersHook).toHaveBeenLastCalledWith(workspaceId, false);

    fireEvent.click(screen.getByRole('radio', { name: /Board/i }));

    expect(await screen.findByTestId('content-pipeline-board')).toBeInTheDocument();
    expect(mocks.briefsHook).toHaveBeenLastCalledWith(workspaceId);
    expect(mocks.requestsHook).toHaveBeenLastCalledWith(workspaceId, true);
    expect(mocks.postsHook).toHaveBeenLastCalledWith(workspaceId);
    expect(mocks.suggestionsHook).toHaveBeenLastCalledWith(workspaceId, true);
    expect(mocks.workOrdersHook).toHaveBeenLastCalledWith(workspaceId, true);
  });

  it('enables Board data for a post deep link but not for the unfocused Drafts receiver', async () => {
    const drafts = renderSurface(`/ws/${workspaceId}/content-pipeline?tab=posts`);

    expect(await screen.findByTestId('legacy-posts')).toBeInTheDocument();
    expect(mocks.briefsHook).toHaveBeenLastCalledWith(workspaceId);
    expect(mocks.requestsHook).toHaveBeenLastCalledWith(workspaceId, false);
    expect(mocks.postsHook).toHaveBeenLastCalledWith(workspaceId);
    expect(mocks.suggestionsHook).toHaveBeenLastCalledWith(workspaceId, false);
    expect(mocks.workOrdersHook).toHaveBeenLastCalledWith(workspaceId, false);

    drafts.unmount();
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=posts&post=post-linked`);

    expect(await screen.findByRole('dialog', { name: /Linked draft title/i })).toBeInTheDocument();
    expect(mocks.briefsHook).toHaveBeenLastCalledWith(workspaceId);
    expect(mocks.requestsHook).toHaveBeenLastCalledWith(workspaceId, true);
    expect(mocks.postsHook).toHaveBeenLastCalledWith(workspaceId);
    expect(mocks.suggestionsHook).toHaveBeenLastCalledWith(workspaceId, true);
    expect(mocks.workOrdersHook).toHaveBeenLastCalledWith(workspaceId, true);
  });

  it('keeps the real Board count on direct non-Board deep links', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=calendar`);

    expect(await screen.findByTestId('legacy-calendar')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Board/i })).toHaveTextContent('3');
    expect(mocks.briefsHook).toHaveBeenLastCalledWith(workspaceId);
    expect(mocks.postsHook).toHaveBeenLastCalledWith(workspaceId);
    expect(mocks.requestsHook).toHaveBeenLastCalledWith(workspaceId, false);
  });

  it('does not present a false zero Board count while authoritative lists are loading', async () => {
    mocks.briefsHook.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    mocks.postsHook.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });

    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=calendar`);

    expect(await screen.findByTestId('legacy-calendar')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Board' })).not.toHaveTextContent('0');
  });

  it('mounts only the active lazy interior across lens transitions', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=calendar`);

    expect(await screen.findByTestId('legacy-calendar')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-planner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content-pipeline-published-lens')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legacy-intake')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legacy-briefs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legacy-subscriptions')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Matrix/i }));

    expect(await screen.findByTestId('legacy-planner')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-calendar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legacy-intake')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legacy-briefs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legacy-subscriptions')).not.toBeInTheDocument();
  });

  it('uses item-backed cards and removes the opening KPI strip', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline`);

    expect(await screen.findByRole('button', { name: /Standalone brief title/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Linked draft title/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review-ready draft/i })).toBeInTheDocument();
    expect(screen.queryByText('Linked brief title')).not.toBeInTheDocument();
    expect(screen.queryByText('Linked request title')).not.toBeInTheDocument();
    expect(screen.queryByText('Client-requested service page')).not.toBeInTheDocument();
    expect(screen.queryByText('decay refresh keyword')).not.toBeInTheDocument();
    expect(screen.queryByText('Polish launch announcement')).not.toBeInTheDocument();
    expect(screen.queryByText('Published Cells')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^New piece$/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Export$/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Refresh$/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Guide$/i })).toHaveLength(1);
  });

  it('shows success only when every manual refetch result succeeds', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline`);

    fireEvent.click(await screen.findByRole('button', { name: /^Refresh$/i }));

    expect(await screen.findByText('Content Pipeline data refreshed')).toBeInTheDocument();
  });

  it('reports a resolved React Query error instead of false refresh success', async () => {
    const error = new Error('pipeline provider unavailable');
    mocks.contentPipelineHook.mockReturnValue({
      data: pipelineData,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: pipelineData, error }),
    });

    renderSurface(`/ws/${workspaceId}/content-pipeline`);
    fireEvent.click(await screen.findByRole('button', { name: /^Refresh$/i }));

    expect(await screen.findByText('pipeline provider unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Content Pipeline data refreshed')).not.toBeInTheDocument();
  });

  it('reports an active Published read failure instead of false refresh success', async () => {
    const error = new Error('published metrics unavailable');
    const client = createQueryClient();
    const refetchSpy = vi.spyOn(client, 'refetchQueries').mockRejectedValueOnce(error);
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=published`, client);

    fireEvent.click(await screen.findByRole('button', { name: /^Refresh$/i }));

    expect(await screen.findByText('published metrics unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Content Pipeline data refreshed')).not.toBeInTheDocument();
    expect(refetchSpy).toHaveBeenCalledWith(
      { queryKey: queryKeys.admin.contentPerformanceAll(workspaceId), type: 'active' },
      { throwOnError: true },
    );
    refetchSpy.mockRestore();
  });

  it('opens one local full-screen Brief workspace and restores focus on Escape', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline`);

    const trigger = await screen.findByRole('button', { name: /Standalone brief title/i });
    trigger.focus();
    fireEvent.click(trigger);

    const workspaceDialog = await screen.findByRole('dialog', { name: /Standalone brief title/i });
    expect(workspaceDialog).toHaveStyle({ width: '100vw' });
    expect(workspaceDialog).toHaveClass('!max-w-none');
    expect(workspaceDialog).toHaveStyle({ maxWidth: 'none' });
    expect(await screen.findAllByTestId('legacy-briefs')).toHaveLength(1);
    expect(screen.getByTestId('legacy-briefs')).toHaveAttribute('data-initial-brief', 'brief-standalone');
    expect(screen.getByTestId('brief-workspace-section-rail')).toBeInTheDocument();
    expect(screen.getByTestId('brief-workspace-readiness-rail')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Standalone brief title/i })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('opens one Draft workspace through the canonical ?post= receiver and returns a Board card to the Board', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline`);

    fireEvent.click(await screen.findByRole('button', { name: /Linked draft title/i }));

    const workspaceDialog = await screen.findByRole('dialog', { name: /Linked draft title/i });
    expect(workspaceDialog).toHaveStyle({ width: '100vw' });
    expect(workspaceDialog).toHaveClass('!max-w-none');
    expect(workspaceDialog).toHaveStyle({ maxWidth: 'none' });
    expect(await screen.findAllByTestId('legacy-posts')).toHaveLength(1);
    expect(screen.getByTestId('legacy-posts')).toHaveTextContent('post=post-linked');
    expect(screen.getByTestId('draft-workspace-section-rail')).toBeInTheDocument();
    expect(screen.getByTestId('draft-workspace-status-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('review-workspace-status-rail')).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Linked draft title/i })).not.toBeInTheDocument());
    expect(screen.getByTestId('content-pipeline-board')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-posts')).not.toBeInTheDocument();
  });

  it('remounts the embedded editor workflow when the same-route post param changes and closes it when the param clears', async () => {
    renderSurface(
      `/ws/${workspaceId}/content-pipeline?tab=posts&post=post-linked`,
      createQueryClient(),
      true,
    );

    expect(await screen.findByRole('dialog', { name: /Linked draft title/i })).toBeInTheDocument();
    expect(screen.getByTestId('legacy-posts')).toHaveAttribute('data-initial-post', 'post-linked');
    expect(screen.getByTestId('draft-workspace-status-rail')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Focus review post' }));

    expect(await screen.findByRole('dialog', { name: /Review-ready draft/i })).toBeInTheDocument();
    expect(screen.getByTestId('legacy-posts')).toHaveAttribute('data-initial-post', 'post-review');
    expect(screen.getByTestId('legacy-posts')).toHaveTextContent('post=post-review');
    expect(screen.getByTestId('review-workspace-status-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-workspace-status-rail')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear focused post' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Review-ready draft/i })).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('legacy-posts')).toHaveAttribute('data-initial-post', 'none');
    expect(screen.getByTestId('legacy-posts')).toHaveTextContent('post=none');
  });

  it('keys the embedded editor from the raw route post id even when the post is unresolved', async () => {
    renderSurface(
      `/ws/${workspaceId}/content-pipeline?tab=posts&post=missing-post-a`,
      createQueryClient(),
      true,
    );

    expect(await screen.findByRole('dialog', { name: 'Draft workspace' })).toBeInTheDocument();
    expect(screen.getByTestId('legacy-posts')).toHaveAttribute('data-initial-post', 'missing-post-a');

    fireEvent.click(screen.getByRole('button', { name: 'Focus missing post B' }));

    await waitFor(() => {
      expect(screen.getByTestId('legacy-posts')).toHaveAttribute('data-initial-post', 'missing-post-b');
    });
    expect(screen.getByTestId('legacy-posts')).toHaveTextContent('post=missing-post-b');
  });

  it('uses a distinct review-status rail for persisted review drafts', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline`);

    fireEvent.click(await screen.findByRole('button', { name: /Review-ready draft/i }));

    expect(await screen.findByRole('dialog', { name: /Review-ready draft/i })).toBeInTheDocument();
    expect(screen.getByTestId('review-workspace-status-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-workspace-status-rail')).not.toBeInTheDocument();
  });

  it('opens truthful capacity in the existing 440px Drawer', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline`);

    const capacity = await screen.findByRole('button', { name: /No content plan/i });
    fireEvent.click(capacity);

    const drawer = await screen.findByRole('dialog', { name: 'Content subscription' });
    expect(drawer).toHaveStyle({ width: '440px' });
    expect(await screen.findAllByTestId('legacy-subscriptions')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Content subscription' })).not.toBeInTheDocument());
  });

  it('does not expose prototype-only queue or generation theater controls', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline`);

    expect(await screen.findByTestId('content-pipeline-board')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Queue refresh/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add to Insights/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate briefs for planned/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send reminder/i })).not.toBeInTheDocument();
  });

  it('expands Intake from the default Board without opening an empty disclosure', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline`);

    const intakeLabel = await screen.findByText('Intake');
    const intakeSummary = intakeLabel.closest('summary');
    expect(intakeSummary).not.toBeNull();
    expect(screen.queryByTestId('legacy-intake')).not.toBeInTheDocument();

    fireEvent.click(intakeSummary!);

    expect(await screen.findByTestId('legacy-intake')).toBeInTheDocument();
    expect(screen.getByTestId('legacy-briefs')).toHaveAttribute('data-display', 'requests');
    expect(screen.getByTestId('legacy-briefs')).toHaveAttribute('data-request-ids', 'request-queued');
    expect(screen.getByText('Polish launch announcement')).toBeInTheDocument();
    expect(screen.getByTestId('content-pipeline-board')).toHaveAttribute('data-intake-state', 'expanded');
  });

  it('keeps Briefs and Drafts reachable from a zero-count lifecycle Board', async () => {
    const emptyPipelineData = {
      ...pipelineData,
      summary: { ...pipelineData.summary, briefs: 0, posts: 0 },
    };
    const emptyContentPipeline = {
      ...contentPipelineSlice,
      briefs: { total: 0, byStatus: { draft: 0 } },
      posts: { total: 0, byStatus: { draft: 0, review: 0 } },
      requests: { pending: 0, inProgress: 0, delivered: 0 },
      workOrders: { active: 0 },
      suggestedBriefs: 0,
    };
    mocks.contentPipelineHook.mockReturnValue({
      data: emptyPipelineData,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: emptyPipelineData }),
    });
    mocks.intelligenceHook.mockReturnValue({
      data: { contentPipeline: emptyContentPipeline },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: { contentPipeline: emptyContentPipeline } }),
    });
    mocks.briefsHook.mockReturnValue({ data: [], isLoading: false, isError: false });
    mocks.requestsHook.mockReturnValue({ data: [], isLoading: false, isError: false });
    mocks.postsHook.mockReturnValue({ data: [], isLoading: false, isError: false });
    mocks.suggestionsHook.mockReturnValue({ data: [], isLoading: false, isError: false });
    mocks.workOrdersHook.mockReturnValue({ data: [], isLoading: false, isError: false });

    const briefsView = renderSurface(`/ws/${workspaceId}/content-pipeline`);
    fireEvent.click(await screen.findByRole('button', { name: /Open briefs/i }));
    expect(await screen.findAllByTestId('legacy-briefs')).toHaveLength(1);

    briefsView.unmount();
    renderSurface(`/ws/${workspaceId}/content-pipeline`);
    fireEvent.click(await screen.findByRole('button', { name: /Open drafts/i }));
    expect(await screen.findAllByTestId('legacy-posts')).toHaveLength(1);
  });

  it('routes Content Health brief creation through the shared Briefs opener', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=content-health`);

    fireEvent.click(await screen.findByRole('button', { name: 'Draft refresh brief' }));

    expect(await screen.findAllByTestId('legacy-briefs')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Board/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('uses the prototype-sized Content Health empty composition without internal identifiers', async () => {
    mocks.contentPipelineHook.mockReturnValue({
      data: { ...pipelineData, decay: { critical: 0, warning: 0, totalDecaying: 0, avgDeclinePct: 0 } },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    mocks.intelligenceHook.mockReturnValue({
      data: { contentPipeline: { ...contentPipelineSlice, decayAlerts: [], cannibalizationWarnings: [] } },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=content-health`);

    expect(await screen.findByText('No decaying content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Draft refresh brief' })).toBeInTheDocument();
    expect(screen.queryByText('Pages Decaying')).not.toBeInTheDocument();
    expect(screen.queryByText(workspaceId)).not.toBeInTheDocument();
  });

  it('receives ?tab=published and renders the shared content-performance read', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=published`);

    expect(await screen.findByRole('radio', { name: /Published/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('content-pipeline-published-lens')).toBeInTheDocument();
    expect(mocks.contentPerformanceHook).toHaveBeenCalledWith(workspaceId);
    expect(screen.getByText('Pieces live')).toBeInTheDocument();
    expect(screen.getByText('Wins to graduate')).toBeInTheDocument();
    expect(screen.queryByText('Published proof queue')).not.toBeInTheDocument();
    expect(screen.getByText('Dental implant guide')).toBeInTheDocument();
    expect(screen.getAllByText('45,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Clicks').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Impressions').length).toBeGreaterThan(0);

    const summaryLabel = screen.getByText('Pieces live');
    const aggregateEvidence = screen.getByRole('region', { name: 'Published aggregate evidence' });
    const controls = screen.getByLabelText('Published content controls');
    expect(summaryLabel.compareDocumentPosition(aggregateEvidence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(aggregateEvidence.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(aggregateEvidence).getByText('Impressions')).toBeInTheDocument();
    expect(within(aggregateEvidence).getByText('45,000')).toBeInTheDocument();
    expect(within(aggregateEvidence).getByText('Sessions')).toBeInTheDocument();
    expect(within(aggregateEvidence).getByText('640')).toBeInTheDocument();
  });

  it('distinguishes unavailable Published providers from legitimate zero totals', async () => {
    const unavailable = {
      ...publishedResponse,
      items: publishedResponse.items.map((item) => ({ ...item, gsc: null, ga4: null })),
    };
    mocks.contentPerformanceHook.mockReturnValue({
      data: unavailable,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const first = renderSurface(`/ws/${workspaceId}/content-pipeline?tab=published`);
    const unavailableEvidence = await screen.findByRole('region', { name: 'Published aggregate evidence' });
    expect(within(unavailableEvidence).getAllByText('—')).toHaveLength(2);

    first.unmount();
    mocks.contentPerformanceHook.mockReturnValue({
      data: {
        ...publishedResponse,
        summary: { ...publishedResponse.summary, totalImpressions: 0, totalSessions: 0 },
        items: publishedResponse.items.map((item) => ({
          ...item,
          gsc: item.gsc ? { ...item.gsc, impressions: 0 } : item.gsc,
          ga4: item.ga4 ? { ...item.ga4, sessions: 0 } : item.ga4,
        })),
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=published`);
    const zeroEvidence = await screen.findByRole('region', { name: 'Published aggregate evidence' });
    expect(within(zeroEvidence).getAllByText('0')).toHaveLength(2);
    expect(within(zeroEvidence).queryByText('—')).not.toBeInTheDocument();
  });

  it('opens View live against the workspace liveDomain rather than an integration label', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=published`);

    fireEvent.click(await screen.findByRole('button', { name: 'Open published readback for Dental implant guide' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View live' }));

    expect(openSpy).toHaveBeenCalledWith(
      'https://live.acme.example/dental-implants',
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });

  it('opens and clears a valid published item deep link without auto-selecting invalid ids', async () => {
    const valid = renderSurface(`/ws/${workspaceId}/content-pipeline?tab=published&item=request%3Areq-1`);

    expect(await screen.findByRole('dialog', { name: 'Dental implant guide' })).toBeInTheDocument();
    expect(screen.getByText('Brief execution & source coverage')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dental implant guide' })).not.toBeInTheDocument());

    valid.unmount();
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=published&item=does-not-exist`);
    expect(await screen.findByText('Dental implant guide')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveAttribute('data-search', '?tab=published'));
  });

  it('writes the stable published item id when a result card opens', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=published`);

    fireEvent.click(await screen.findByRole('button', { name: 'Open published readback for Dental implant guide' }));

    expect(await screen.findByRole('dialog', { name: 'Dental implant guide' })).toBeInTheDocument();
    expect(screen.getByTestId('location-search')).toHaveAttribute('data-search', '?tab=published&item=request%3Areq-1');
  });

  it('shows only the Published empty state and real re-scan action before content goes live', async () => {
    mocks.contentPerformanceHook.mockReturnValue({
      data: { summary: { ...publishedResponse.summary, piecesTracked: 0, piecesPublished: 0 }, items: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=published`);

    expect(await screen.findByText('No published content yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-scan' })).toBeInTheDocument();
    expect(screen.queryByText('Pieces Live')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Published content controls')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Published aggregate evidence' })).not.toBeInTheDocument();
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
    expect(screen.getByRole('dialog', { name: 'Content subscription' })).toHaveStyle({ width: '440px' });
    expect(screen.getByTestId('content-pipeline-board')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /No content plan/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps internal rebuild and migration language out of the visible shell', async () => {
    const { container } = renderSurface(`/ws/${workspaceId}/content-pipeline?tab=briefs`);

    expect(await screen.findByRole('heading', { name: 'Content Pipeline' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/receiver|carried-over|carry-over|mounted below|shell owns|subscriptions alias|\?tab=|legacy|migration|rebuild|existing (?:brief )?workspace|current posts workspace/i);
  });

  it('uses the topbar action portal fallback without duplicating narrow controls', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline?tab=briefs`);

    const actionGroup = await screen.findByTestId('content-pipeline-header-actions');
    expect(screen.getByTestId('content-pipeline-topbar-actions-fallback')).toContainElement(actionGroup);
    expect(actionGroup).toHaveClass('max-w-full');
    expect(actionGroup).toHaveClass('overflow-x-auto');
    expect(screen.getAllByRole('button', { name: /^New piece$/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Export$/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Refresh$/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Guide$/ })).toHaveLength(1);
  });

  it('keeps new brief creation reachable from a populated Board', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline`);

    fireEvent.click(await screen.findByRole('button', { name: /^New piece$/ }));

    expect(await screen.findAllByTestId('legacy-briefs')).toHaveLength(1);
    expect(screen.getByTestId('legacy-briefs')).toHaveAttribute('data-display', 'generator');
    expect(screen.getByRole('dialog', { name: 'New content brief' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Board/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('consumes direct Content Pipeline brief handoff state before the router clears it', async () => {
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[{
          pathname: `/ws/${workspaceId}/content-pipeline`,
          search: '?tab=briefs',
          state: {
            fixContext: {
              targetRoute: 'content-pipeline',
              primaryKeyword: 'emergency dentist austin',
              pageSlug: '/emergency-dentist',
              autoGenerate: true,
            },
          },
        }]}
        >
          <ToastProvider>
            <ContentPipelineSurface workspaceId={workspaceId} />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('dialog', { name: 'New brief · emergency dentist austin' })).toBeInTheDocument();
    expect(screen.getByTestId('legacy-briefs')).toHaveTextContent('emergency dentist austin');
    expect(screen.getAllByTestId('legacy-briefs')).toHaveLength(1);
  });

  it('keeps legacy workspaces reachable exactly once without duplicating the page title', async () => {
    renderSurface(`/ws/${workspaceId}/content-pipeline`);

    fireEvent.click(await screen.findByRole('button', { name: /Standalone brief title/i }));
    expect(await screen.findByTestId('legacy-briefs')).toBeInTheDocument();
    expect(screen.getAllByTestId('legacy-briefs')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: 'Content Pipeline' })).toHaveLength(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('legacy-briefs')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Linked draft title/i }));
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
