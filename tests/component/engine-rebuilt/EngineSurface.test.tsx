import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineSurface } from '../../../src/components/engine-rebuilt/EngineSurface';
import { ToastProvider } from '../../../src/components/Toast';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import type { useEngineRebuilt } from '../../../src/hooks/admin/useEngineRebuilt';
import type { Recommendation } from '../../../shared/types/recommendations';
import type { WorkQueueClassification } from '../../../shared/types/work-queue';
import { expectNoA11yViolations } from '../a11y';

type EngineState = ReturnType<typeof useEngineRebuilt>;

const mocks = vi.hoisted(() => ({
  featureFlagsList: vi.fn(),
  engineState: null as EngineState | null,
  sendIssue: vi.fn(),
  refetchHome: vi.fn(),
  refetchStrategy: vi.fn(),
  undismissRecommendation: vi.fn(),
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

vi.mock('../../../src/hooks/admin/useEngineRebuilt', () => ({
  ENGINE_LEADS_PAGE: 50,
  ENGINE_LEADS_MAX: 200,
  useEngineRebuilt: () => {
    if (!mocks.engineState) throw new Error('Engine test state was not initialized');
    return mocks.engineState;
  },
}));

vi.mock('../../../src/hooks/admin/useAdminRecommendations', async () => {
  const actual = await vi.importActual<typeof import('../../../src/hooks/admin/useAdminRecommendations')>(
    '../../../src/hooks/admin/useAdminRecommendations',
  );
  return {
    ...actual,
    useAdminUndismissRecommendation: () => ({ mutate: mocks.undismissRecommendation }),
  };
});

vi.mock('../../../src/components/admin/BriefingReviewQueue', () => ({
  BriefingReviewQueue: () => <div data-testid="engine-weekly-briefings">Weekly briefing workflow</div>,
}));

vi.mock('../../../src/components/workspace-home/SeoChangeImpact', () => ({
  SeoChangeImpact: ({ hasGsc }: { hasGsc: boolean }) => (
    <div data-testid="engine-seo-change-impact" data-has-gsc={hasGsc}>SEO change impact workflow</div>
  ),
}));

vi.mock('../../../src/components/strategy', () => ({
  StrategyHeaderActions: () => <div data-testid="strategy-header-actions">Header actions</div>,
  StrategyStalenessNudges: () => <div data-testid="strategy-staleness-nudges">Staleness nudges</div>,
  StrategyEmptyState: () => <div data-testid="strategy-empty-state">Generate strategy</div>,
}));

vi.mock('../../../src/components/strategy/StrategyDiff', () => ({
  StrategyDiff: ({
    defaultExpanded,
    presentation,
  }: {
    defaultExpanded?: boolean;
    presentation?: 'default' | 'engine-spine';
  }) => (
    <div
      data-testid="strategy-diff"
      data-default-expanded={defaultExpanded}
      data-presentation={presentation}
    >
      What changed
    </div>
  ),
}));

vi.mock('../../../src/components/strategy/IntelligenceSignals', () => ({
  IntelligenceSignals: ({
    title,
    subtitle,
    initialLimit,
    presentation,
  }: {
    title?: string;
    subtitle?: string;
    initialLimit?: number;
    presentation?: 'default' | 'engine-spine';
  }) => (
    <div
      data-testid="intelligence-signals"
      data-title={title}
      data-subtitle={subtitle}
      data-initial-limit={initialLimit}
      data-presentation={presentation}
    >
      Signals
    </div>
  ),
}));

vi.mock('../../../src/components/strategy/LostQueryRecoveryCard', () => ({
  LostQueryRecoveryCard: () => <div data-testid="lost-query-recovery">Lost query recovery</div>,
}));

vi.mock('../../../src/components/strategy/issue/StanceBar', () => ({
  StanceBar: () => <div data-testid="stance-bar">Stance</div>,
}));

vi.mock('../../../src/components/strategy/issue/DraftedPovEditor', () => ({
  DraftedPovEditor: ({
    title,
    subtitle,
    presentation = 'default',
    stagedCount,
    onOpenEditor,
    onRegenerate,
  }: {
    title?: string;
    subtitle?: string;
    presentation?: 'default' | 'engine-summary';
    stagedCount?: number;
    onOpenEditor?: () => void;
    onRegenerate?: () => void;
  }) => (
    <div
      data-testid="drafted-pov-editor"
      data-title={title}
      data-subtitle={subtitle}
      data-presentation={presentation}
      data-staged-count={stagedCount}
    >
      {presentation === 'engine-summary' ? (
        <button type="button" onClick={onOpenEditor}>Edit POV</button>
      ) : (
        <>
          <span>Full POV editor</span>
          <button type="button" onClick={onRegenerate}>Regenerate</button>
        </>
      )}
    </div>
  ),
}));

vi.mock('../../../src/components/strategy/issue/BackingMovesQueue', () => ({
  BackingMovesQueue: ({
    onAddRec,
    onOpenDetails,
    recs,
    subtitle,
    shortlistCap,
    presentation,
  }: {
    onAddRec: () => void;
    onOpenDetails: (recId: string) => void;
    recs: Recommendation[];
    subtitle?: string;
    shortlistCap?: number;
    presentation?: 'default' | 'engine-spine';
  }) => (
    <div
      data-testid="backing-moves-queue"
      data-subtitle={subtitle}
      data-shortlist-cap={shortlistCap}
      data-presentation={presentation}
      data-rec-ids={recs.map((rec) => rec.id).join(',')}
    >
      Backing moves
      <button type="button" onClick={onAddRec}>Add a recommendation</button>
      <button type="button" onClick={() => onOpenDetails('rec-1')}>View move details</button>
    </div>
  ),
}));

vi.mock('../../../src/components/strategy/issue/AddRecommendationModal', () => ({
  AddRecommendationModal: ({ open }: { open: boolean }) => open
    ? <div role="dialog" aria-label="Add recommendation" data-testid="add-recommendation-modal">Add recommendation</div>
    : null,
}));

vi.mock('../../../src/components/strategy/CurationMeter', () => ({
  CurationMeter: ({ presentation }: { presentation?: 'default' | 'engine-spine' }) => (
    <div data-testid="curation-meter" data-presentation={presentation}>Curation meter</div>
  ),
}));

vi.mock('../../../src/components/strategy/NeedsAttentionStrip', () => ({
  NeedsAttentionStrip: ({
    items,
    presentation,
  }: {
    items: Array<{ recId: string; kind: string }>;
    presentation?: 'default' | 'engine-spine';
  }) => (
    <div
      data-testid="needs-attention-strip"
      data-presentation={presentation}
      data-item-kinds={items.map((item) => `${item.recId}:${item.kind}`).join(',')}
    >
      Needs attention
    </div>
  ),
}));

vi.mock('../../../src/components/strategy/StrategyConfigPanel', () => ({
  StrategyConfigPanel: ({ onOpenLocalSeoSetup }: { onOpenLocalSeoSetup?: () => void }) => (
    <div data-testid="strategy-config-panel">
      Strategy config
      {onOpenLocalSeoSetup && <button type="button" onClick={onOpenLocalSeoSetup}>Open market setup</button>}
    </div>
  ),
}));

vi.mock('../../../src/components/strategy/issue/IssueSetupReadiness', () => ({
  IssueSetupReadiness: () => <div data-testid="issue-setup-readiness">Setup readiness</div>,
}));

vi.mock('../../../src/components/strategy/issue/TrustLadderPanel', () => ({
  TrustLadderPanel: () => <div data-testid="trust-ladder-panel">Trust ladder</div>,
}));

vi.mock('../../../src/components/strategy/issue/AdminLeadsReadout', () => ({
  AdminLeadsReadout: () => <div data-testid="admin-leads-readout">Leads</div>,
}));

vi.mock('../../../src/components/strategy/CannibalizationTriage', () => ({
  cannibalizationKeeperPath: (item: { canonicalPath?: string; pages: Array<{ path: string }> }) => (
    item.canonicalPath ?? item.pages[0]?.path
  ),
  CannibalizationTriage: ({ entries }: { entries: Array<{ canonicalPath?: string }> }) => (
    <div data-testid="cannibalization-triage">
      {entries.length} cannibalization workflow · keeper {entries[0]?.canonicalPath ?? 'unset'}
    </div>
  ),
}));

vi.mock('../../../src/components/strategy/issue/KeeperSelector', () => ({
  KeeperSelector: ({ onKeeperChanged }: { onKeeperChanged?: (path: string) => void }) => (
    <div data-testid="keeper-selector">
      Keeper selector
      <button type="button" onClick={() => onKeeperChanged?.('/guides/implant-cost')}>Set test keeper</button>
    </div>
  ),
}));

vi.mock('../../../src/components/strategy/issue/ContentWorkOrderLens', () => ({
  ContentWorkOrderLens: ({
    includedRecIds,
    presentation,
  }: {
    includedRecIds?: ReadonlySet<string>;
    presentation?: 'default' | 'engine-spine';
  }) => (
    <div
      data-testid="content-work-order-lens"
      data-included-rec-ids={[...(includedRecIds ?? [])].join(',')}
      data-presentation={presentation}
    >
      {(includedRecIds?.size ?? 0) === 0 ? 'No content work orders yet' : 'Content work-orders'}
    </div>
  ),
}));

vi.mock('../../../src/components/strategy/issue/KeywordTargetsLens', () => ({
  KeywordTargetsLens: ({
    includedRecIds,
    presentation,
  }: {
    includedRecIds?: ReadonlySet<string>;
    presentation?: 'default' | 'engine-spine';
  }) => (
    <div
      data-testid="keyword-targets-lens"
      data-included-rec-ids={[...(includedRecIds ?? [])].join(',')}
      data-presentation={presentation}
    >
      {(includedRecIds?.size ?? 0) === 0 ? 'No keyword targets yet' : 'Keyword targets'}
    </div>
  ),
}));

vi.mock('../../../src/components/engine-rebuilt/EngineMoveDrawer', () => ({
  EngineMoveDrawer: ({ open }: { open: boolean }) => open
    ? (
      <div role="dialog" aria-label="Move drawer" data-testid="engine-move-drawer">
        Move drawer
      </div>
    )
    : null,
}));

vi.mock('../../../src/components/local-seo/LocalSeoMarketSetupDrawer', () => ({
  LocalSeoMarketSetupDrawer: ({ open }: { open: boolean }) => open
    ? <div role="dialog" aria-label="Local SEO setup" data-testid="local-seo-setup-drawer">Local SEO setup</div>
    : null,
}));

const workspaceId = 'ws-engine';

const SPINE_SECTION_TEST_IDS = [
  'engine-section-orientation',
  'engine-section-value-frame',
  'engine-section-pov',
  'engine-section-stance',
  'engine-section-strategy-evidence',
  'engine-section-backing-moves',
  'engine-section-projections',
  'engine-trust-spine-preview',
  'engine-section-operations',
] as const;

const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const scrollIntoViewMock = vi.fn();

const baseRec: Recommendation = {
  id: 'rec-1',
  workspaceId,
  priority: 'fix_now',
  type: 'content',
  title: 'Refresh the implant page',
  description: 'Refresh stale content around dental implants.',
  insight: 'Search demand is rising and the page is stale.',
  impact: 'high',
  effort: 'low',
  impactScore: 88,
  source: 'strategy',
  affectedPages: ['implant'],
  trafficAtRisk: 120,
  impressionsAtRisk: 2400,
  estimatedGain: 'More qualified implant visits',
  actionType: 'manual',
  status: 'pending',
  clientStatus: 'system',
  lifecycle: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const workQueue: WorkQueueClassification = {
  streams: { opt: 1, send: 1, money: 1, unclassified: 0 },
  items: [
    {
      stream: 'send',
      id: 'request-1',
      title: 'Approve July issue',
      meta: 'Client request',
      impact: 'Send',
      direction: 'neutral',
      sourceType: 'request',
    },
    {
      stream: 'opt',
      id: 'audit-1',
      title: 'Fix schema warnings',
      meta: 'Site audit',
      impact: '2 warnings',
      direction: 'negative',
      sourceType: 'audit_error',
    },
    {
      stream: 'money',
      id: 'money-1',
      title: 'Measured value frame',
      meta: 'Outcome evidence',
      impact: '$18k',
      direction: 'positive',
      sourceType: 'content_pipeline',
    },
  ],
};

function makeEngineState(overrides: Partial<EngineState> = {}): EngineState {
  const strategy = {
    generatedAt: '2026-07-07T12:00:00.000Z',
    pageMap: [{ pagePath: '/implant' }],
    seoDataMode: 'full',
    strategyUx: { localSync: { applies: false } },
    cannibalization: [],
  };
  const homeData = {
    ranks: [],
    requests: [],
    contentRequests: [],
    activity: [],
    annotations: [],
    churnSignals: [],
    workOrders: [],
    searchData: null,
    ga4Data: null,
    comparison: null,
    workQueue,
    moneyFrame: {
      valueAtStake: 18450,
      recoveredSoFar: 2760,
      provenance: 'measured_action',
      precomputedAt: '2026-07-07T12:00:00.000Z',
    },
    cockpitVerdict: null,
    weeklySummary: null,
  };
  return {
    keywordQuery: {
      data: { strategy, seoDataAvailable: true, providers: [], workspaceData: null },
      isLoading: false,
      isError: false,
      isFetching: false,
      isAuxLoading: false,
      refetch: mocks.refetchStrategy.mockResolvedValue({ error: null }),
    },
    strategy,
    isRealStrategy: true,
    displayedSeoDataMode: 'full',
    localSync: { applies: false },
    settings: {
      businessContext: '',
      setBusinessContext: vi.fn(),
      contextOpen: false,
      setContextOpen: vi.fn(),
      seoDataAvailable: true,
      seoDataMode: 'full',
      setSeoDataMode: vi.fn(),
      maxPages: 500,
      setMaxPages: vi.fn(),
      competitors: 'competitor.example',
      setCompetitors: vi.fn(),
      settingsOpen: false,
      setSettingsOpen: vi.fn(),
      discoveringCompetitors: false,
      discoverError: null,
      discoverCompetitors: vi.fn(),
      selectedSeoDataProvider: 'dataforseo',
      buildStrategyGenerationParams: vi.fn(() => ({})),
    },
    generation: {
      startingStrategyJob: false,
      lastStartedJobId: null,
      error: null,
      setError: vi.fn(),
      showNextSteps: false,
      setShowNextSteps: vi.fn(),
      refreshOrderingPromptOpen: false,
      setRefreshOrderingPromptOpen: vi.fn(),
      dismissedRefreshAt: null,
      setDismissedRefreshAt: vi.fn(),
      activeStrategyJob: undefined,
      generating: false,
      runStartJob: vi.fn(),
      generateStrategy: vi.fn(),
      refresh: { mutate: vi.fn(), isPending: false },
    },
    feedback: { rows: [] },
    metrics: {
      hasVolumeValidation: true,
      avgPos: 9.2,
      ranked: [{ pagePath: '/implant' }],
    },
    homeQuery: {
      data: homeData,
      isLoading: false,
      isError: false,
      isFetching: false,
      dataUpdatedAt: new Date('2026-07-07T12:05:00.000Z').getTime(),
      refetch: mocks.refetchHome.mockResolvedValue({ error: null }),
    },
    workspace: {
      id: workspaceId,
      name: 'Acme Dental',
      webflowSiteName: 'Acme Dental',
    },
    workspaces: { data: [] },
    recommendations: { data: { workspaceId, generatedAt: '2026-07-07T12:00:00.000Z', recommendations: [baseRec], summary: { fixNow: 1, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 88, trafficAtRisk: 120, topRecommendationId: 'rec-1' } } },
    cockpitRecs: [baseRec],
    activeRecs: [baseRec],
    historyRecs: [],
    lifecycleActions: {
      send: vi.fn(),
      strike: vi.fn(),
      unstrike: vi.fn(),
      throttle: vi.fn(),
      fix: vi.fn(),
      isPending: false,
    },
    issueBulkSend: { mutate: mocks.sendIssue, isPending: false },
    strategyPov: {
      pov: {
        situation: 'Search demand is moving toward implant pages.',
        leadSentence: 'Refresh the implant page first.',
        wins: ['Implant page has room to recover.'],
        flags: ['Schema warnings still need review.'],
        leadMoveRecId: 'rec-1',
        generatedAt: '2026-07-07T12:00:00.000Z',
        updatedAt: '2026-07-07T12:00:00.000Z',
        version: 1,
        verdictHeadline: 'Refresh implant content before the next issue goes out.',
      },
      isLoading: false,
      isError: false,
      readError: null,
      retry: vi.fn(),
      edit: vi.fn(),
      editPending: false,
      generate: vi.fn(),
      regenerate: vi.fn(),
      isGenerating: false,
      generateError: null,
      wasUnchanged: false,
      refreshAvailable: false,
    },
    operatorSteering: {
      wording: {},
      sortOrder: {},
      editWording: vi.fn(),
      reorder: vi.fn(),
      addManualRec: vi.fn(),
      isPending: false,
      isLoading: false,
    },
    measuredCapture: true,
    conversionStatus: {
      status: {
        readiness: {
          ga4Connected: true,
          valueSet: true,
          segmentConfirmed: true,
          eventsPinned: true,
          eventsTyped: true,
          webflowConnected: true,
          povDrafted: true,
          openGapCount: 0,
          outcomeValueLabel: '$500',
          segmentLabel: 'Dental',
          resolvedProvenance: 'measured_action',
          lastLeadAt: '2026-07-07T12:00:00.000Z',
        },
      },
      isLoading: false,
      isError: false,
    },
    leads: { leads: [], total: 0, isLoading: false, isError: false },
    leadsLimit: 50,
    setLeadsLimit: vi.fn(),
    contentDecay: { data: { decayingPages: [] } },
    localSeo: { data: { markets: [{ id: 'market-1', label: 'Austin, TX', status: 'active' }] } },
    primaryMarket: { id: 'market-1', label: 'Austin, TX', status: 'active' },
    workQueue,
    workQueueSourceCounts: { request: 1, audit_error: 1, content_pipeline: 1 },
    moveQueueItems: [
      {
        stream: 'opt',
        id: 'rec-1',
        title: baseRec.title,
        meta: 'content · fix now · active',
        impact: '88 impact',
        direction: 'negative',
        sourceType: 'content_pipeline',
      },
    ],
    moveQueueSourceCounts: { content_pipeline: 1 },
    stagedRecIds: new Set<string>(),
    stagedSendableIds: [],
    stagedSendableSet: new Set<string>(),
    sendableSet: new Set(['rec-1']),
    stagedCount: 0,
    curatedCount: 0,
    toggleStage: vi.fn(),
    stageMany: vi.fn(),
    sendIssue: mocks.sendIssue,
    struckRecIds: [],
    markCut: vi.fn(),
    ...overrides,
  } as unknown as EngineState;
}

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderSurface(initialEntry = `/ws/${workspaceId}/seo-strategy`, client = createClient()) {
  const view = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <Routes>
            <Route
              path="/ws/:workspaceId/seo-strategy"
              element={(
                <>
                  <EngineSurface workspaceId={workspaceId} />
                  <LocationProbe />
                </>
              )}
            />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(view());
  return { ...result, client, rerenderSurface: () => result.rerender(view()) };
}

function FlaggedEngineHarness() {
  const enabled = useFeatureFlag('ui-rebuild-shell');
  return enabled ? <EngineSurface workspaceId={workspaceId} /> : <div data-testid="flag-off">Legacy Strategy</div>;
}

function renderFlagHarness(client = createClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/ws/${workspaceId}/seo-strategy`]}>
        <ToastProvider>
          <FlaggedEngineHarness />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function expectScopedTextWithClass(scope: HTMLElement, text: string | RegExp, className: string) {
  const matches = within(scope).getAllByText(text);
  expect(matches.some((element) => element.classList.contains(className))).toBe(true);
}

function expectSpineOrder(sectionIds: readonly string[]) {
  const sections = sectionIds.map((testId) => screen.getByTestId(testId));
  for (let index = 1; index < sections.length; index += 1) {
    expect(sections[index - 1].compareDocumentPosition(sections[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

describe('EngineSurface rebuilt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.undismissRecommendation.mockImplementation((
      _recId: string,
      options?: { onSuccess?: () => void; onSettled?: () => void },
    ) => {
      options?.onSuccess?.();
      options?.onSettled?.();
    });
    scrollIntoViewMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    });
    mocks.featureFlagsList.mockResolvedValue({ 'ui-rebuild-shell': true });
    mocks.engineState = makeEngineState();
  });

  afterEach(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      return;
    }
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('mounts after the real feature-flag hook transitions from loading fallback to ON', async () => {
    let resolveFlags: (value: { 'ui-rebuild-shell': boolean }) => void = () => {};
    mocks.featureFlagsList.mockReturnValue(new Promise((resolve) => {
      resolveFlags = resolve;
    }));

    renderFlagHarness();

    expect(screen.getByTestId('flag-off')).toBeInTheDocument();

    await act(async () => {
      resolveFlags({ 'ui-rebuild-shell': true });
    });

    expect(await screen.findByTestId('engine-rebuilt-surface')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Insights Engine · Acme Dental' })).toBeInTheDocument();
  });

  it('meets the rebuilt a11y floor after loading states settle', async () => {
    const { container } = renderSurface();

    expect(await screen.findByTestId('engine-rebuilt-surface')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll('.animate-pulse').length).toBe(0));
    await expectNoA11yViolations(container);
  });

  it('renders one ordered strategy spine without a top-level Engine lens switcher', async () => {
    renderSurface();

    await screen.findByTestId('engine-section-operations');
    expectSpineOrder(SPINE_SECTION_TEST_IDS);
    expect(screen.queryByRole('radio', { name: 'Spine' })).not.toBeInTheDocument();
    expect(screen.getByText('Average position')).toBeInTheDocument();
    expect(screen.getByText('#9.2')).toBeInTheDocument();
  });

  it('uses the prototype opening order, hierarchy, labels, and calm queue density', async () => {
    mocks.engineState = makeEngineState({
      cockpitRecs: [
        { ...baseRec, clientStatus: 'sent', sentAt: '2099-01-01T00:00:00.000Z' },
        { ...baseRec, id: 'rec-2', title: 'Review the implant FAQ', clientStatus: 'discussing' },
      ],
    });
    renderSurface();

    const surface = await screen.findByTestId('engine-rebuilt-surface');
    expect(surface.parentElement).toHaveStyle({
      maxWidth: 'calc(var(--page-max) - (2 * var(--page-pad-x)))',
      padding: '0px',
    });
    expect(surface).toHaveClass('gap-[var(--space-4)]');
    const opening = screen.getByTestId('engine-opening-cluster');
    expect(opening).toHaveClass('gap-0');
    const identity = screen.getByRole('heading', { name: 'Insights Engine · Acme Dental' });
    const orientation = await screen.findByTestId('engine-section-orientation');
    const changed = screen.getByTestId('strategy-diff');
    expect(changed).toHaveAttribute('data-presentation', 'engine-spine');
    const verdict = within(orientation).getByRole('heading', { name: 'Refresh implant content before the next issue goes out.' });
    expect(opening).toContainElement(identity);
    expect(opening).toContainElement(orientation);
    expect(orientation).toHaveClass('space-y-[var(--space-4)]');
    expect(verdict.closest('section')).toHaveClass('px-7', 'py-6');
    expect(verdict.firstElementChild).toHaveClass('block', 'max-w-[26ch]', 'font-bold');
    expect(within(orientation).getByText('Search demand is moving toward implant pages.')).toHaveClass('t-page');
    expect(identity.compareDocumentPosition(changed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(changed.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(orientation).queryByText('Insights Engine · Acme Dental')).not.toBeInTheDocument();

    const valueFrame = screen.getByTestId('engine-section-value-frame');
    expect(within(valueFrame).getByText('Pipeline value at stake')).toBeInTheDocument();
    expect(within(valueFrame).getByText('$18,450')).toHaveClass('t-stat-lg');

    const pov = screen.getByTestId('drafted-pov-editor');
    expect(pov).toHaveAttribute('data-title', 'The point of view we send Acme Dental');
    expect(pov).toHaveAttribute('data-subtitle', 'The plain-language read the client opens with');
    expect(pov).toHaveAttribute('data-presentation', 'engine-summary');
    expect(pov).toHaveAttribute('data-staged-count', '0');

    const signals = screen.getByTestId('intelligence-signals');
    expect(signals).toHaveAttribute('data-title', 'Signals the Engine is watching');
    expect(signals).toHaveAttribute('data-initial-limit', '4');
    expect(signals).toHaveAttribute('data-presentation', 'engine-spine');

    const backingMoves = screen.getByTestId('backing-moves-queue');
    expect(backingMoves).toHaveAttribute('data-subtitle', 'The recommendations staged to back this point of view');
    expect(backingMoves).toHaveAttribute('data-shortlist-cap', '1');
    expect(backingMoves).toHaveAttribute('data-presentation', 'engine-spine');
    const supportRow = screen.getByTestId('engine-move-support-row');
    expect(within(supportRow).getByTestId('curation-meter')).toHaveAttribute('data-presentation', 'engine-spine');
    expect(within(supportRow).getByTestId('needs-attention-strip')).toHaveAttribute('data-presentation', 'engine-spine');
    expect(supportRow.compareDocumentPosition(backingMoves) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('toolbar', { name: 'Engine refresh controls' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('engine-header-actions')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('engine-topbar-actions-fallback')).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('opens one canonical full POV editor Drawer and restores focus to Edit POV on close', async () => {
    renderSurface();

    const edit = await screen.findByRole('button', { name: 'Edit POV' });
    edit.focus();
    fireEvent.click(edit);

    const drawer = screen.getByRole('dialog', { name: 'Edit the point of view we send Acme Dental' });
    expect(within(drawer).getByText('Full POV editor')).toBeInTheDocument();
    expect(within(drawer).getAllByRole('button', { name: 'Regenerate' })).toHaveLength(1);
    expect(screen.getAllByTestId('drafted-pov-editor')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Edit POV' })).toHaveLength(1);

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit the point of view we send Acme Dental' })).not.toBeInTheDocument());
    expect(edit).toHaveFocus();
    expect(screen.getAllByTestId('drafted-pov-editor')).toHaveLength(1);
  });

  it('does not reserve an empty move-support row when no curation or attention state exists', async () => {
    renderSurface();

    expect(await screen.findByTestId('engine-section-backing-moves')).toBeInTheDocument();
    expect(screen.queryByTestId('engine-move-support-row')).not.toBeInTheDocument();
  });

  it('keeps a cached strategy behind the loading composition while the aggregate home snapshot is cold', () => {
    const engineState = makeEngineState();
    mocks.engineState = makeEngineState({
      homeQuery: {
        ...engineState.homeQuery,
        data: undefined,
        isLoading: true,
        isPending: true,
        isError: false,
        dataUpdatedAt: 0,
      },
    } as unknown as Partial<EngineState>);

    renderSurface();

    expect(screen.getByTestId('engine-rebuilt-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('engine-rebuilt-surface')).not.toBeInTheDocument();
    expect(screen.queryByText('Freshness unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Value proof is still being prepared')).not.toBeInTheDocument();
  });

  it('shows a retryable aggregate-home error instead of manufacturing empty value proof', async () => {
    const engineState = makeEngineState();
    const retryHome = vi.fn().mockResolvedValue({ error: null });
    mocks.engineState = makeEngineState({
      homeQuery: {
        ...engineState.homeQuery,
        data: undefined,
        isLoading: false,
        isPending: false,
        isError: true,
        error: new Error('workspace summary unavailable'),
        dataUpdatedAt: 0,
        refetch: retryHome,
      },
    } as unknown as Partial<EngineState>);

    renderSurface();

    expect(await screen.findByText('Engine summary did not load')).toBeInTheDocument();
    expect(screen.queryByTestId('engine-rebuilt-surface')).not.toBeInTheDocument();
    expect(screen.queryByText('Freshness unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Value proof is still being prepared')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryHome).toHaveBeenCalledTimes(1);
  });

  it('keeps recommendation-backed composition in a contextual loading state until the first set arrives', async () => {
    mocks.engineState = makeEngineState({
      recommendations: {
        data: undefined,
        isLoading: true,
        isError: false,
        refetch: vi.fn(),
      },
      cockpitRecs: [],
      activeRecs: [],
      historyRecs: [],
    } as unknown as Partial<EngineState>);

    renderSurface('/ws/ws-engine/seo-strategy?lens=operations');

    expect(await screen.findByTestId('engine-recommendations-loading')).toBeInTheDocument();
    expect(screen.queryByText(/No recommendations match/i)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('engine-section-value-frame')).getByText('Loading recommendation queue'))
      .toBeInTheDocument();

    const projections = screen.getByTestId('engine-section-projections');
    expect(within(projections).getByTestId('engine-projections-loading')).toBeInTheDocument();
    expect(within(projections).queryByText('No keyword targets yet')).not.toBeInTheDocument();
    fireEvent.click(within(projections).getByRole('radio', { name: 'Content work orders' }));
    expect(within(projections).queryByText('No content work orders yet')).not.toBeInTheDocument();

    const historyToggle = screen.getByRole('button', { name: /Recommendation history/ });
    expect(historyToggle).toHaveTextContent('—');
    fireEvent.click(historyToggle);
    expect(screen.getByTestId('engine-recommendation-history-loading')).toBeInTheDocument();
    expect(screen.queryByText('No recommendation history yet')).not.toBeInTheDocument();
  });

  it('keeps paused no-cache recommendations pending across moves, projections, and history', async () => {
    mocks.engineState = makeEngineState({
      recommendations: {
        data: undefined,
        isLoading: false,
        isPending: true,
        isError: false,
        fetchStatus: 'paused',
        refetch: vi.fn(),
      },
      cockpitRecs: [],
      activeRecs: [],
      historyRecs: [],
    } as unknown as Partial<EngineState>);

    renderSurface('/ws/ws-engine/seo-strategy?lens=operations');

    expect(await screen.findByTestId('engine-recommendations-loading')).toBeInTheDocument();
    expect(screen.getByTestId('drafted-pov-editor')).not.toHaveAttribute('data-staged-count');
    const projections = screen.getByTestId('engine-section-projections');
    expect(within(projections).getByTestId('engine-projections-loading')).toBeInTheDocument();
    expect(within(projections).queryByText('No keyword targets yet')).not.toBeInTheDocument();
    fireEvent.click(within(projections).getByRole('radio', { name: 'Content work orders' }));
    expect(within(projections).queryByText('No content work orders yet')).not.toBeInTheDocument();

    const historyToggle = screen.getByRole('button', { name: /Recommendation history/ });
    expect(historyToggle).toHaveTextContent('—');
    fireEvent.click(historyToggle);
    expect(screen.getByTestId('engine-recommendation-history-loading')).toBeInTheDocument();
    expect(screen.queryByText('No recommendation history yet')).not.toBeInTheDocument();
  });

  it('shows one retryable recommendation error instead of empty queues when the first read fails', async () => {
    const retryRecommendations = vi.fn();
    mocks.engineState = makeEngineState({
      recommendations: {
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error('recommendations unavailable'),
        refetch: retryRecommendations,
      },
      cockpitRecs: [],
      activeRecs: [],
      historyRecs: [],
    } as unknown as Partial<EngineState>);

    renderSurface('/ws/ws-engine/seo-strategy?lens=operations');

    const moves = await screen.findByTestId('engine-section-backing-moves');
    expect(screen.getByTestId('drafted-pov-editor')).not.toHaveAttribute('data-staged-count');
    expect(within(moves).getByText('Recommendation queue did not load')).toBeInTheDocument();
    expect(within(moves).queryByText(/No recommendations match/i)).not.toBeInTheDocument();
    fireEvent.click(within(moves).getByRole('button', { name: 'Retry' }));
    expect(retryRecommendations).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Recommendation history/ }));
    const history = screen.getByTestId('engine-recommendation-history');
    expect(within(history).getByText('Recommendation history is unavailable')).toBeInTheDocument();
    fireEvent.click(within(history).getByRole('button', { name: 'Retry' }));
    expect(retryRecommendations).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('No recommendation history yet')).not.toBeInTheDocument();

    const projections = screen.getByTestId('engine-section-projections');
    expect(within(projections).getByText('Projection data did not load')).toBeInTheDocument();
    expect(within(projections).queryByText('No keyword targets yet')).not.toBeInTheDocument();
    fireEvent.click(within(projections).getByRole('radio', { name: 'Content work orders' }));
    expect(within(projections).queryByText('No content work orders yet')).not.toBeInTheDocument();
    fireEvent.click(within(projections).getByRole('button', { name: 'Retry projections' }));
    expect(retryRecommendations).toHaveBeenCalledTimes(3);
  });

  it('preserves cached recommendations and history when a background refresh fails', async () => {
    const engineState = makeEngineState();
    const retryRecommendations = vi.fn();
    const dismissed = {
      ...baseRec,
      id: 'dismissed-cached',
      title: 'Cached dismissed recommendation',
      status: 'dismissed' as const,
      lifecycle: 'struck' as const,
    };
    mocks.engineState = makeEngineState({
      recommendations: {
        ...engineState.recommendations,
        isLoading: false,
        isError: true,
        error: new Error('refresh failed'),
        refetch: retryRecommendations,
      },
      cockpitRecs: [baseRec, dismissed],
      activeRecs: [baseRec],
      historyRecs: [dismissed],
      stagedSendableSet: new Set(['rec-1']),
      stagedCount: 1,
    } as unknown as Partial<EngineState>);

    renderSurface('/ws/ws-engine/seo-strategy?lens=operations');

    expect(await screen.findByText('Recommendation queue may be stale')).toBeInTheDocument();
    expect(screen.getByTestId('backing-moves-queue')).toHaveAttribute('data-rec-ids', 'rec-1');
    const historyToggle = screen.getByRole('button', { name: /Recommendation history/ });
    expect(historyToggle).toHaveTextContent('1');
    fireEvent.click(historyToggle);
    const history = screen.getByTestId('engine-recommendation-history');
    expect(within(history).getByText('Recommendation history may be stale')).toBeInTheDocument();
    expect(within(history).getByText('Cached dismissed recommendation')).toBeInTheDocument();
    fireEvent.click(within(history).getByRole('button', { name: 'Refresh history' }));
    expect(retryRecommendations).toHaveBeenCalledTimes(1);

    const projections = screen.getByTestId('engine-section-projections');
    expect(within(projections).getByText('Projections may be stale')).toBeInTheDocument();
    expect(within(projections).getByTestId('keyword-targets-lens')).toHaveAttribute('data-included-rec-ids', 'rec-1');
    fireEvent.click(within(projections).getByRole('button', { name: 'Refresh projections' }));
    expect(retryRecommendations).toHaveBeenCalledTimes(2);
  });

  it('separates a failed POV read from generate and regenerate actions', async () => {
    const engineState = makeEngineState();
    const retryPov = vi.fn();
    mocks.engineState = makeEngineState({
      strategyPov: {
        ...engineState.strategyPov,
        pov: null,
        isLoading: false,
        isError: true,
        readError: new Error('POV read unavailable'),
        retry: retryPov,
      },
    });

    renderSurface();

    expect(await screen.findByRole('heading', { name: 'Point of view temporarily unavailable' })).toBeInTheDocument();
    const povSection = screen.getByTestId('engine-section-pov');
    expect(within(povSection).getByText('Point of view did not load')).toBeInTheDocument();
    expect(within(povSection).queryByTestId('drafted-pov-editor')).not.toBeInTheDocument();
    expect(within(povSection).queryByRole('button', { name: /Generate|Regenerate/ })).not.toBeInTheDocument();
    fireEvent.click(within(povSection).getByRole('button', { name: 'Retry' }));
    expect(retryPov).toHaveBeenCalledTimes(1);
  });

  it('keeps a cached POV visible with a stale warning when its background read fails', async () => {
    const engineState = makeEngineState();
    mocks.engineState = makeEngineState({
      strategyPov: {
        ...engineState.strategyPov,
        isError: true,
        readError: new Error('POV refresh unavailable'),
      },
    });

    renderSurface();

    const povSection = await screen.findByTestId('engine-section-pov');
    expect(within(povSection).getByTestId('drafted-pov-editor')).toBeInTheDocument();
    expect(within(povSection).getByText('Point of view may be stale')).toBeInTheDocument();
  });

  it('keeps sent recommendations in attention classification while Backing Moves remains active-only', async () => {
    const superseded = {
      ...baseRec,
      id: 'stale-sent-superseded',
      title: 'Old implant recommendation',
      clientStatus: 'sent' as const,
      sentAt: '2026-05-01T00:00:00.000Z',
      createdAt: '2026-04-01T00:00:00.000Z',
    };
    const stale = {
      ...baseRec,
      id: 'stale-sent-alone',
      title: 'Old services recommendation',
      clientStatus: 'sent' as const,
      sentAt: '2026-05-01T00:00:00.000Z',
      createdAt: '2026-04-01T00:00:00.000Z',
      affectedPages: ['/services'],
    };
    mocks.engineState = makeEngineState({
      cockpitRecs: [baseRec, superseded, stale],
      activeRecs: [baseRec],
      historyRecs: [superseded, stale],
    } as Partial<EngineState>);

    renderSurface();

    const queue = await screen.findByTestId('backing-moves-queue');
    expect(queue).toHaveAttribute('data-rec-ids', 'rec-1');
    expect(screen.getByTestId('needs-attention-strip')).toHaveAttribute(
      'data-item-kinds',
      'stale-sent-superseded:superseded,stale-sent-alone:stale_sent',
    );
  });

  it('keeps the stale-POV warning directly adjacent to the compact POV summary', async () => {
    const engineState = makeEngineState();
    mocks.engineState = makeEngineState({
      strategyPov: {
        ...engineState.strategyPov,
        refreshAvailable: true,
        pov: {
          ...engineState.strategyPov.pov!,
          editedAt: '2026-07-07T12:10:00.000Z',
        },
      },
      struckRecIds: ['rec-1'],
      operatorSteering: {
        ...engineState.operatorSteering,
        wording: { 'rec-1': { title: 'Locally edited wording' } },
      },
    });
    renderSurface();

    const povSection = await screen.findByTestId('engine-section-pov');
    const summary = within(povSection).getByTestId('drafted-pov-editor');
    const warning = within(povSection).getByText('Point of view refresh available').closest('[role="status"]')
      ?? within(povSection).getByText('Point of view refresh available').parentElement;
    expect(warning).not.toBeNull();
    expect(summary.compareDocumentPosition(warning!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(povSection).getByText(/evidence or brand voice changed/i)).toBeInTheDocument();
    expect(within(povSection).getByText(/saved wording was preserved/i)).toBeInTheDocument();
    expect(within(povSection).getAllByRole('button', { name: 'Regenerate' })).toHaveLength(1);
    expect(within(povSection).getAllByRole('button', { name: 'Edit POV' })).toHaveLength(1);
  });

  it('uses neutral refresh copy for an unedited generated POV', async () => {
    const engineState = makeEngineState();
    mocks.engineState = makeEngineState({
      strategyPov: {
        ...engineState.strategyPov,
        refreshAvailable: true,
        pov: { ...engineState.strategyPov.pov!, editedAt: null },
      },
    });

    renderSurface();

    const povSection = await screen.findByTestId('engine-section-pov');
    expect(within(povSection).getByText(/evidence or brand voice changed since this point of view was generated/i))
      .toBeInTheDocument();
    expect(within(povSection).queryByText(/saved wording was preserved/i)).not.toBeInTheDocument();
    expect(within(povSection).getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
  });

  it('shows regenerate failures beside the POV controls with empathetic feedback', async () => {
    const engineState = makeEngineState();
    mocks.engineState = makeEngineState({
      strategyPov: {
        ...engineState.strategyPov,
        generateError: new Error('Regeneration service is temporarily unavailable'),
      },
    });

    renderSurface();

    const povSection = await screen.findByTestId('engine-section-pov');
    expect(within(povSection).getByText('Point of view update failed')).toBeInTheDocument();
    expect(within(povSection).getByText(/temporarily unavailable/i)).toBeInTheDocument();
  });

  it('does not infer POV staleness from local cut or wording state when the server reports fresh', async () => {
    const engineState = makeEngineState();
    mocks.engineState = makeEngineState({
      strategyPov: { ...engineState.strategyPov, refreshAvailable: false },
      struckRecIds: ['rec-1'],
      operatorSteering: {
        ...engineState.operatorSteering,
        wording: { 'rec-1': { title: 'Locally edited wording' } },
      },
    });

    renderSurface();

    await screen.findByTestId('engine-section-pov');
    expect(screen.queryByText('Point of view refresh available')).not.toBeInTheDocument();
    expect(screen.queryByText('Point of view may be out of date')).not.toBeInTheDocument();
  });

  it('keeps Backing Moves canonical-active-only and renders every history complement row once with full review controls', async () => {
    const completed = {
      ...baseRec,
      id: 'completed-rec',
      title: 'Completed recommendation',
      status: 'completed' as const,
      opportunity: {
        value: 91,
        emvPerWeek: 1250,
        predictedEmv: 5000,
        roiPerEffortDay: 625,
        confidence: 0.8,
        calibration: 1,
        groundedSpine: 'computed' as const,
        components: [{
          dimension: 'demand' as const,
          rawValue: 2400,
          normalized: 0.9,
          weight: 0.3,
          contribution: 0.27,
          evidence: '2,400 grounded impressions',
        }],
        calibrationVersion: 'test-v1',
        modelVersion: 'ov-1',
      },
    };
    const dismissed = {
      ...baseRec,
      id: 'dismissed-rec',
      title: 'Dismissed recommendation',
      status: 'dismissed' as const,
      lifecycle: 'struck' as const,
    };
    const struck = { ...baseRec, id: 'struck-rec', title: 'Struck recommendation', lifecycle: 'struck' as const };
    const throttled = {
      ...baseRec,
      id: 'throttled-rec',
      title: 'Throttled recommendation',
      lifecycle: 'throttled' as const,
      throttledUntil: '2099-01-01T00:00:00.000Z',
    };
    const sent = { ...baseRec, id: 'sent-rec', title: 'Sent recommendation', clientStatus: 'sent' as const };
    const approved = { ...baseRec, id: 'approved-rec', title: 'Approved recommendation', clientStatus: 'approved' as const };
    const declined = { ...baseRec, id: 'declined-rec', title: 'Declined recommendation', clientStatus: 'declined' as const };
    const discussing = { ...baseRec, id: 'discussing-rec', title: 'Discussing active recommendation', clientStatus: 'discussing' as const };
    const activeRecs = [baseRec, discussing];
    const historyRecs = [completed, dismissed, struck, throttled, sent, approved, declined];
    mocks.engineState = makeEngineState({
      cockpitRecs: [...activeRecs, ...historyRecs],
      activeRecs,
      historyRecs,
    } as Partial<EngineState>);

    renderSurface('/ws/ws-engine/seo-strategy?lens=operations');

    const queue = await screen.findByTestId('backing-moves-queue');
    expect(queue).toHaveAttribute('data-rec-ids', 'rec-1,discussing-rec');
    const historyToggle = screen.getByRole('button', { name: /Recommendation history/ });
    expect(screen.queryByText('Completed recommendation')).not.toBeInTheDocument();
    fireEvent.click(historyToggle);

    for (const rec of historyRecs) {
      expect(screen.getAllByText(rec.title)).toHaveLength(1);
    }
    expect(screen.getByText('Dismissed (1)')).toBeInTheDocument();
    expect(screen.getByText('Struck (1)')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Completed recommendation').closest('button')!);
    expect(screen.getByText('OV breakdown')).toBeInTheDocument();
    expect(screen.getByText('2,400 grounded impressions')).toBeInTheDocument();
    expect(screen.getByText('EMV/wk (admin)')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Dismissed recommendation').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Un-dismiss' }));
    expect(mocks.undismissRecommendation).toHaveBeenCalledWith(
      'dismissed-rec',
      expect.objectContaining({
        onError: expect.any(Function),
        onSettled: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    );
    expect(screen.getByText('Dismissed status cleared')).toBeInTheDocument();
    expect(screen.getByText(/Other lifecycle and client decisions remain unchanged/i)).toBeInTheDocument();
    expect(screen.queryByText(/active queue|back to active/i)).not.toBeInTheDocument();
  });

  it('blocks duplicate un-dismiss submissions and preserves the row with retryable feedback on failure', async () => {
    const dismissed = {
      ...baseRec,
      id: 'dismissed-rec',
      title: 'Dismissed recommendation',
      status: 'dismissed' as const,
      lifecycle: 'struck' as const,
    };
    let mutationOptions: {
      onError?: (error: unknown) => void;
      onSettled?: () => void;
    } | undefined;
    mocks.undismissRecommendation.mockImplementationOnce((
      _recId: string,
      options: typeof mutationOptions,
    ) => {
      mutationOptions = options;
    });
    mocks.engineState = makeEngineState({
      cockpitRecs: [dismissed],
      activeRecs: [],
      historyRecs: [dismissed],
    } as Partial<EngineState>);

    renderSurface('/ws/ws-engine/seo-strategy?lens=operations');
    fireEvent.click(await screen.findByRole('button', { name: /Recommendation history/ }));
    fireEvent.click(screen.getByText('Dismissed recommendation').closest('button')!);
    const undismissButton = screen.getByRole('button', { name: 'Un-dismiss' });
    fireEvent.click(undismissButton);
    fireEvent.click(undismissButton);

    expect(mocks.undismissRecommendation).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Clearing dismissed status')).toBeInTheDocument();
    expect(screen.getByText(/Struck, throttled, and client lifecycle decisions remain in place/i)).toBeInTheDocument();
    expect(screen.queryByText(/active queue|back to active/i)).not.toBeInTheDocument();

    act(() => {
      mutationOptions?.onError?.(new Error('Status service unavailable'));
      mutationOptions?.onSettled?.();
    });

    expect(screen.getByText('Dismissed status was not cleared')).toBeInTheDocument();
    expect(screen.getByText(/Status service unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/active queue|back to active/i)).not.toBeInTheDocument();
    expect(screen.getByText('Dismissed recommendation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Un-dismiss' })).toBeInTheDocument();
  });

  it('uses the full recommendation set as the client-preview ratio denominator', async () => {
    const sentRecs = Array.from({ length: 5 }, (_, index) => ({
      ...baseRec,
      id: `sent-${index}`,
      title: `Sent ${index}`,
      clientStatus: 'sent' as const,
    }));
    const activeRecs = [
      { ...baseRec, id: 'active-1' },
      { ...baseRec, id: 'active-2' },
    ];
    mocks.engineState = makeEngineState({
      cockpitRecs: [...activeRecs, ...sentRecs],
      activeRecs,
      historyRecs: sentRecs,
      curatedCount: 5,
    } as Partial<EngineState>);

    const first = renderSurface();
    const preview = await screen.findByTestId('engine-trust-spine-preview');
    expect(within(preview).getByText('5 / 7')).toBeInTheDocument();
    expect(within(preview).queryByText('5 / 2')).not.toBeInTheDocument();

    first.unmount();
    mocks.engineState = makeEngineState({
      cockpitRecs: sentRecs,
      activeRecs: [],
      historyRecs: sentRecs,
      curatedCount: 5,
    } as Partial<EngineState>);
    renderSurface();
    expect(within(await screen.findByTestId('engine-trust-spine-preview')).getByText('5 / 5')).toBeInTheDocument();
  });

  it('lazy-mounts each owner-approved Operations home once and passes real GSC connection state', async () => {
    mocks.featureFlagsList.mockResolvedValue({
      'ui-rebuild-shell': true,
      'client-briefing-v2': true,
    });
    const engineState = makeEngineState();
    mocks.engineState = makeEngineState({
      workspace: { ...engineState.workspace!, gscPropertyUrl: 'sc-domain:acme.example' },
    });
    renderSurface('/ws/ws-engine/seo-strategy?lens=operations');

    const briefingToggle = await screen.findByRole('button', { name: /Weekly Briefings/ });
    const historyToggle = screen.getByRole('button', { name: /Recommendation history/ });
    const impactToggle = screen.getByRole('button', { name: /SEO Change Impact/ });
    expect(screen.queryByTestId('engine-weekly-briefings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('engine-recommendation-history')).not.toBeInTheDocument();
    expect(screen.queryByTestId('engine-seo-change-impact')).not.toBeInTheDocument();

    fireEvent.click(briefingToggle);
    fireEvent.click(historyToggle);
    fireEvent.click(impactToggle);

    expect(screen.getAllByTestId('engine-weekly-briefings')).toHaveLength(1);
    expect(screen.getAllByTestId('engine-recommendation-history')).toHaveLength(1);
    expect(screen.getAllByTestId('engine-seo-change-impact')).toHaveLength(1);
    expect(screen.getByTestId('engine-seo-change-impact')).toHaveAttribute('data-has-gsc', 'true');
  });

  it('keeps the Weekly Briefings Operations home behind client-briefing-v2', async () => {
    mocks.featureFlagsList.mockResolvedValue({
      'ui-rebuild-shell': true,
      'client-briefing-v2': false,
    });
    renderSurface('/ws/ws-engine/seo-strategy?lens=operations');

    await screen.findByTestId('engine-section-operations');
    await waitFor(() => expect(mocks.featureFlagsList).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Weekly Briefings/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Recommendation history/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SEO Change Impact/ })).toBeInTheDocument();
  });

  it('keeps operational tools collapsed until requested, while the operations deep link opens them', async () => {
    const first = renderSurface();

    await screen.findByTestId('engine-section-operations');
    expect(screen.getByTestId('engine-section-operations').querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getAllByTestId('engine-lens-operations')).toHaveLength(1);

    first.unmount();
    renderSurface('/ws/ws-engine/seo-strategy?lens=operations');

    await screen.findByTestId('engine-section-operations');
    expect(screen.getByTestId('engine-section-operations').querySelector('details')).toHaveAttribute('open');
    expect(screen.getByTestId('engine-lens-operations')).toBeInTheDocument();
  });

  it('keeps setup and operator tools reachable from an operations deep link before strategy generation', async () => {
    mocks.engineState = makeEngineState({
      isRealStrategy: false,
      strategy: null,
      cockpitRecs: [],
    });

    renderSurface('/ws/ws-engine/seo-strategy?lens=operations');

    expect(await screen.findByTestId('engine-empty-strategy')).toBeInTheDocument();
    const operations = screen.getByTestId('engine-section-operations');
    expect(operations.querySelector('details')).toHaveAttribute('open');
    expect(within(operations).getByTestId('engine-lens-operations')).toBeInTheDocument();
    await waitFor(() => expect(operations).toHaveFocus());
  });

  it('mounts cannibalization write controls exactly once in Operations', async () => {
    const engineState = makeEngineState();
    mocks.engineState = makeEngineState({
      strategy: {
        ...engineState.strategy!,
        cannibalization: [{
          keyword: 'dental implant cost',
          severity: 'high',
          recommendation: 'Keep the service page and consolidate the guide.',
          canonicalPath: '/services/implants',
          pages: [
            { path: '/services/implants', position: 7, source: 'gsc' },
            { path: '/guides/implant-cost', position: 11, source: 'gsc' },
          ],
        }],
      },
    });

    const rendered = renderSurface('/ws/ws-engine/seo-strategy?lens=operations');

    const operations = await screen.findByTestId('engine-section-operations');
    expect(within(operations).getAllByTestId('cannibalization-triage')).toHaveLength(1);
    expect(within(operations).getAllByTestId('keeper-selector')).toHaveLength(1);
    expect(screen.getAllByTestId('cannibalization-triage')).toHaveLength(1);
    expect(screen.getAllByTestId('keeper-selector')).toHaveLength(1);
    expect(within(operations).getByTestId('cannibalization-triage')).toHaveTextContent('keeper /services/implants');

    fireEvent.click(within(operations).getByRole('button', { name: 'Set test keeper' }));
    mocks.engineState = makeEngineState({
      strategy: {
        ...engineState.strategy!,
        cannibalization: [{
          keyword: 'dental implant cost',
          severity: 'high',
          recommendation: 'Keep the service page and consolidate the guide.',
          canonicalPath: '/services/implants',
          pages: [
            { path: '/services/implants', position: 7, source: 'gsc' },
            { path: '/guides/implant-cost', position: 11, source: 'gsc' },
          ],
        }],
      },
    });
    rendered.rerenderSurface();

    expect(within(operations).getByTestId('cannibalization-triage')).toHaveTextContent('keeper /services/implants');
  });

  it('uses the drafted POV lead sentence when a dedicated verdict headline is absent', async () => {
    const engineState = makeEngineState();
    mocks.engineState = makeEngineState({
      strategyPov: {
        ...engineState.strategyPov,
        pov: {
          ...engineState.strategyPov.pov!,
          verdictHeadline: undefined,
          leadSentence: 'Push the "implant page," because it is already close to page one.',
          situation: 'Demand is already close enough to convert with focused work.',
        },
      },
    });

    renderSurface();

    const orientation = await screen.findByTestId('engine-section-orientation');
    expect(within(orientation).getByRole('heading', { name: 'Push the "implant page."' })).toBeInTheDocument();
    expect(within(orientation).queryByText(/because it is already close/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('Demand is already close enough to convert with focused work.').length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ['/ws/ws-engine/seo-strategy?lens=spine', 'engine-section-orientation'],
    ['/ws/ws-engine/seo-strategy?lens=changes', 'engine-section-changes'],
    ['/ws/ws-engine/seo-strategy?lens=signals', 'engine-section-strategy-evidence'],
    ['/ws/ws-engine/seo-strategy?lens=pov', 'engine-section-pov'],
    ['/ws/ws-engine/seo-strategy?lens=moves', 'engine-section-backing-moves'],
    ['/ws/ws-engine/seo-strategy?lens=operations', 'engine-section-operations'],
  ])('keeps the full spine visible and focuses the requested section for %s', async (entry, targetTestId) => {
    renderSurface(entry);

    const target = await screen.findByTestId(targetTestId);
    expectSpineOrder(SPINE_SECTION_TEST_IDS);
    await waitFor(() => expect(target).toHaveFocus());
    expect(target).toHaveStyle({ outline: 'none' });
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    if (entry.includes('lens=changes')) {
      expect(screen.getByTestId('strategy-diff')).toHaveAttribute('data-default-expanded', 'true');
    }
  });

  it('falls back to spine for an invalid lens value', async () => {
    renderSurface('/ws/ws-engine/seo-strategy?lens=unknown');

    expect(await screen.findByTestId('engine-invalid-lens-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('engine-section-orientation')).toBeInTheDocument();
  });

  it('keeps internal rebuild and migration language out of the visible Engine UI', async () => {
    const { container } = renderSurface();

    expect(await screen.findByTestId('engine-rebuilt-surface')).toBeInTheDocument();

    const visibleText = container.textContent ?? '';
    expect(visibleText).not.toMatch(/rebuild/i);
    expect(visibleText).not.toMatch(/migration/i);
    expect(visibleText).not.toMatch(/carry-over/i);
    expect(visibleText).not.toMatch(/route tab/i);
    expect(visibleText).not.toMatch(/url state/i);
    expect(visibleText).not.toMatch(/legacy aliases/i);
    expect(visibleText).not.toMatch(/mounted below/i);
  });

  it('keeps isolated Engine actions in one non-wrapping horizontal fallback', async () => {
    renderSurface();

    const actionGroup = await screen.findByTestId('engine-topbar-actions-fallback');
    expect(actionGroup).toHaveClass('max-w-full');
    expect(actionGroup).toHaveClass('items-center');
    expect(actionGroup).toHaveClass('overflow-x-auto');
    expect(actionGroup).not.toHaveClass('flex-col');
    expect(screen.getByTestId('strategy-header-actions')).toBeInTheDocument();
    expect(within(actionGroup).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send issue' })).not.toBeInTheDocument();
  });

  it('opens the move drawer exactly once from the backing moves section', async () => {
    renderSurface('/ws/ws-engine/seo-strategy?lens=moves');

    const backingMoves = await screen.findByTestId('engine-section-backing-moves');
    expect(within(backingMoves).getAllByTestId('backing-moves-queue')).toHaveLength(1);
    expect(within(backingMoves).queryByTestId('engine-work-queue')).not.toBeInTheDocument();
    fireEvent.click(within(backingMoves).getByRole('button', { name: 'View move details' }));

    expect(await screen.findByTestId('engine-move-drawer')).toBeInTheDocument();
    expect(screen.getAllByTestId('engine-move-drawer')).toHaveLength(1);
    expect(screen.getAllByRole('dialog', { name: 'Move drawer' })).toHaveLength(1);
  });

  it('opens the Add Recommendation modal exactly once from the backing moves queue', async () => {
    renderSurface('/ws/ws-engine/seo-strategy?lens=spine');

    expect(await screen.findByTestId('backing-moves-queue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a recommendation' }));

    expect(await screen.findByTestId('add-recommendation-modal')).toBeInTheDocument();
    expect(screen.getAllByTestId('add-recommendation-modal')).toHaveLength(1);
    expect(screen.getAllByRole('dialog', { name: 'Add recommendation' })).toHaveLength(1);
  });

  it('renders the prototype trust-spine preview in the spine lens with styleguide roles', async () => {
    renderSurface('/ws/ws-engine/seo-strategy?lens=spine');

    const preview = await screen.findByTestId('engine-trust-spine-preview');
    const portalFrame = within(preview).getByTestId('engine-client-portal-frame');
    const proofRow = within(preview).getByTestId('engine-client-proof-row');
    const recoveredTile = within(preview).getByTestId('engine-preview-recovered');
    expect(portalFrame).toHaveClass('dashboard-light');
    expect(preview.firstElementChild).toHaveClass(
      'max-sm:[&>div:first-child_.t-body]:whitespace-normal',
      'max-sm:[&>div:first-child_.t-body]:overflow-visible',
      'max-sm:[&>div:first-child_.t-body]:text-clip',
    );
    expect(proofRow).toHaveClass('sm:grid-cols-3');
    expect(proofRow).toHaveClass('mt-4');
    expect(recoveredTile).toHaveStyle({
      background: 'color-mix(in srgb, var(--teal) 8%, var(--surface-2))',
    });
    expect(recoveredTile.style.borderColor).toBe(
      'color-mix(in srgb, var(--teal) 28%, var(--brand-border))',
    );
    expect(within(preview).getByText('What Acme Dental sees — the trust spine')).toBeInTheDocument();
    expect(within(preview).getByText('Verdict first, dollar value, then the proof')).toBeInTheDocument();
    expect(within(preview).getByText('Client portal preview · Acme Dental')).toBeInTheDocument();
    expect(preview.querySelector('.fa-eye')).toBeInTheDocument();
    expectScopedTextWithClass(preview, 'Where you stand this quarter', 't-label');
    expectScopedTextWithClass(preview, 'Refresh implant content before the next issue goes out.', 't-stat-sm');
    expectScopedTextWithClass(preview, 'Refresh implant content before the next issue goes out.', 'font-bold');
    expectScopedTextWithClass(preview, 'Search demand is moving toward implant pages.', 't-ui');
    expectScopedTextWithClass(preview, 'Search demand is moving toward implant pages.', 'max-w-[52ch]');
    expectScopedTextWithClass(preview, 'Pipeline value at stake', 't-caption');
    expectScopedTextWithClass(preview, '$18,450', 't-stat');
    expectScopedTextWithClass(preview, 'Recovered so far', 't-caption');
    expectScopedTextWithClass(preview, '$2,760', 't-stat');
    expectScopedTextWithClass(preview, 'Moves in progress', 't-caption');
    expect(within(preview).queryByText('Backing moves live')).not.toBeInTheDocument();
    expectScopedTextWithClass(preview, '0 / 1', 't-stat');
    expect(within(preview).queryByText(/The client sees the verdict, value frame, and proof/)).not.toBeInTheDocument();
  });

  it('uses the prototype section-card shell for the stance allocation', async () => {
    renderSurface();

    const stance = await screen.findByTestId('engine-section-stance');
    expect(within(stance).getByText('How we are spending the effort')).toBeInTheDocument();
    expect(stance.querySelector('.fa-filter')).toBeInTheDocument();
    expect(stance.firstElementChild).toHaveStyle({ borderRadius: 'var(--radius-signature-lg)' });
  });

  it('switches the only visible lens control inside the staged-move projection section', async () => {
    mocks.engineState = makeEngineState({
      stagedRecIds: new Set(['rec-1']),
      stagedSendableIds: ['rec-1'],
      stagedSendableSet: new Set(['rec-1']),
      stagedCount: 1,
    });
    renderSurface();

    const projections = await screen.findByTestId('engine-section-projections');
    expect(projections.firstElementChild).toHaveClass(
      '[&>div:first-child]:flex-col',
      '[&>div:first-child]:items-stretch',
      'sm:[&>div:first-child]:flex-row',
      'max-sm:[&>div:first-child_.t-body]:whitespace-normal',
      'max-sm:[&>div:first-child_.t-body]:overflow-visible',
      'max-sm:[&>div:first-child_.t-body]:text-clip',
    );
    const projectionSwitcher = within(projections).getByRole('radiogroup');
    expect(projectionSwitcher).toHaveClass('w-full', 'overflow-x-auto', 'sm:w-fit');
    expect(projectionSwitcher).toHaveClass(
      'max-sm:[&>button]:min-w-0',
      'max-sm:[&>button]:flex-1',
      'max-sm:[&>button]:whitespace-normal',
    );
    expect(within(projections).getByRole('radio', { name: 'Keyword targets' })).toHaveAttribute('aria-checked', 'true');
    expect(within(projections).getByTestId('keyword-targets-lens')).toHaveAttribute('data-included-rec-ids', 'rec-1');
    expect(within(projections).getByTestId('keyword-targets-lens')).toHaveAttribute('data-presentation', 'engine-spine');
    expect(within(projections).queryByTestId('content-work-order-lens')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('keyword-targets-lens')).toHaveLength(1);
    expect(within(projections).getAllByRole('radiogroup')).toHaveLength(1);

    fireEvent.click(within(projections).getByRole('radio', { name: 'Content work orders' }));

    expect(await within(projections).findByTestId('content-work-order-lens')).toHaveAttribute('data-included-rec-ids', 'rec-1');
    expect(within(projections).getByTestId('content-work-order-lens')).toHaveAttribute('data-presentation', 'engine-spine');
    expect(within(projections).queryByTestId('keyword-targets-lens')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('content-work-order-lens')).toHaveLength(1);
  });

  it('projects only the sendable subset even if stale local staging contains another move', async () => {
    mocks.engineState = makeEngineState({
      stagedRecIds: new Set(['rec-1']),
      stagedSendableIds: [],
      stagedSendableSet: new Set(),
      sendableSet: new Set(),
      stagedCount: 0,
    });

    renderSurface();

    const projections = await screen.findByTestId('engine-section-projections');
    expect(within(projections).getByTestId('keyword-targets-lens')).toHaveAttribute('data-included-rec-ids', '');
  });

  it('keeps the client-update action exact-once and explains the disabled empty state', async () => {
    const first = renderSurface();

    expect(await screen.findByTestId('engine-rebuilt-surface')).toBeInTheDocument();
    const restingFallback = screen.getByTestId('engine-topbar-actions-fallback');
    const restingSend = within(restingFallback).getByRole('button', { name: 'Send client update (0)' });
    expect(restingSend).toBeDisabled();
    expect(restingSend).toHaveAccessibleDescription('No moves added — add moves below before sending');
    expect(within(restingFallback).getByText('No moves added — add moves below before sending')).toBeVisible();
    expect(screen.getAllByTestId('engine-topbar-send-btn')).toHaveLength(1);
    fireEvent.click(restingSend);
    expect(mocks.sendIssue).not.toHaveBeenCalled();
    expect(screen.queryByTestId('engine-backing-send-bar')).not.toBeInTheDocument();

    first.unmount();
    mocks.engineState = makeEngineState({
      stagedRecIds: new Set(['rec-1', 'rec-2']),
      stagedSendableIds: ['rec-1', 'rec-2'],
      stagedCount: 2,
    });
    renderSurface();

    await screen.findByTestId('engine-section-backing-moves');
    const fallback = screen.getByTestId('engine-topbar-actions-fallback');
    expect(screen.queryByTestId('engine-backing-send-bar')).not.toBeInTheDocument();
    const stagedSend = within(fallback).getByRole('button', { name: 'Send client update (2)' });
    expect(stagedSend).toBeEnabled();
    expect(screen.getAllByTestId('engine-topbar-send-btn')).toHaveLength(1);
    fireEvent.click(stagedSend);
    expect(mocks.sendIssue).toHaveBeenCalledTimes(1);
    expect(mocks.sendIssue).toHaveBeenCalledWith(expect.objectContaining({ type: 'click' }));
  });

  it('opens the Local SEO setup drawer exactly once from operational disclosures', async () => {
    renderSurface('/ws/ws-engine/seo-strategy?lens=operations');

    fireEvent.click(await screen.findByRole('button', { name: 'Open market setup' }));

    expect(await screen.findByTestId('local-seo-setup-drawer')).toBeInTheDocument();
    expect(screen.getAllByTestId('local-seo-setup-drawer')).toHaveLength(1);
    expect(screen.getAllByRole('dialog', { name: 'Local SEO setup' })).toHaveLength(1);
  });

  it.each([
    ['/ws/ws-engine/seo-strategy?tab=overview', '/ws/ws-engine/seo-strategy?lens=spine'],
    ['/ws/ws-engine/seo-strategy?tab=content', '/ws/ws-engine/content-pipeline?tab=content-health'],
    ['/ws/ws-engine/seo-strategy?tab=rankings', '/ws/ws-engine/seo-keywords?lens=rankings'],
    ['/ws/ws-engine/seo-strategy?tab=competitive', '/ws/ws-engine/competitors'],
  ])('maps dissolved legacy tab %s to %s', async (entry, target) => {
    renderSurface(entry);

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(target));
  });
});
