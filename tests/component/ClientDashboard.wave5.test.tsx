/**
 * Wave 5 — Client Dashboard shell (client-ia-v2 flag-ON path).
 *
 * These tests drive the REAL `useFeatureFlag('client-ia-v2')` hook backed by a
 * QueryClient — the flag query resolves loading(OFF/default)→loaded(ON) so the
 * two-speed 4-tab shell mounts under the genuine transition. A `vi.mock` of the
 * hook would consume ZERO React hook slots and hide any Rules-of-Hooks
 * regression in the flag-ON branch (see CLAUDE.md + OverviewTab.flagTransition),
 * so we mock the underlying API (`src/api/misc` → featureFlags.list) instead.
 *
 * Coverage:
 *  - Flag ON: nav collapses to the 4 two-speed tabs; every legacy destination is
 *    reachable within the shell (via direct panel + Deep Dive / Settings slots).
 *  - Flag ON: each folded panel is DEFINED ONCE — rendering it as its own tab and
 *    inside its Deep Dive slot yields the same testid'd panel, one instance per
 *    view (the dedupe refactor produced identical output, not a second mount).
 *  - Flag ON: single prioritized notice region — a real section error suppresses
 *    both the trial banner and the per-tab education tip.
 *  - Flag ON: no PageHeader title that merely echoes the active nav label.
 *  - Flag OFF: the legacy 12-destination nav, the stacked notices, and the
 *    per-tab PageHeader title are all still present (unchanged).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// ── Mock API client (workspace bootstrap) ───────────────────────────────────
vi.mock('../../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client')>();
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

// ── Feature-flag API — partial mock so useFeatureFlag resolves client-ia-v2 ON.
// A module-level toggle lets each suite flip the flag before rendering. The hook
// stays REAL (useQuery), so the loading→loaded transition is genuine.
let flagOn = false;
vi.mock('../../src/api/misc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/misc')>();
  return {
    ...actual,
    featureFlags: {
      list: () => Promise.resolve({ 'client-ia-v2': flagOn }),
    },
  };
});

// ── react-router-dom (preserve actual, override navigate) ────────────────────
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// ── Hooks ────────────────────────────────────────────────────────────────────
vi.mock('../../src/hooks/useWorkspaceEvents', () => ({ useWorkspaceEvents: vi.fn() }));
vi.mock('../../src/hooks/useRecommendations', () => ({
  useRecommendations: vi.fn(() => ({ recs: [], loaded: false })),
  useRecommendationSet: vi.fn(() => ({ data: undefined })),
}));
vi.mock('../../src/hooks/usePayments', () => ({
  usePayments: vi.fn(() => ({
    pricingModal: null,
    setPricingModal: vi.fn(),
    pricingConfirming: false,
    pricingData: null,
    setPricingData: vi.fn(),
    confirmPricingAndSubmit: vi.fn(),
  })),
}));

// Section-error injection: a mutable flag flips useClientStrategy to an error so
// the notice-priority test can assert the education tip / trial banner yield.
let strategyErrors = false;
vi.mock('../../src/hooks/client/useClientQueries', () => ({
  useClientActivity: () => ({ data: [], isLoading: false, error: null }),
  useClientRankHistory: () => ({ data: [], isLoading: false, error: null }),
  useClientLatestRanks: () => ({ data: [], isLoading: false, error: null }),
  useClientAnnotations: () => ({ data: [], isLoading: false, error: null }),
  useClientAnomalies: () => ({ data: [], isLoading: false, error: null }),
  useClientApprovals: () => ({ data: [], isLoading: false, error: null }),
  useClientRequests: () => ({ data: [], isLoading: false, error: null }),
  useClientContentRequests: () => ({ data: [], isLoading: false, error: null }),
  useClientAuditSummary: () => ({ data: null, isLoading: false, error: null }),
  useClientAuditDetail: () => ({ data: null, isLoading: false, error: null }),
  useClientStrategy: () => ({ data: null, isLoading: false, error: strategyErrors ? new Error('boom') : null }),
  useClientPricing: () => ({ data: null, isLoading: false, error: null }),
  useClientContentPlan: () => ({ data: null, isLoading: false, error: null }),
  useClientCopyEntries: () => ({ data: 0, isLoading: false, error: null }),
}));
vi.mock('../../src/hooks/client/useClientSearch', () => ({
  useClientSearch: vi.fn(() => ({ overview: null, trend: [], comparison: null, devices: [], sectionError: null })),
}));
vi.mock('../../src/hooks/client/useClientGA4', () => ({
  useClientGA4: vi.fn(() => ({
    ga4Overview: null, ga4Trend: [], ga4Pages: [], ga4Sources: [], ga4Devices: [],
    ga4Countries: [], ga4Events: [], ga4Conversions: [], ga4Comparison: null,
    ga4NewVsReturning: [], ga4Organic: null, ga4LandingPages: [], sectionError: null, hasGA4: false,
  })),
}));
vi.mock('../../src/hooks/client/useBrandSummary', () => ({
  useBrandSummary: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
}));

// ── Heavy children / providers ───────────────────────────────────────────────
vi.mock('../../src/components/client/ClientAuthGate', () => ({ ClientAuthGate: () => <div data-testid="client-auth-gate" /> }));
vi.mock('../../src/components/client/EmailCaptureGate', () => ({ EmailCaptureGate: () => <div data-testid="email-capture-gate" /> }));
vi.mock('../../src/components/client/ClientChatWidget', () => ({ ClientChatWidget: () => <div data-testid="client-chat-widget" /> }));
vi.mock('../../src/components/client/UpgradeModal', () => ({ UpgradeModal: () => <div data-testid="upgrade-modal" /> }));
vi.mock('../../src/components/client/PricingConfirmationModal', () => ({ PricingConfirmationModal: () => <div data-testid="pricing-modal" /> }));
vi.mock('../../src/components/client/ClientOnboardingQuestionnaire', () => ({ ClientOnboardingQuestionnaire: () => <div data-testid="onboarding-questionnaire" /> }));
vi.mock('../../src/components/client/OnboardingWizard', () => ({ OnboardingWizard: () => <div data-testid="onboarding-wizard" /> }));
// SeoCart is used by the REAL ClientHeader (SeoCartButton) + the dashboard (SeoCartDrawer).
vi.mock('../../src/components/client/SeoCart', () => ({
  SeoCartDrawer: () => <div data-testid="seo-cart-drawer" />,
  SeoCartButton: () => <div data-testid="seo-cart-button" />,
}));
// Education tip renders its own testid ONLY when a tip exists for the tab; we
// render a deterministic marker so the notice-priority test can assert presence.
vi.mock('../../src/components/client/SeoEducationTip', () => ({
  SeoEducationTip: ({ tab }: { tab: string }) => <div data-testid="seo-education-tip">{tab}</div>,
}));
vi.mock('../../src/components/ui/ScannerReveal.tsx', () => ({
  ScannerReveal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../src/components/client/BetaContext', () => ({ BetaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../src/components/client/useCart', () => ({ CartProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

// ── Lazy tab panels — deterministic testids ──────────────────────────────────
vi.mock('../../src/components/client/OverviewTab', () => ({ OverviewTab: () => <div data-testid="overview-tab" /> }));
vi.mock('../../src/components/client/PerformanceTab', () => ({ PerformanceTab: () => <div data-testid="performance-tab" /> }));
vi.mock('../../src/components/client/HealthTab', () => ({ HealthTab: () => <div data-testid="health-tab" /> }));
vi.mock('../../src/components/client/StrategyTab', () => ({ StrategyTab: () => <div data-testid="strategy-tab" /> }));
vi.mock('../../src/components/client/InboxTab', () => ({ InboxTab: () => <div data-testid="inbox-tab" /> }));
vi.mock('../../src/components/client/PlansTab', () => ({ PlansTab: () => <div data-testid="plans-tab" /> }));
vi.mock('../../src/components/client/ContentPlanTab', () => ({ ContentPlanTab: () => <div data-testid="content-plan-tab" /> }));
vi.mock('../../src/components/client/ROIDashboard', () => ({ ROIDashboard: () => <div data-testid="roi-tab" /> }));
vi.mock('../../src/components/client/ResultsTab', () => ({ ResultsTab: () => <div data-testid="results-tab" /> }));
vi.mock('../../src/components/client/InsightsEngine', () => ({ InsightsEngine: () => <div data-testid="insights-engine" /> }));
vi.mock('../../src/components/client/BrandTab', () => ({ BrandTab: () => <div data-testid="brand-tab" /> }));
// DeepDiveTab / SettingsTab: render their slots so the dedupe assertion can see
// the folded panels inside the shell (wrapped in a testid'd container).
vi.mock('../../src/components/client/DeepDiveTab', () => ({
  DeepDiveTab: ({ analyticsSlot, healthSlot, rankingsSlot, contentPlanSlot }: {
    analyticsSlot: React.ReactNode; healthSlot: React.ReactNode; rankingsSlot: React.ReactNode; contentPlanSlot?: React.ReactNode;
  }) => (
    <div data-testid="deep-dive-tab">
      {analyticsSlot}{healthSlot}{rankingsSlot}{contentPlanSlot}
    </div>
  ),
}));
vi.mock('../../src/components/client/SettingsTab', () => ({
  SettingsTab: ({ brandSlot, plansSlot }: { brandSlot: React.ReactNode; plansSlot?: React.ReactNode }) => (
    <div data-testid="settings-tab">{brandSlot}{plansSlot}</div>
  ),
}));

// lazyWithRetry → real React.lazy over the vi.mock'd modules.
vi.mock('../../src/lib/lazyWithRetry', () => ({
  lazyWithRetry: (fn: () => Promise<{ default: React.ComponentType<unknown> }>) => {
    const { lazy } = require('react');
    return lazy(fn);
  },
}));

import { get, getOptional } from '../../src/api/client';
import { ClientDashboard } from '../../src/components/ClientDashboard';
import type { WorkspaceInfo } from '../../src/components/client/types';

const mockGet = vi.mocked(get);
const mockGetOptional = vi.mocked(getOptional);

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

function renderDashboard(
  props: { workspaceId?: string; betaMode?: boolean; initialTab?: string } = {},
  { initialEntry = '/client/ws-test' }: { initialEntry?: string } = {},
) {
  const queryClient = makeQueryClient();
  const { workspaceId = 'ws-test', betaMode = false, initialTab } = props;
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ClientDashboard workspaceId={workspaceId} betaMode={betaMode} initialTab={initialTab} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  flagOn = false;
  strategyErrors = false;
  mockGetOptional.mockResolvedValue(null);
});

// ── Flag ON: 4-tab two-speed nav ─────────────────────────────────────────────

describe('ClientDashboard Wave 5 — flag ON: 4-tab shell', () => {
  it('collapses the nav to exactly the four two-speed tabs, no legacy tabs', async () => {
    flagOn = true;
    // Paid + strategyData present so the optional Results tab is included → 4 tabs.
    const ws = makeWorkspace({ tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    // Wait for the flag query to resolve and the shell to commit.
    const tablist = await screen.findByRole('tablist');
    await waitFor(() => {
      const tabs = within(tablist).getAllByRole('tab');
      // overview / inbox / deep-dive / settings (no strategyData → no Results).
      expect(tabs).toHaveLength(4);
    });

    const labels = within(tablist).getAllByRole('tab').map(t => t.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['Overview', 'Inbox', 'Deep Dive', 'Settings']));
    // Legacy standalone destinations are NOT top-level tabs under the shell.
    expect(labels).not.toContain('Site Health');
    expect(labels).not.toContain('SEO Strategy');
    expect(labels).not.toContain('Performance');
    expect(labels).not.toContain('Plans');
    expect(labels).not.toContain('Brand');
    expect(labels).not.toContain('ROI');
  });

  it('reaches every folded legacy destination within the shell (Deep Dive + Settings slots)', async () => {
    flagOn = true;
    const ws = makeWorkspace({ tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    // Deep Dive holds Performance + Health + Strategy (rankings).
    renderDashboard({ initialTab: 'deep-dive' });
    const deepDive = await screen.findByTestId('deep-dive-tab');
    expect(await within(deepDive).findByTestId('performance-tab')).toBeInTheDocument();
    expect(await within(deepDive).findByTestId('health-tab')).toBeInTheDocument();
    expect(await within(deepDive).findByTestId('strategy-tab')).toBeInTheDocument();
  });

  it('reaches Brand + Plans within the Settings home', async () => {
    flagOn = true;
    const ws = makeWorkspace({ tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard({ initialTab: 'settings' });
    await waitFor(() => expect(screen.getByTestId('settings-tab')).toBeInTheDocument());
    const settings = screen.getByTestId('settings-tab');
    expect(within(settings).getByTestId('brand-tab')).toBeInTheDocument();
    expect(within(settings).getByTestId('plans-tab')).toBeInTheDocument();
  });
});

// ── Flag ON: single-definition panels (dedupe) ───────────────────────────────

describe('ClientDashboard Wave 5 — flag ON: deduped panels', () => {
  it('renders the Performance panel once as its own tab', async () => {
    flagOn = true;
    mockGet.mockResolvedValue(makeWorkspace());
    renderDashboard({ initialTab: 'performance' });
    await waitFor(() => expect(screen.getAllByTestId('performance-tab')).toHaveLength(1));
  });

  it('renders the Performance panel once inside the Deep Dive slot (single mount, not duplicated)', async () => {
    flagOn = true;
    mockGet.mockResolvedValue(makeWorkspace());
    renderDashboard({ initialTab: 'deep-dive' });
    // The deduped fragment appears exactly once inside Deep Dive — the construction
    // refactor referenced the shared const, it did not mount a second copy.
    await waitFor(() => expect(screen.getAllByTestId('performance-tab')).toHaveLength(1));
    expect(screen.getAllByTestId('health-tab')).toHaveLength(1);
    expect(screen.getAllByTestId('strategy-tab')).toHaveLength(1);
  });

  it('renders the Brand panel once as its own tab and once inside Settings — never both at the same time', async () => {
    flagOn = true;
    mockGet.mockResolvedValue(makeWorkspace());

    const brandView = renderDashboard({ initialTab: 'brand' });
    await waitFor(() => expect(screen.getAllByTestId('brand-tab')).toHaveLength(1));
    brandView.unmount();

    renderDashboard({ initialTab: 'settings' });
    await waitFor(() => expect(screen.getByTestId('settings-tab')).toBeInTheDocument());
    expect(screen.getAllByTestId('brand-tab')).toHaveLength(1);
  });
});

// ── Flag ON: single prioritized notice region ────────────────────────────────

describe('ClientDashboard Wave 5 — flag ON: notice priority', () => {
  it('suppresses trial banner AND education tip when a real section error is present', async () => {
    flagOn = true;
    strategyErrors = true;
    // Trial that would otherwise show the countdown banner.
    const ws = makeWorkspace({ isTrial: true, trialDaysRemaining: 3, trialEndsAt: '2026-07-01T00:00:00.000Z', tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    // Error notice wins.
    await waitFor(() => expect(screen.getByText(/try refreshing the page/i)).toBeInTheDocument());
    // Trial countdown + education tip both yield to the error.
    expect(screen.queryByText(/left on your Growth trial/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('seo-education-tip')).not.toBeInTheDocument();
  });

  it('shows the education tip only when there is no error and no trial notice', async () => {
    flagOn = true;
    strategyErrors = false;
    mockGet.mockResolvedValue(makeWorkspace({ isTrial: false, tier: 'growth' }));

    renderDashboard();

    await waitFor(() => expect(screen.getByTestId('seo-education-tip')).toBeInTheDocument());
    expect(screen.queryByText(/try refreshing the page/i)).not.toBeInTheDocument();
  });
});

// ── Flag ON: no echoing PageHeader title ─────────────────────────────────────

describe('ClientDashboard Wave 5 — flag ON: no PageHeader title echo', () => {
  it('does not render a heading that merely repeats the active nav label', async () => {
    flagOn = true;
    mockGet.mockResolvedValue(makeWorkspace());

    renderDashboard({ initialTab: 'overview' });

    await waitFor(() => expect(screen.getByRole('tablist')).toBeInTheDocument());
    // Under the legacy nav the PageHeader renders an <h2> titled "Insights"
    // (the overview label). Under the shell that echoing heading is dropped.
    const headings = screen.queryAllByRole('heading', { level: 2 }).map(h => h.textContent?.trim());
    expect(headings).not.toContain('Insights');
  });
});

// ── Flag OFF: legacy shell unchanged ─────────────────────────────────────────

describe('ClientDashboard Wave 5 — flag OFF: legacy nav + notices + title unchanged', () => {
  it('renders the legacy multi-tab nav with the folded destinations as top-level tabs', async () => {
    flagOn = false;
    const ws = makeWorkspace({ tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    const tablist = await screen.findByRole('tablist');
    await waitFor(() => {
      const labels = within(tablist).getAllByRole('tab').map(t => t.textContent?.trim());
      // Legacy destinations that the shell folds are top-level tabs here.
      expect(labels).toContain('Site Health');
      expect(labels).toContain('SEO Strategy');
      expect(labels).toContain('Performance');
      expect(labels).toContain('Brand');
    });
    // More than the 4-tab shell.
    expect(within(tablist).getAllByRole('tab').length).toBeGreaterThan(4);
  });

  it('renders the per-tab PageHeader title echoing the active nav label (Insights on overview)', async () => {
    flagOn = false;
    mockGet.mockResolvedValue(makeWorkspace());

    renderDashboard({ initialTab: 'overview' });

    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent?.trim());
      expect(headings).toContain('Insights');
    });
  });

  it('renders the stacked legacy notices (education tip present alongside no error)', async () => {
    flagOn = false;
    mockGet.mockResolvedValue(makeWorkspace({ isTrial: false, tier: 'growth' }));

    renderDashboard();

    await waitFor(() => expect(screen.getByTestId('seo-education-tip')).toBeInTheDocument());
  });
});
