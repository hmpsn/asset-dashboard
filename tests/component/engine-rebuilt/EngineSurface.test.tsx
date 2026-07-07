import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  StrategyCockpit: () => <div data-testid="strategy-cockpit">Curation cockpit</div>,
}));

vi.mock('../../../src/components/strategy/StrategyDiff', () => ({
  StrategyDiff: () => <div data-testid="strategy-diff">What changed</div>,
}));

vi.mock('../../../src/components/strategy/IntelligenceSignals', () => ({
  IntelligenceSignals: () => <div data-testid="intelligence-signals">Signals</div>,
}));

vi.mock('../../../src/components/strategy/LostQueryRecoveryCard', () => ({
  LostQueryRecoveryCard: () => <div data-testid="lost-query-recovery">Lost query recovery</div>,
}));

vi.mock('../../../src/components/strategy/issue/StanceBar', () => ({
  StanceBar: () => <div data-testid="stance-bar">Stance</div>,
}));

vi.mock('../../../src/components/strategy/issue/DraftedPovEditor', () => ({
  DraftedPovEditor: () => <div data-testid="drafted-pov-editor">POV editor</div>,
}));

vi.mock('../../../src/components/strategy/issue/BackingMovesQueue', () => ({
  BackingMovesQueue: () => <div data-testid="backing-moves-queue">Backing moves</div>,
}));

vi.mock('../../../src/components/strategy/issue/AddRecommendationModal', () => ({
  AddRecommendationModal: ({ open }: { open: boolean }) => open ? <div role="dialog">Add recommendation</div> : null,
}));

vi.mock('../../../src/components/strategy/CurationMeter', () => ({
  CurationMeter: () => <div data-testid="curation-meter">Curation meter</div>,
}));

vi.mock('../../../src/components/strategy/NeedsAttentionStrip', () => ({
  NeedsAttentionStrip: () => <div data-testid="needs-attention-strip">Needs attention</div>,
}));

vi.mock('../../../src/components/strategy/StrategyConfigPanel', () => ({
  StrategyConfigPanel: () => <div data-testid="strategy-config-panel">Strategy config</div>,
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

vi.mock('../../../src/components/strategy/issue/ContentWorkOrderLens', () => ({
  ContentWorkOrderLens: () => <div data-testid="content-work-order-lens">Content work-orders</div>,
}));

vi.mock('../../../src/components/strategy/issue/KeywordTargetsLens', () => ({
  KeywordTargetsLens: () => <div data-testid="keyword-targets-lens">Keyword targets</div>,
}));

vi.mock('../../../src/components/engine-rebuilt/EngineMoveDrawer', () => ({
  EngineMoveDrawer: ({ open }: { open: boolean }) => open ? <div role="dialog">Move drawer</div> : null,
}));

vi.mock('../../../src/components/local-seo/LocalSeoMarketSetupDrawer', () => ({
  LocalSeoMarketSetupDrawer: ({ open }: { open: boolean }) => open ? <div role="dialog">Local SEO setup</div> : null,
}));

const workspaceId = 'ws-engine';

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
    metrics: { hasVolumeValidation: true },
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
  const result = render(
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
    </QueryClientProvider>,
  );
  return { ...result, client };
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

describe('EngineSurface rebuilt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlagsList.mockResolvedValue({ 'ui-rebuild-shell': true });
    mocks.engineState = makeEngineState();
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
    expect(screen.getByRole('heading', { name: 'Insights Engine' })).toBeInTheDocument();
  });

  it('meets the rebuilt a11y floor after loading states settle', async () => {
    const { container } = renderSurface();

    expect(await screen.findByTestId('engine-rebuilt-surface')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll('.animate-pulse').length).toBe(0));
    await expectNoA11yViolations(container);
  });

  it.each([
    ['/ws/ws-engine/seo-strategy?lens=spine', 'engine-lens-spine'],
    ['/ws/ws-engine/seo-strategy?lens=changes', 'engine-lens-changes'],
    ['/ws/ws-engine/seo-strategy?lens=signals', 'engine-lens-signals'],
    ['/ws/ws-engine/seo-strategy?lens=pov', 'engine-lens-pov'],
    ['/ws/ws-engine/seo-strategy?lens=moves', 'engine-lens-moves'],
    ['/ws/ws-engine/seo-strategy?lens=operations', 'engine-lens-operations'],
  ])('renders receiver lens for %s', async (entry, testId) => {
    renderSurface(entry);

    expect(await screen.findByTestId(testId)).toBeInTheDocument();
  });

  it('falls back to spine for an invalid lens value', async () => {
    renderSurface('/ws/ws-engine/seo-strategy?lens=unknown');

    expect(await screen.findByTestId('engine-invalid-lens-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('engine-lens-spine')).toBeInTheDocument();
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
