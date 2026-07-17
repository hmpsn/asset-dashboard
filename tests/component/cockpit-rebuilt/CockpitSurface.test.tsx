// @ds-rebuilt
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CockpitSurface } from '../../../src/components/cockpit-rebuilt/CockpitSurface';
import { ToastProvider } from '../../../src/components/Toast';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { expectNoA11yViolations } from '../a11y';
import type { UseCockpitRebuiltResult } from '../../../src/hooks/admin/useCockpitRebuilt';
import type { WorkQueueClassification, WorkQueueItem, WorkQueueSourceType } from '../../../shared/types/work-queue';

const mocks = vi.hoisted(() => ({
  featureFlagsList: vi.fn(),
  cockpitState: null as UseCockpitRebuiltResult | null,
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

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

vi.mock('../../../src/hooks/admin/useCockpitRebuilt', () => {
  const emptyQueue: WorkQueueClassification = {
    streams: { opt: 0, send: 0, money: 0, unclassified: 0 },
    items: [],
  };
  return {
    useCockpitRebuilt: () => {
      if (!mocks.cockpitState) throw new Error('Cockpit test state was not initialized');
      return mocks.cockpitState;
    },
    workQueueWithVisibleItems: (queue: WorkQueueClassification | null, suppressSetup: boolean): WorkQueueClassification => {
      const source = queue ?? emptyQueue;
      const items = suppressSetup ? source.items.filter((item) => item.sourceType !== 'setup_gap') : source.items;
      return {
        streams: {
          opt: items.filter((item) => item.stream === 'opt').length,
          send: items.filter((item) => item.stream === 'send').length,
          money: items.filter((item) => item.stream === 'money').length,
          unclassified: items.filter((item) => item.stream === 'unclassified').length,
        },
        items,
      };
    },
    countWorkQueueSourceTypes: (items: WorkQueueItem[]): Partial<Record<WorkQueueSourceType, number>> => (
      items.reduce<Partial<Record<WorkQueueSourceType, number>>>((acc, item) => {
        acc[item.sourceType] = (acc[item.sourceType] ?? 0) + 1;
        return acc;
      }, {})
    ),
  };
});

vi.mock('../../../src/components/workspace-home', () => ({
  ActivityFeed: ({ activity }: { activity: Array<{ title: string }> }) => (
    <div data-testid="activity-feed">{activity.map((item) => item.title).join(', ')}</div>
  ),
  SeoChangeImpact: () => <div data-testid="seo-change-impact">Before and after impact</div>,
  WeeklyAccomplishments: () => <div data-testid="weekly-accomplishments">This week landed work</div>,
}));

vi.mock('../../../src/components/admin/WorkOrderPanel', () => ({
  WorkOrderPanel: ({ workspaceId, onDismiss }: { workspaceId: string; onDismiss: () => void }) => (
    <div role="dialog" aria-label="Work orders" data-testid="work-order-panel">
      Work orders for {workspaceId}
      <button type="button" onClick={onDismiss}>Close work orders</button>
    </div>
  ),
}));

const workspaceId = 'ws-cockpit';

const workQueue: WorkQueueClassification = {
  streams: { opt: 2, send: 1, money: 1, unclassified: 1 },
  items: [
    {
      stream: 'send',
      id: 'request-1',
      title: 'Approve July content plan',
      meta: 'Client request · Jul 4',
      impact: 'Send',
      direction: 'neutral',
      sourceType: 'request',
    },
    {
      stream: 'opt',
      id: 'order-1',
      title: 'Close Core Web Vitals cleanup',
      meta: 'Work order · in progress',
      impact: '2 tasks',
      direction: 'negative',
      sourceType: 'work_order',
    },
    {
      stream: 'opt',
      id: 'decay-1',
      title: 'Refresh decaying service page',
      meta: 'Content health · -24% clicks',
      impact: '-24%',
      direction: 'negative',
      sourceType: 'content_decay',
    },
    {
      stream: 'money',
      id: 'money-1',
      title: 'Review measured value frame',
      meta: 'Outcome evidence',
      impact: '$18k',
      direction: 'positive',
      sourceType: 'content_pipeline',
    },
    {
      stream: 'unclassified',
      id: 'churn-1',
      title: 'Client has not viewed the portal',
      meta: 'Churn signal · critical',
      direction: 'negative',
      sourceType: 'churn_signal',
    },
    {
      stream: 'opt',
      id: 'setup-1',
      title: 'Connect GA4',
      meta: 'Setup gap',
      direction: 'neutral',
      sourceType: 'setup_gap',
    },
  ],
};

function makeCockpitState(overrides: Partial<UseCockpitRebuiltResult> = {}): UseCockpitRebuiltResult {
  const homeData = {
    weeklySummary: {
      seoUpdates: 1,
      auditsRun: 1,
      contentGenerated: 1,
      contentPublished: 1,
      requestsResolved: 1,
    },
    workQueue,
    cockpitVerdict: {
      status: 'watch',
      headline: 'Client-facing work is ready to review and send.',
      narrative: 'One send item and optimization work are waiting in the shared work queue.',
      generatedAt: '2026-07-07T12:00:00.000Z',
      evidence: [{ label: 'Work queue', value: 5, tone: 'warning' }],
    },
    moneyFrame: {
      valueAtStake: 18450,
      recoveredSoFar: 2760,
      provenance: 'measured_action',
      precomputedAt: '2026-07-07T12:00:00.000Z',
    },
  };

  return {
    workspace: {
      id: workspaceId,
      name: 'Acme Dental',
      webflowSiteId: 'site-1',
      webflowSiteName: 'Acme Dental',
      gscPropertyUrl: 'https://acme.example',
      ga4PropertyId: 'properties/123',
    } as UseCockpitRebuiltResult['workspace'],
    workspaceQuery: { data: [], isLoading: false, isError: false } as UseCockpitRebuiltResult['workspaceQuery'],
    homeQuery: {
      data: homeData,
      isLoading: false,
      isError: false,
      isFetching: false,
      dataUpdatedAt: new Date('2026-07-07T12:05:00.000Z').getTime(),
      refetch: vi.fn().mockResolvedValue({ error: null }),
    } as unknown as UseCockpitRebuiltResult['homeQuery'],
    auditQuery: { audit: { siteScore: 82, errors: 1, warnings: 3, previousScore: 79 } } as UseCockpitRebuiltResult['auditQuery'],
    roiQuery: { data: { organicTrafficValue: 42000, adSpendEquivalent: 8700 } } as UseCockpitRebuiltResult['roiQuery'],
    intelligenceQuery: { data: { clientSignals: { compositeHealthScore: 84 } } } as UseCockpitRebuiltResult['intelligenceQuery'],
    homeData: homeData as UseCockpitRebuiltResult['homeData'],
    verdict: homeData.cockpitVerdict,
    moneyFrame: homeData.moneyFrame,
    workQueue,
    ranks: [
      { id: 'rank-1', query: 'cosmetic dentist', position: 3, previousPosition: 6, change: 3 },
      { id: 'rank-2', query: 'emergency dentist', position: 9, previousPosition: 7, change: -2 },
    ],
    requests: [
      { id: 'req-1', title: 'Can we review July posts?', status: 'open', category: 'content', createdAt: '2026-07-04T12:00:00.000Z' },
    ],
    activity: [
      { id: 'activity-1', type: 'content_published', title: 'Published July article', createdAt: '2026-07-06T12:00:00.000Z' },
    ],
    kpis: {
      siteHealth: { score: 82, errors: 1, warnings: 3, delta: 3 },
      search: { clicks: 1234, impressions: 18800, ctr: 0.066, avgPosition: 8.4 },
      trafficValue: { organic: 42000, adSpendEquivalent: 8700, valueAtStake: 18450, recoveredSoFar: 2760, provenance: 'measured_action' },
      ga4: { users: 5400, sessions: 7200, newUserPercentage: 62, usersDelta: 12 },
      ranks: { tracked: 2, up: 1, down: 1, flat: 0 },
      contentDecay: { critical: 1, warning: 2, total: 3, avgDeclinePct: -24 },
      contentPipeline: { total: 10, published: 4, review: 2, approved: 2, inProgress: 2, percent: 40 },
      contentVelocity: { monthly: [1, 2, 3, 4], currentMonthPublished: 4, trailingThreeMonthAvg: 3, previousThreeMonthAvg: 2, trendPct: 50 },
      coverageGaps: 3,
      overallHealth: { score: 84, label: 'On track' },
    },
    lastFetched: new Date('2026-07-07T12:05:00.000Z'),
    ...overrides,
  };
}

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderSurface(initialEntry = `/ws/${workspaceId}`, client = createClient()) {
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <CockpitSurface workspaceId={workspaceId} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

function FlaggedCockpitHarness() {
  const enabled = useFeatureFlag('ui-rebuild-shell');
  return enabled ? <CockpitSurface workspaceId={workspaceId} /> : <div data-testid="legacy-home">Legacy home</div>;
}

function renderFlagHarness(client = createClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/ws/${workspaceId}`]}>
        <ToastProvider>
          <FlaggedCockpitHarness />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CockpitSurface rebuilt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem(`onboarding_checklist_dismissed_${workspaceId}`, '1');
    mocks.featureFlagsList.mockResolvedValue({ 'ui-rebuild-shell': true });
    mocks.cockpitState = makeCockpitState();
  });

  it('mounts after the real feature-flag hook transitions from loading fallback to ON', async () => {
    let resolveFlags: (value: { 'ui-rebuild-shell': boolean }) => void = () => {};
    mocks.featureFlagsList.mockReturnValue(new Promise((resolve) => {
      resolveFlags = resolve;
    }));

    renderFlagHarness();

    expect(screen.getByTestId('legacy-home')).toBeInTheDocument();

    await act(async () => {
      resolveFlags({ 'ui-rebuild-shell': true });
    });

    expect(await screen.findByTestId('cockpit-rebuilt-surface')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Client-facing work is ready to review and send.' })).toBeInTheDocument();
  });

  it('meets the rebuilt a11y floor after animate-pulse settles', async () => {
    const { container } = renderSurface();

    expect(await screen.findByTestId('cockpit-rebuilt-surface')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll('.animate-pulse').length).toBe(0));
    await expectNoA11yViolations(container);
  });

  it('falls back retired and invalid tab receivers without crashing', async () => {
    renderSurface(`/ws/${workspaceId}?tab=meeting-brief`);
    expect(await screen.findByTestId('cockpit-retired-tab-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('cockpit-rebuilt-surface')).toBeInTheDocument();

    renderSurface(`/ws/${workspaceId}?tab=unknown`);
    expect(await screen.findByTestId('cockpit-invalid-tab-fallback')).toBeInTheDocument();
  });

  it('reads stream query state and filters to the selected shared work stream', async () => {
    renderSurface(`/ws/${workspaceId}?stream=send`);

    expect(await screen.findByText('Approve July content plan')).toBeInTheDocument();
    expect(screen.queryByText('Close Core Web Vitals cleanup')).not.toBeInTheDocument();
  });

  it('keeps the Risk deep link truthful without selecting Optimizations', async () => {
    renderSurface(`/ws/${workspaceId}?stream=unclassified`);

    expect(await screen.findByText('Client has not viewed the portal')).toBeInTheDocument();
    expect(screen.queryByText('Close Core Web Vitals cleanup')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Queue filters')).getByRole('button', { name: /^Risk/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByLabelText('Queue filters')).getByRole('button', { name: /Client risk/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('radio', { name: /Optimizations/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /To send/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /Monetization/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps internal rebuild and migration language out of the visible Cockpit UI', async () => {
    const { container } = renderSurface();

    expect(await screen.findByTestId('cockpit-rebuilt-surface')).toBeInTheDocument();

    const visibleText = container.textContent ?? '';
    expect(visibleText).not.toMatch(/rebuild/i);
    expect(visibleText).not.toMatch(/migration/i);
    expect(visibleText).not.toMatch(/carry-over/i);
    expect(visibleText).not.toMatch(/route tab/i);
    expect(visibleText).not.toMatch(/url state/i);
    expect(visibleText).not.toMatch(/legacy aliases/i);
    expect(visibleText).not.toMatch(/mounted below/i);
  });

  it('keeps Cockpit calibration copy on styleguide typography roles', async () => {
    renderSurface();

    expect(await screen.findByText('Client-facing work is ready to review and send.')).toHaveClass('t-h2');
    expect(screen.getByText('One send item and optimization work are waiting in the shared work queue.')).toHaveClass('t-body');
    expect(screen.getByText('1 error in site audit')).toHaveClass('t-ui');
    expect(screen.getByText('3 warnings · score 82')).toHaveClass('t-caption-sm');
    expect(screen.getByText('#3')).toHaveClass('t-body');
  });

  it('places one unique-decision band between the verdict and work streams', async () => {
    renderSurface();

    const verdict = await screen.findByRole('heading', { name: 'Client-facing work is ready to review and send.' });
    const band = screen.getByRole('region', { name: 'Cockpit decision metrics' });
    const firstStream = screen.getByRole('radio', { name: /Optimizations/ });

    expect(verdict.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(band.compareDocumentPosition(firstStream) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(band).getByText('Organic value')).toBeInTheDocument();
    expect(within(band).getByText('$42,000')).toBeInTheDocument();
    expect(within(band).getByText('Content velocity')).toBeInTheDocument();
    expect(within(band).getByText('3/mo')).toBeInTheDocument();
    expect(within(band).getByText('4 this month · +50% trend')).toBeInTheDocument();
    expect(within(band).getByText('Overall health')).toBeInTheDocument();
    expect(within(band).getByText('84')).toBeInTheDocument();
    expect(within(band).getByText('On track')).toBeInTheDocument();
    expect(band.querySelectorAll('.t-label')).toHaveLength(3);
    expect(within(band).queryByText(/clicks|impressions|users|sessions/i)).not.toBeInTheDocument();
  });

  it('keeps unavailable decision metrics honest instead of fabricating zeroes', async () => {
    const state = makeCockpitState();
    mocks.cockpitState = {
      ...state,
      kpis: {
        ...state.kpis,
        trafficValue: { ...state.kpis.trafficValue, organic: null },
        contentVelocity: {
          ...state.kpis.contentVelocity,
          currentMonthPublished: null,
          trailingThreeMonthAvg: null,
        },
        overallHealth: { score: null, label: 'Establishing' },
      },
    };

    renderSurface();

    const band = await screen.findByRole('region', { name: 'Cockpit decision metrics' });
    expect(within(band).getAllByText('—')).toHaveLength(3);
    expect(within(band).getByText('Unavailable')).toBeInTheDocument();
    expect(within(band).getAllByText('Establishing')).toHaveLength(2);
    expect(within(band).queryByText('0')).not.toBeInTheDocument();
  });

  it('uses the compact prototype frame and keeps operator controls reachable through the topbar host', async () => {
    renderSurface();

    const surface = await screen.findByTestId('cockpit-rebuilt-surface');
    const pageFrame = surface.parentElement;
    const contextLine = screen.getByTestId('cockpit-context-line');

    expect(pageFrame).toHaveStyle({ maxWidth: '1168px', padding: '0px' });
    expect(contextLine).toHaveTextContent('Client cockpit · Acme Dental');
    expect(contextLine).toHaveTextContent('Today, scoped to one');
    expect(within(contextLine).queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('cockpit-topbar-actions-fallback')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Activity/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh Cockpit data/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Settings/i })).toBeInTheDocument();
  });

  it('keeps source filters functional when they are composed inside the work-queue card', async () => {
    renderSurface();

    const queue = await screen.findByTestId('cockpit-work-queue');
    const filters = within(queue).getByLabelText('Queue filters');
    fireEvent.click(within(filters).getByRole('button', { name: /^Decay/ }));

    expect(screen.getByText('Refresh decaying service page')).toBeInTheDocument();
    expect(screen.queryByText('Close Core Web Vitals cleanup')).not.toBeInTheDocument();
    expect(within(filters).getByRole('button', { name: /^Decay/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('labels navigating queue actions as Review or Open while preserving their routes', async () => {
    renderSurface();

    const queue = await screen.findByTestId('cockpit-work-queue');
    const actionFor = (title: string) => {
      const titleNode = within(queue).getByText(title);
      const row = titleNode.parentElement?.parentElement;
      expect(row).not.toBeNull();
      return within(row as HTMLElement).getByRole('button');
    };

    const sendAction = actionFor('Approve July content plan');
    const optimizationAction = actionFor('Refresh decaying service page');
    const moneyAction = actionFor('Review measured value frame');
    const riskAction = actionFor('Client has not viewed the portal');

    fireEvent.click(sendAction);
    expect(mocks.navigate).toHaveBeenLastCalledWith(`/ws/${workspaceId}/requests?tab=requests`);
    fireEvent.click(optimizationAction);
    expect(mocks.navigate).toHaveBeenLastCalledWith(`/ws/${workspaceId}/content-pipeline?tab=content-health`);
    fireEvent.click(moneyAction);
    expect(mocks.navigate).toHaveBeenLastCalledWith(`/ws/${workspaceId}/content-pipeline?tab=briefs`);
    fireEvent.click(riskAction);
    expect(mocks.navigate).toHaveBeenLastCalledWith(`/ws/${workspaceId}/requests?tab=requests`);

    expect(within(queue).queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(within(queue).queryByRole('button', { name: 'Propose' })).not.toBeInTheDocument();
    expect(sendAction).toHaveAccessibleName('Review');
    expect(optimizationAction).toHaveAccessibleName('Open');
    expect(moneyAction).toHaveAccessibleName('Open');
    expect(riskAction).toHaveAccessibleName('Open');
  });

  it('keeps weekly accomplishments as supporting evidence after the core queue and rail', async () => {
    renderSurface();

    const coreGrid = await screen.findByTestId('cockpit-core-grid');
    const weekly = screen.getByTestId('weekly-accomplishments');

    expect(coreGrid.compareDocumentPosition(weekly) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the carried-over work-order panel from a work-order queue row', async () => {
    renderSurface();

    fireEvent.click(await screen.findByRole('button', { name: /Open panel/i }));

    expect(await screen.findByTestId('work-order-panel')).toHaveTextContent(`Work orders for ${workspaceId}`);
    expect(screen.getAllByTestId('work-order-panel')).toHaveLength(1);
    expect(screen.getAllByRole('dialog', { name: /Work orders/i })).toHaveLength(1);
  });

  it('opens the activity drawer from the toolbar', async () => {
    renderSurface();

    fireEvent.click(await screen.findByRole('button', { name: /Activity/i }));

    expect(await screen.findByRole('dialog', { name: /Recent activity/i })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog', { name: /Recent activity/i })).toHaveLength(1);
    expect(screen.getByTestId('activity-feed')).toHaveTextContent('Published July article');
  });
});
