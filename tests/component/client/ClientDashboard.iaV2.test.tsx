/**
 * Rule-13 flag-ON real-render guard for Client IA v2 (P2 nav shell).
 *
 * The three IA-v2 wrapper tabs — DeepDiveTab, ResultsTab, SettingsTab — are mounted by
 * ClientDashboard through `lazyWithRetry(() => import(...))` and MUST each be rendered inside a
 * `<LazyClientTabPanel>` (a React `<Suspense>` boundary). The lazy-without-Suspense crash class was
 * already found+fixed once in the `results` panel; this test is the automated guard so it can't
 * regress unseen. No sibling test covers it: ClientDashboard.test.tsx mocks all three wrappers OUT
 * (so the real lazy-import + Suspense path never runs), and OverviewTab.flagTransition only covers
 * OverviewTab.
 *
 * Why a naive `waitFor(() => getByTestId(...))` would be VACUOUS here:
 *   Under React 19 + jsdom, `render()` does NOT throw when a lazy component suspends without a
 *   Suspense boundary — it silently retries and resolves once the import lands, so `waitFor` always
 *   finds the content whether or not the panel is wrapped. (Confirmed empirically; this is a React
 *   18 → 19 behavior change — React 18 threw "...no fallback UI was specified.")
 *
 * How this test stays NON-VACUOUS:
 *   `lazyWithRetry` is mocked so the import for each NEW wrapper (Results/DeepDive/Settings) is held
 *   behind a deferred promise this test controls. While the import is PENDING we assert two things:
 *     (a) the panel-local Suspense fallback (ClientTabFallback → OverviewSkeleton's `animate-pulse`)
 *         is visible inside <main>, AND
 *     (b) the surrounding dashboard chrome (ClientHeader) is still mounted.
 *   If a panel's `<LazyClientTabPanel>` wrapper is removed, the suspension escapes past the (absent)
 *   panel boundary and suspends a higher slice of the tree — the header disappears / the page blanks
 *   — so step (b) (and the prerequisite `waitFor(client-header)`) fails. Then we release the deferred
 *   and assert the real panel content mounts. (Verified: deleting the `results` wrapper makes this
 *   suite fail; restoring it makes it pass.)
 *
 * Strategy otherwise mirrors ClientDashboard.test.tsx (same API/hook/heavy-child mocks) with the
 * three critical differences spelled out inline below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { FeatureFlagKey } from '../../../shared/types/feature-flags';

// ── Controllable deferred imports for the three NEW lazy wrappers ─────────────
// Keyed by the wrapper name found in the lazyWithRetry factory's source. Each starts pending so the
// panel suspends on first render; the test releases it to let the real wrapper mount.
type Deferred = { promise: Promise<unknown>; resolve: () => void };
function makeDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = () => r(); });
  return { promise, resolve };
}
const deferredImports: Record<string, Deferred> = {};
function resetDeferredImports() {
  for (const k of Object.keys(deferredImports)) delete deferredImports[k];
}

// ── Mock API client (must happen before imports that use them) ──────────────
vi.mock('../../../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/api/client')>();
  return {
    ...actual,
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
    getOptional: vi.fn(),
    getSafe: vi.fn(),
  };
});

vi.mock('../../../src/api/analytics', () => ({
  gsc: { overview: vi.fn(), trend: vi.fn(), comparison: vi.fn(), devices: vi.fn() },
}));

// ── Mock react-router-dom (preserve actual, override navigate) ────────────────
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// ── Mock hooks ────────────────────────────────────────────────────────────────
vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({ useWorkspaceEvents: vi.fn() }));

vi.mock('../../../src/hooks/useToast', () => ({
  useToast: vi.fn(() => ({ toast: null, setToast: vi.fn(), clearToast: vi.fn() })),
}));

// CRITICAL DIFFERENCE #1: flag-aware mock — 'client-ia-v2' is ON so the dashboard builds the
// 4-tab IA-v2 nav and the OverviewTab IA-v2 branch. Every other flag returns false (its OFF base).
vi.mock('../../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn((flag: FeatureFlagKey) => flag === 'client-ia-v2'),
}));

vi.mock('../../../src/hooks/useRecommendations', () => ({
  useRecommendations: vi.fn(() => ({ recs: [], loaded: false })),
  useRecommendationSet: vi.fn(() => ({ data: undefined })),
}));

vi.mock('../../../src/hooks/usePayments', () => ({
  usePayments: vi.fn(() => ({
    pricingModal: null, setPricingModal: vi.fn(),
    pricingConfirming: false, setPricingConfirming: vi.fn(),
    pricingData: null, setPricingData: vi.fn(),
    stripePayment: null, setStripePayment: vi.fn(),
    confirmPricingAndSubmit: vi.fn(),
  })),
}));

vi.mock('../../../src/hooks/client/useClientQueries', () => ({
  useClientActivity: () => ({ data: [], isLoading: false, error: null }),
  useClientRankHistory: () => ({ data: [], isLoading: false, error: null }),
  useClientLatestRanks: () => ({ data: [], isLoading: false, error: null }),
  useClientAnnotations: () => ({ data: [], isLoading: false, error: null }),
  useClientAnomalies: () => ({ data: [], isLoading: false, error: null }),
  useClientApprovals: () => ({ data: [], isLoading: false, error: null }),
  useClientActions: () => ({ data: [], isLoading: false, error: null }),
  useClientRequests: () => ({ data: [], isLoading: false, error: null }),
  useClientContentRequests: () => ({ data: [], isLoading: false, error: null }),
  useClientAuditSummary: () => ({ data: null, isLoading: false, error: null }),
  useClientAuditDetail: () => ({ data: null, isLoading: false, error: null }),
  // strategyData must be non-null so the IA-v2 nav surfaces the "Results" tab
  // (isPaid && !betaMode && strategyData). The panel renders regardless of the nav, but a
  // realistic flag-ON render is the whole point of this test.
  useClientStrategy: () => ({ data: { pages: [] }, isLoading: false, error: null }),
  useClientPricing: () => ({ data: null, isLoading: false, error: null }),
  // vi.fn (not a plain arrow) so individual tests can drive the contentPlanSummary gate
  // (clientIaV2 && contentPlanSummary.totalCells > 0) that re-homes ContentPlanTab under DeepDive's
  // Rankings sub-tab. Default mirrors the original "no plan" base (data: null → summary null).
  useClientContentPlan: vi.fn(() => ({ data: null, isLoading: false, error: null })),
  useClientCopyEntries: () => ({ data: 0, isLoading: false, error: null }),
}));

vi.mock('../../../src/hooks/client/useClientSearch', () => ({
  useClientSearch: vi.fn(() => ({ overview: null, trend: [], comparison: null, devices: [], sectionError: null })),
}));

vi.mock('../../../src/hooks/client/useClientGA4', () => ({
  useClientGA4: vi.fn(() => ({
    ga4Overview: null, ga4Trend: [], ga4Pages: [], ga4Sources: [], ga4Devices: [],
    ga4Countries: [], ga4Events: [], ga4Conversions: [], ga4Comparison: null,
    ga4NewVsReturning: [], ga4Organic: null, ga4LandingPages: [], sectionError: null, hasGA4: false,
  })),
}));

// ── Mock heavy child components / providers (same set as ClientDashboard.test.tsx) ───────────
vi.mock('../../../src/components/client/ClientAuthGate', () => ({
  ClientAuthGate: () => <div data-testid="client-auth-gate">Auth Gate</div>,
}));
vi.mock('../../../src/components/client/EmailCaptureGate', () => ({
  EmailCaptureGate: () => <div data-testid="email-capture-gate">Email Gate</div>,
}));
vi.mock('../../../src/components/client/ClientChatWidget', () => ({
  ClientChatWidget: () => <div data-testid="client-chat-widget" />,
}));
vi.mock('../../../src/components/client/ClientHeader', () => ({
  ClientHeader: ({ ws }: { ws: { name: string } }) => <header data-testid="client-header">{ws?.name}</header>,
}));
vi.mock('../../../src/components/client/UpgradeModal', () => ({ UpgradeModal: () => <div data-testid="upgrade-modal" /> }));
vi.mock('../../../src/components/client/PricingConfirmationModal', () => ({ PricingConfirmationModal: () => <div data-testid="pricing-modal" /> }));
vi.mock('../../../src/components/client/ClientOnboardingQuestionnaire', () => ({ ClientOnboardingQuestionnaire: () => <div data-testid="onboarding-questionnaire" /> }));
vi.mock('../../../src/components/client/OnboardingWizard', () => ({ OnboardingWizard: () => <div data-testid="onboarding-wizard" /> }));
vi.mock('../../../src/components/client/SeoCart', () => ({ SeoCartDrawer: () => <div data-testid="seo-cart-drawer" /> }));
vi.mock('../../../src/components/client/SeoEducationTip', () => ({ SeoEducationTip: () => null }));

// ScannerReveal uses ResizeObserver (not in jsdom) — pass children through.
vi.mock('../../../src/components/ui/ScannerReveal.tsx', () => ({
  ScannerReveal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../src/components/client/BetaContext', () => ({
  BetaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../src/components/client/useCart', () => ({
  CartProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock the OverviewTab (default tab) — not under test here, keep it light.
vi.mock('../../../src/components/client/OverviewTab', () => ({
  OverviewTab: () => <div data-testid="overview-tab">Overview</div>,
}));

// CRITICAL DIFFERENCE #3: the heavy FOLDED children are stubbed (lightweight + testid'd) so the
// real wrapper tabs have something cheap to mount into their slots once the wrapper resolves.
vi.mock('../../../src/components/client/PerformanceTab', () => ({
  PerformanceTab: () => <div data-testid="performance-tab">Performance</div>,
}));
vi.mock('../../../src/components/client/HealthTab', () => ({
  HealthTab: () => <div data-testid="health-tab">Health</div>,
}));
vi.mock('../../../src/components/client/StrategyTab', () => ({
  StrategyTab: () => <div data-testid="strategy-tab">Strategy</div>,
}));
vi.mock('../../../src/components/client/ROIDashboard', () => ({
  ROIDashboard: () => <div data-testid="roi-tab">ROI</div>,
}));
vi.mock('../../../src/components/client/BrandTab', () => ({
  BrandTab: () => <div data-testid="brand-tab">Brand</div>,
}));
vi.mock('../../../src/components/client/PlansTab', () => ({
  PlansTab: () => <div data-testid="plans-tab">Plans</div>,
}));
vi.mock('../../../src/components/client/InsightsEngine', () => ({
  InsightsEngine: () => <div data-testid="insights-engine">Insights Engine</div>,
}));
vi.mock('../../../src/components/client/InboxTab', () => ({
  InboxTab: () => <div data-testid="inbox-tab">Inbox</div>,
}));
vi.mock('../../../src/components/client/ContentPlanTab', () => ({
  ContentPlanTab: () => <div data-testid="content-plan-tab">Content Plan</div>,
}));

// NOTE: DeepDiveTab, ResultsTab, SettingsTab are deliberately NOT mocked (CRITICAL DIFFERENCE #2) —
// they import for real through React.lazy below so the genuine Suspense boundary is exercised.

// ── Mock lazyWithRetry → real React.lazy, but gate the THREE new wrappers behind a deferred ──
// Every other lazy panel resolves immediately (its module is vi.mock'd). For Results/DeepDive/
// Settings the import is held until the test releases the matching deferred, so the panel stays
// suspended long enough to assert the panel-local Suspense fallback is the thing rendering.
vi.mock('../../../src/lib/lazyWithRetry', () => ({
  lazyWithRetry: (fn: () => Promise<{ default: React.ComponentType<unknown> }>) => {
    const { lazy } = require('react');
    return lazy(() => {
      const src = fn.toString();
      const gateKey =
        src.includes('ResultsTab') ? 'ResultsTab'
        : src.includes('DeepDiveTab') ? 'DeepDiveTab'
        : src.includes('SettingsTab') ? 'SettingsTab'
        : null;
      if (gateKey) {
        if (!deferredImports[gateKey]) deferredImports[gateKey] = makeDeferred();
        return deferredImports[gateKey].promise.then(() => fn());
      }
      return fn();
    });
  },
}));

// ── Subject under test ────────────────────────────────────────────────────────
// ClientDashboard is loaded FRESH per test (see loadFreshDashboard) so its module-level React.lazy
// components are recreated each time. React.lazy permanently memoizes the first resolved module on the
// lazy object, so a once-resolved wrapper never suspends again — reusing a single static import would
// make every test after the first per-wrapper touch resolve synchronously and silently skip the
// Suspense-fallback assertion. A per-test `vi.resetModules()` + dynamic import gives each test its own
// suspending lazies, keeping the guard non-vacuous for every case.
import type { ClientDashboard as ClientDashboardType } from '../../../src/components/ClientDashboard';
import type { get as getType, getOptional as getOptionalType } from '../../../src/api/client';
import type { WorkspaceInfo } from '../../../src/components/client/types';
import type { ContentPlanSummary, useClientContentPlan as useClientContentPlanType } from '../../../src/hooks/client/useClientQueries';

let ClientDashboard: typeof ClientDashboardType;
let mockGet: ReturnType<typeof vi.mocked<typeof getType>>;
let mockGetOptional: ReturnType<typeof vi.mocked<typeof getOptionalType>>;
let mockUseClientContentPlan: ReturnType<typeof vi.mocked<typeof useClientContentPlanType>>;

async function loadFreshDashboard() {
  vi.resetModules();
  // Re-import the (still-mocked) api/client so the fresh ClientDashboard module graph and these mock
  // handles point at the SAME module instance — otherwise mockGet would not drive the bootstrap fetch.
  const apiClient = await import('../../../src/api/client');
  mockGet = vi.mocked(apiClient.get);
  mockGetOptional = vi.mocked(apiClient.getOptional);
  mockGetOptional.mockResolvedValue(null);
  // Same rationale as api/client: re-acquire the contentPlan hook mock from the freshly-imported
  // (mocked) module so per-test return overrides land on the instance ClientDashboard consumes.
  const clientQueries = await import('../../../src/hooks/client/useClientQueries');
  mockUseClientContentPlan = vi.mocked(clientQueries.useClientContentPlan);
  ({ ClientDashboard } = await import('../../../src/components/ClientDashboard'));
}

// ── Test helpers ─────────────────────────────────────────────────────────────
function makeWorkspace(overrides?: Partial<WorkspaceInfo>): WorkspaceInfo {
  return {
    id: 'ws-test',
    name: 'Acme Corp',
    requiresPassword: false,
    tier: 'growth',
    analyticsClientView: true,
    seoClientView: true,
    ...overrides,
  } as WorkspaceInfo;
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

/**
 * Drive the contentPlanSummary gate. ClientDashboard reads `contentPlanQ.data?.summary ?? null`, so the
 * mock returns a useQuery-shaped object whose `data.summary` is a ContentPlanSummary with `totalCells`.
 * `totalCells > 0` (with clientIaV2 ON) → DeepDive passes a contentPlanSlot; `0`/null → omits it.
 */
