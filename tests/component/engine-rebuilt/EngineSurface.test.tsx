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

vi.mock('../../../src/components/strategy', () => ({
  StrategyHeaderActions: () => <div data-testid="strategy-header-actions">Header actions</div>,
  StrategyStalenessNudges: () => <div data-testid="strategy-staleness-nudges">Staleness nudges</div>,
  StrategyEmptyState: () => <div data-testid="strategy-empty-state">Generate strategy</div>,
}));

vi.mock('../../../src/components/strategy/StrategyDiff', () => ({
  StrategyDiff: ({ defaultExpanded }: { defaultExpanded?: boolean }) => (
    <div data-testid="strategy-diff" data-default-expanded={defaultExpanded}>What changed</div>
  ),
}));

vi.mock('../../../src/components/strategy/IntelligenceSignals', () => ({
  IntelligenceSignals: ({
    title,
    subtitle,
    initialLimit,
  }: {
    title?: string;
    subtitle?: string;
    initialLimit?: number;
  }) => (
    <div
      data-testid="intelligence-signals"
      data-title={title}
      data-subtitle={subtitle}
      data-initial-limit={initialLimit}
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
  DraftedPovEditor: ({ title, subtitle }: { title?: string; subtitle?: string }) => (
    <div data-testid="drafted-pov-editor" data-title={title} data-subtitle={subtitle}>POV editor</div>
  ),
}));

vi.mock('../../../src/components/strategy/issue/BackingMovesQueue', () => ({
  BackingMovesQueue: ({
    onAddRec,
    onOpenDetails,
    subtitle,
    shortlistCap,
  }: {
    onAddRec: () => void;
    onOpenDetails: (recId: string) => void;
    subtitle?: string;
    shortlistCap?: number;
  }) => (
    <div data-testid="backing-moves-queue" data-subtitle={subtitle} data-shortlist-cap={shortlistCap}>
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
  CurationMeter: () => <div data-testid="curation-meter">Curation meter</div>,
}));

vi.mock('../../../src/components/strategy/NeedsAttentionStrip', () => ({
  NeedsAttentionStrip: () => <div data-testid="needs-attention-strip">Needs attention</div>,
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
  ContentWorkOrderLens: ({ includedRecIds }: { includedRecIds?: ReadonlySet<string> }) => (
    <div data-testid="content-work-order-lens" data-included-rec-ids={[...(includedRecIds ?? [])].join(',')}>
      Content work-orders
    </div>
  ),
}));

vi.mock('../../../src/components/strategy/issue/KeywordTargetsLens', () => ({
  KeywordTargetsLens: ({ includedRecIds }: { includedRecIds?: ReadonlySet<string> }) => (
    <div data-testid="keyword-targets-lens" data-included-rec-ids={[...(includedRecIds ?? [])].join(',')}>
      Keyword targets
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
      edit: vi.fn(),
      editPending: false,
      generate: vi.fn(),
      regenerate: vi.fn(),
      isGenerating: false,
      generateError: null,
      wasUnchanged: false,
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
    renderSurface();

    const surface = await screen.findByTestId('engine-rebuilt-surface');
    expect(surface.parentElement).toHaveStyle({ maxWidth: 'var(--page-max)' });
    const identity = screen.getByRole('heading', { name: 'Insights Engine · Acme Dental' });
    const orientation = await screen.findByTestId('engine-section-orientation');
    const changed = screen.getByTestId('strategy-diff');
    const verdict = within(orientation).getByRole('heading', { name: 'Refresh implant content before the next issue goes out.' });
    expect(identity.compareDocumentPosition(changed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(changed.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(orientation).queryByText('Insights Engine · Acme Dental')).not.toBeInTheDocument();

    const valueFrame = screen.getByTestId('engine-section-value-frame');
    expect(within(valueFrame).getByText('$18,450')).toHaveClass('t-stat-lg');

    const pov = screen.getByTestId('drafted-pov-editor');
    expect(pov).toHaveAttribute('data-title', 'The point of view we send Acme Dental');
    expect(pov).toHaveAttribute('data-subtitle', 'The plain-language read the client opens with');

    const signals = screen.getByTestId('intelligence-signals');
    expect(signals).toHaveAttribute('data-title', 'Signals the Engine is watching');
    expect(signals).toHaveAttribute('data-initial-limit', '4');

    const backingMoves = screen.getByTestId('backing-moves-queue');
    expect(backingMoves).toHaveAttribute('data-subtitle', 'The recommendations staged to back this point of view');
    expect(backingMoves).toHaveAttribute('data-shortlist-cap', '1');
    expect(screen.queryByRole('toolbar', { name: 'Engine refresh controls' })).not.toBeInTheDocument();
    expect(within(screen.getByTestId('engine-header-actions')).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
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

  it('keeps the Engine header actions stackable on narrow screens', async () => {
    renderSurface();

    const actionGroup = await screen.findByTestId('engine-header-actions');
    expect(actionGroup).toHaveClass('w-full');
    expect(actionGroup).toHaveClass('max-w-full');
    expect(actionGroup).toHaveClass('flex-col');
    expect(actionGroup).toHaveClass('items-stretch');
    expect(actionGroup).toHaveClass('sm:items-end');
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
    expect(portalFrame).toHaveClass('dashboard-light');
    expect(proofRow).toHaveClass('sm:grid-cols-3');
    expect(within(preview).getByText('What Acme Dental sees - the trust spine')).toBeInTheDocument();
    expect(within(preview).getByText('Verdict first, dollar value, then proof')).toBeInTheDocument();
    expectScopedTextWithClass(preview, 'Where you stand this quarter', 't-label');
    expectScopedTextWithClass(preview, 'Refresh implant content before the next issue goes out.', 't-page');
    expectScopedTextWithClass(preview, 'Search demand is moving toward implant pages.', 't-body');
    expectScopedTextWithClass(preview, 'Pipeline value at stake', 't-caption');
    expectScopedTextWithClass(preview, '$18,450', 't-stat');
    expectScopedTextWithClass(preview, 'Recovered so far', 't-caption');
    expectScopedTextWithClass(preview, '$2,760', 't-stat');
    expectScopedTextWithClass(preview, 'Backing moves live', 't-caption');
    expectScopedTextWithClass(preview, '0 / 1', 't-stat');
    expectScopedTextWithClass(preview, /The client sees the verdict, value frame, and proof/, 't-body');
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
    expect(within(projections).getByRole('radio', { name: 'Keyword targets' })).toHaveAttribute('aria-checked', 'true');
    expect(within(projections).getByTestId('keyword-targets-lens')).toHaveAttribute('data-included-rec-ids', 'rec-1');
    expect(within(projections).queryByTestId('content-work-order-lens')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('keyword-targets-lens')).toHaveLength(1);
    expect(within(projections).getAllByRole('radiogroup')).toHaveLength(1);

    fireEvent.click(within(projections).getByRole('radio', { name: 'Content work orders' }));

    expect(await within(projections).findByTestId('content-work-order-lens')).toHaveAttribute('data-included-rec-ids', 'rec-1');
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

  it('keeps the one primary send action attached to the staged backing-moves queue', async () => {
    const first = renderSurface();

    expect(await screen.findByTestId('engine-rebuilt-surface')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send issue' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('engine-backing-send-bar')).not.toBeInTheDocument();

    first.unmount();
    mocks.engineState = makeEngineState({
      stagedRecIds: new Set(['rec-1']),
      stagedSendableIds: ['rec-1'],
      stagedCount: 1,
    });
    renderSurface();

    const backingMoves = await screen.findByTestId('engine-section-backing-moves');
    expect(within(backingMoves).getByTestId('engine-backing-send-bar')).toBeInTheDocument();
    expect(within(backingMoves).getByRole('button', { name: 'Send 1 staged' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: /Send(?: 1 staged| issue)/ })).toHaveLength(1);
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