function setContentPlanCells(totalCells: number) {
  const summary: ContentPlanSummary | null = totalCells > 0
    ? {
        totalCells,
        publishedCells: 0,
        reviewCells: 0,
        approvedCells: 0,
        inProgressCells: 0,
        matrixCount: 1,
      }
    : null;
  mockUseClientContentPlan.mockReturnValue({
    data: summary ? { summary, keywords: new Map(), reviewCells: [] } : null,
    isLoading: false,
    error: null,
  } as ReturnType<typeof useClientContentPlanType>);
}

function renderDashboard(
  props: { workspaceId?: string; betaMode?: boolean; initialTab?: string } = {},
): RenderResult {
  const queryClient = makeQueryClient();
  const { workspaceId = 'ws-test', betaMode = false, initialTab } = props;
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/client/ws-test']}>
        <ClientDashboard workspaceId={workspaceId} betaMode={betaMode} initialTab={initialTab} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The panel-local Suspense fallback (ClientTabFallback → OverviewSkeleton) renders skeleton divs with
 * `animate-pulse` inside <main>. The dashboard's own loading state also uses OverviewSkeleton, but by
 * the time the ClientHeader is present `loading` is false — so any `.animate-pulse` inside <main> after
 * the header appears is the per-panel Suspense fallback.
 */
function mainHasSuspenseFallback(view: RenderResult): boolean {
  return !!view.container.querySelector('main .animate-pulse');
}

/**
 * Assert the named lazy panel is wrapped in a per-panel Suspense boundary, then release it and run a
 * caller-supplied assertion on the resolved content. The prerequisite `waitFor(client-header)` is the
 * first half of the non-vacuousness guard: if the panel's <LazyClientTabPanel> is missing, the pending
 * import suspends a higher slice of the tree, the header never mounts, and this throws.
 */
async function assertWrappedInSuspenseThenResolve(
  view: RenderResult,
  gateKey: 'ResultsTab' | 'DeepDiveTab' | 'SettingsTab',
  afterResolve: () => void | Promise<void>,
) {
  // (b) Surrounding chrome mounted even though the panel import is still pending.
  await waitFor(() => expect(screen.getByTestId('client-header')).toBeInTheDocument());
  // (a) Panel-local Suspense fallback is what's rendering in the content area.
  expect(mainHasSuspenseFallback(view)).toBe(true);
  // Release the import → the real wrapper resolves and mounts.
  deferredImports[gateKey]?.resolve();
  await afterResolve();
}

describe('ClientDashboard — IA v2 flag-ON real lazy/Suspense render (rule-13 guard)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    resetDeferredImports();
    // Fresh ClientDashboard (and fresh, still-suspending lazy panels) + re-acquired api mocks.
    await loadFreshDashboard();
  });

  // ── Deep Dive ──────────────────────────────────────────────────────────────
  it('mounts the real DeepDiveTab via Suspense and shows the Analytics sub-tab content', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    const view = renderDashboard({ initialTab: 'deep-dive' });

    await assertWrappedInSuspenseThenResolve(view, 'DeepDiveTab', async () => {
      // DeepDiveTab's default Analytics sub-tab mounts BOTH the analyticsSlot (PerformanceTab stub)
      // and the pinned healthSlot (HealthTab stub).
      await waitFor(() => expect(screen.getByTestId('performance-tab')).toBeInTheDocument());
      expect(screen.getByTestId('health-tab')).toBeInTheDocument();
      // Rankings slot is not mounted until its sub-tab is active.
      expect(screen.queryByTestId('strategy-tab')).not.toBeInTheDocument();
    });
  });

  it('switches the DeepDiveTab Rankings sub-tab to the StrategyTab slot', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    const view = renderDashboard({ initialTab: 'deep-dive' });

    await assertWrappedInSuspenseThenResolve(view, 'DeepDiveTab', async () => {
      await waitFor(() => expect(screen.getByTestId('performance-tab')).toBeInTheDocument());
    });

    // DeepDiveTab renders its own real TabBar (role="tab") with Analytics / Rankings.
    fireEvent.click(screen.getByRole('tab', { name: /rankings/i }));

    await waitFor(() => expect(screen.getByTestId('strategy-tab')).toBeInTheDocument());
    // Analytics slot is unmounted once Rankings is active.
    expect(screen.queryByTestId('performance-tab')).not.toBeInTheDocument();
  });

  // ── P3: Content roadmap re-homed under DeepDive > Rankings (end-to-end gate) ──
  it('re-homes ContentPlanTab as a "Content roadmap" section under DeepDive > Rankings when a plan exists', async () => {
    // clientIaV2 is ON (flag mock) and contentPlanSummary.totalCells > 0 → DeepDive gets a contentPlanSlot.
    setContentPlanCells(5);
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    const view = renderDashboard({ initialTab: 'deep-dive' });

    await assertWrappedInSuspenseThenResolve(view, 'DeepDiveTab', async () => {
      await waitFor(() => expect(screen.getByTestId('performance-tab')).toBeInTheDocument());
    });

    // Switch to Rankings — the content roadmap lives under that sub-tab only.
    fireEvent.click(screen.getByRole('tab', { name: /rankings/i }));

    await waitFor(() => expect(screen.getByTestId('strategy-tab')).toBeInTheDocument());
    // The "Content roadmap" section renders and the (mocked) ContentPlanTab mounts inside it.
    expect(screen.getByText('Content roadmap')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('content-plan-tab')).toBeInTheDocument());
  });

  it('omits the DeepDive "Content roadmap" section when the plan has zero cells (gate off)', async () => {
    // totalCells === 0 → contentPlanSummary null → ClientDashboard passes contentPlanSlot={undefined}.
    setContentPlanCells(0);
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    const view = renderDashboard({ initialTab: 'deep-dive' });

    await assertWrappedInSuspenseThenResolve(view, 'DeepDiveTab', async () => {
      await waitFor(() => expect(screen.getByTestId('performance-tab')).toBeInTheDocument());
    });

    fireEvent.click(screen.getByRole('tab', { name: /rankings/i }));

    await waitFor(() => expect(screen.getByTestId('strategy-tab')).toBeInTheDocument());
    // No plan → no content roadmap section and no ContentPlanTab anywhere under Rankings.
    expect(screen.queryByText('Content roadmap')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content-plan-tab')).not.toBeInTheDocument();
  });

  // ── Inbox-reachable guard (content brief / post review path preserved by IA v2) ──
  it('mounts the Inbox panel without throwing under IA v2 (preserves the content brief/post review path)', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    renderDashboard({ initialTab: 'inbox' });

    // Surrounding chrome + the Inbox panel (stub) mount; the brief/post review path lives in Inbox,
    // so reaching it confirms IA v2 keeps that path reachable.
    await waitFor(() => expect(screen.getByTestId('client-header')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('inbox-tab')).toBeInTheDocument());
  });

  // ── Results ────────────────────────────────────────────────────────────────
  it('mounts the real ResultsTab via Suspense (ROIDashboard stub renders)', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    const view = renderDashboard({ initialTab: 'results' });

    await assertWrappedInSuspenseThenResolve(view, 'ResultsTab', async () => {
      // Real ResultsTab renders ROIDashboard (stub). This panel's missing-Suspense bug was the exact
      // one found+fixed earlier — the prerequisite header + fallback assertions above catch its return.
      await waitFor(() => expect(screen.getByTestId('roi-tab')).toBeInTheDocument());
    });
  });

  // ── Settings ───────────────────────────────────────────────────────────────
  it('mounts the real SettingsTab via Suspense with the Brand + Plans sections', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    const view = renderDashboard({ initialTab: 'settings' });

    await assertWrappedInSuspenseThenResolve(view, 'SettingsTab', async () => {
      await waitFor(() => expect(screen.getByTestId('settings-tab')).toBeInTheDocument());
      // Brand section is always present; BrandTab stub mounts inside it.
      expect(screen.getByTestId('settings-brand-section')).toBeInTheDocument();
      expect(screen.getByTestId('brand-tab')).toBeInTheDocument();
      // Platform-billed, non-beta workspace → plansSlot provided → Plans & billing section renders.
      expect(screen.getByTestId('settings-plans-section')).toBeInTheDocument();
      expect(screen.getByTestId('plans-tab')).toBeInTheDocument();
    });
  });

  it('omits the SettingsTab Plans & billing section for external-billing workspaces', async () => {
    // billingMode 'external' → ClientDashboard passes plansSlot={undefined}; SettingsTab then drops
    // the entire "Plans & billing" section. Asserts the plansSlot gating end-to-end.
    const ws = makeWorkspace({ billingMode: 'external' });
    mockGet.mockResolvedValue(ws);

    const view = renderDashboard({ initialTab: 'settings' });

    await assertWrappedInSuspenseThenResolve(view, 'SettingsTab', async () => {
      await waitFor(() => expect(screen.getByTestId('settings-tab')).toBeInTheDocument());
      expect(screen.getByTestId('settings-brand-section')).toBeInTheDocument();
      expect(screen.getByTestId('brand-tab')).toBeInTheDocument();
      expect(screen.queryByTestId('settings-plans-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('plans-tab')).not.toBeInTheDocument();
    });
  });

  it('omits the SettingsTab Plans & billing section in betaMode', async () => {
    // betaMode → ClientDashboard passes plansSlot={undefined} as well.
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    const view = renderDashboard({ initialTab: 'settings', betaMode: true });

    await assertWrappedInSuspenseThenResolve(view, 'SettingsTab', async () => {
      await waitFor(() => expect(screen.getByTestId('settings-tab')).toBeInTheDocument());
      expect(screen.queryByTestId('settings-plans-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('plans-tab')).not.toBeInTheDocument();
    });
  });

  // ── Legacy roi bookmark ──────────────────────────────────────────────────────
  it('resolves a legacy ?tab=roi bookmark to the working roi panel', async () => {
    // resolveClientTab('roi') === 'roi' (NOT aliased to results) — the legacy non-evergreen ROI
    // panel still renders without throwing. The roi panel wraps the (immediately-resolving, mocked)
    // ROIDashboard in its own <LazyClientTabPanel>; reaching the stub proves the path is intact.
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    renderDashboard({ initialTab: 'roi' });

    await waitFor(() => expect(screen.getByTestId('client-header')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('roi-tab')).toBeInTheDocument());
  });
});
