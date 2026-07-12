/**
 * Component tests for ClientDashboard.tsx and src/lib/client-dashboard-tab.ts.
 *
 * Strategy:
 *  - All hooks and lazy-loaded child components are mocked so tests stay fast
 *    and focused on the dashboard shell's rendering logic.
 *  - API calls that drive useClientWorkspaceBootstrap are mocked at the
 *    src/api/client level.
 *  - Pure functions in src/lib/client-dashboard-tab.ts are tested directly
 *    without rendering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// ── Mock API client (must happen before imports that use them) ──────────────
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

vi.mock('../../src/api/analytics', () => ({
  gsc: {
    overview: vi.fn(),
    trend: vi.fn(),
    comparison: vi.fn(),
    devices: vi.fn(),
  },
}));

// ── Mock react-router-dom (preserve actual, override navigate/params) ────────
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// ── Mock hooks ────────────────────────────────────────────────────────────────
vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: vi.fn(),
}));

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn(() => false),
}));

vi.mock('../../src/hooks/useRecommendations', () => ({
  useRecommendations: vi.fn(() => ({ recs: [], loaded: false })),
  useRecommendationSet: vi.fn(() => ({ data: undefined })),
}));

vi.mock('../../src/hooks/usePayments', () => ({
  usePayments: vi.fn(() => ({
    pricingModal: null,
    setPricingModal: vi.fn(),
    pricingConfirming: false,
    setPricingConfirming: vi.fn(),
    pricingData: null,
    setPricingData: vi.fn(),
    stripePayment: null,
    setStripePayment: vi.fn(),
    confirmPricingAndSubmit: vi.fn(),
  })),
}));

vi.mock('../../src/hooks/client/useClientQueries', () => ({
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
  useClientStrategy: () => ({ data: null, isLoading: false, error: null }),
  useClientPricing: () => ({ data: null, isLoading: false, error: null }),
  useClientContentPlan: () => ({ data: null, isLoading: false, error: null }),
  useClientCopyEntries: () => ({ data: 0, isLoading: false, error: null }),
}));

vi.mock('../../src/hooks/client/useClientSearch', () => ({
  useClientSearch: vi.fn(() => ({
    overview: null,
    trend: [],
    comparison: null,
    devices: [],
    sectionError: null,
  })),
}));

vi.mock('../../src/hooks/client/useClientGA4', () => ({
  useClientGA4: vi.fn(() => ({
    ga4Overview: null,
    ga4Trend: [],
    ga4Pages: [],
    ga4Sources: [],
    ga4Devices: [],
    ga4Countries: [],
    ga4Events: [],
    ga4Conversions: [],
    ga4Comparison: null,
    ga4NewVsReturning: [],
    ga4Organic: null,
    ga4LandingPages: [],
    sectionError: null,
    hasGA4: false,
  })),
}));

// ── Mock heavy child components (lazy-loaded via lazyWithRetry) ───────────────
vi.mock('../../src/components/client/ClientAuthGate', () => ({
  ClientAuthGate: () => <div data-testid="client-auth-gate">Auth Gate</div>,
}));

vi.mock('../../src/components/client/EmailCaptureGate', () => ({
  EmailCaptureGate: () => <div data-testid="email-capture-gate">Email Gate</div>,
}));

vi.mock('../../src/components/client/ClientChatWidget', () => ({
  ClientChatWidget: () => <div data-testid="client-chat-widget" />,
}));

vi.mock('../../src/components/client/ClientHeader', () => ({
  ClientHeader: ({ ws }: { ws: { name: string } }) => (
    <header data-testid="client-header">{ws?.name}</header>
  ),
}));

vi.mock('../../src/components/client/UpgradeModal', () => ({
  UpgradeModal: () => <div data-testid="upgrade-modal" />,
}));

vi.mock('../../src/components/client/PricingConfirmationModal', () => ({
  PricingConfirmationModal: () => <div data-testid="pricing-modal" />,
}));

vi.mock('../../src/components/client/ClientOnboardingQuestionnaire', () => ({
  ClientOnboardingQuestionnaire: () => <div data-testid="onboarding-questionnaire" />,
}));

vi.mock('../../src/components/client/OnboardingWizard', () => ({
  OnboardingWizard: () => <div data-testid="onboarding-wizard" />,
}));

vi.mock('../../src/components/client/SeoCart', () => ({
  SeoCartDrawer: () => <div data-testid="seo-cart-drawer" />,
}));

vi.mock('../../src/components/client/SeoEducationTip', () => ({
  SeoEducationTip: () => null,
}));

// ScannerReveal uses ResizeObserver which is not available in jsdom.
// The component is re-exported through the ui/ barrel but we mock the source.
vi.mock('../../src/components/ui/ScannerReveal.tsx', () => ({
  ScannerReveal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../src/components/client/BetaContext', () => ({
  BetaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../src/components/client/useCart', () => ({
  CartProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock lazy tab panels — they resolve but render a simple placeholder
vi.mock('../../src/components/client/OverviewTab', () => ({
  OverviewTab: () => <div data-testid="overview-tab">Overview</div>,
}));
vi.mock('../../src/components/client/PerformanceTab', () => ({
  PerformanceTab: () => <div data-testid="performance-tab">Performance</div>,
}));
vi.mock('../../src/components/client/HealthTab', () => ({
  HealthTab: ({ impactBandsByCheck }: { impactBandsByCheck?: Record<string, unknown> }) => (
    <div
      data-testid="health-tab"
      data-impact-bands={impactBandsByCheck ? JSON.stringify(impactBandsByCheck) : undefined}
    >
      Health
    </div>
  ),
}));
vi.mock('../../src/components/client/StrategyTab', () => ({
  StrategyTab: () => <div data-testid="strategy-tab">Strategy</div>,
}));
vi.mock('../../src/components/client/InboxTab', () => ({
  InboxTab: () => <div data-testid="inbox-tab">Inbox</div>,
}));
vi.mock('../../src/components/client/PlansTab', () => ({
  PlansTab: () => <div data-testid="plans-tab">Plans</div>,
}));
vi.mock('../../src/components/client/ContentPlanTab', () => ({
  ContentPlanTab: () => <div data-testid="content-plan-tab">Content Plan</div>,
}));
vi.mock('../../src/components/client/ROIDashboard', () => ({
  ROIDashboard: () => <div data-testid="roi-tab">ROI</div>,
}));
vi.mock('../../src/components/client/InsightsEngine', () => ({
  InsightsEngine: () => <div data-testid="insights-engine">Insights Engine</div>,
}));
vi.mock('../../src/components/client/BrandTab', () => ({
  BrandTab: () => <div data-testid="brand-tab">Brand</div>,
}));

// ── Mock lazyWithRetry to pass through to the vi.mock'd modules ───────────────
vi.mock('../../src/lib/lazyWithRetry', () => ({
  lazyWithRetry: (fn: () => Promise<{ default: React.ComponentType<unknown> }>) => {
    // Return a regular (non-lazy) import — vitest handles static mocks
    const { lazy } = require('react');
    return lazy(fn);
  },
}));

// ── Now import subject under test ─────────────────────────────────────────────
import { get, getOptional } from '../../src/api/client';
import { ClientDashboard } from '../../src/components/ClientDashboard';
import { useWorkspaceEvents } from '../../src/hooks/useWorkspaceEvents';
import { useRecommendations } from '../../src/hooks/useRecommendations';
import {
  resolveClientTab,
  KNOWN_CLIENT_TABS,
} from '../../src/lib/client-dashboard-tab';
import { queryKeys } from '../../src/lib/queryKeys';
import { WS_EVENTS } from '../../src/lib/wsEvents';
import type { WorkspaceInfo } from '../../src/components/client/types';

const mockGet = vi.mocked(get);
const mockGetOptional = vi.mocked(getOptional);

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
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

interface WrapperOptions {
  initialEntry?: string;
}

function renderDashboard(
  props: { workspaceId?: string; betaMode?: boolean; initialTab?: string } = {},
  { initialEntry = '/client/ws-test' }: WrapperOptions = {},
) {
  const queryClient = makeQueryClient();
  const { workspaceId = 'ws-test', betaMode = false, initialTab } = props;
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ClientDashboard
          workspaceId={workspaceId}
          betaMode={betaMode}
          initialTab={initialTab}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

// ── Pure function tests: resolveClientTab ────────────────────────────────────

describe('resolveClientTab', () => {
  it('returns overview for undefined input', () => {
    expect(resolveClientTab(undefined)).toBe('overview');
  });

  it('returns overview for null input', () => {
    expect(resolveClientTab(null)).toBe('overview');
  });

  it('returns overview for an empty string', () => {
    expect(resolveClientTab('')).toBe('overview');
  });

  it('returns overview for an unknown tab', () => {
    expect(resolveClientTab('completely-unknown-tab')).toBe('overview');
  });

  it('maps legacy "search" alias to performance', () => {
    expect(resolveClientTab('search')).toBe('performance');
  });

  it('maps legacy "analytics" alias to performance', () => {
    expect(resolveClientTab('analytics')).toBe('performance');
  });

  it('falls back to overview for retired inbox route aliases', () => {
    expect(resolveClientTab('approvals')).toBe('overview');
    expect(resolveClientTab('requests')).toBe('overview');
    expect(resolveClientTab('content')).toBe('overview');
    expect(resolveClientTab('schema-review')).toBe('overview');
  });

  it('passes through "brand"', () => {
    expect(resolveClientTab('brand')).toBe('brand');
  });

  it('passes through every known tab unchanged', () => {
    for (const tab of KNOWN_CLIENT_TABS) {
      expect(resolveClientTab(tab)).toBe(tab);
    }
  });

  it('KNOWN_CLIENT_TABS includes brand', () => {
    expect(KNOWN_CLIENT_TABS).toContain('brand');
  });

  it('KNOWN_CLIENT_TABS excludes search and analytics (they are aliases)', () => {
    expect(KNOWN_CLIENT_TABS).not.toContain('search');
    expect(KNOWN_CLIENT_TABS).not.toContain('analytics');
  });
});

// ── Component: loading skeleton ───────────────────────────────────────────────

describe('ClientDashboard — loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Make get never resolve so loading persists
    mockGet.mockReturnValue(new Promise(() => {}));
    mockGetOptional.mockResolvedValue(null);
  });

  it('shows skeleton elements while workspace data is loading', () => {
    renderDashboard();
    // The loading branch renders Skeleton elements — check for OverviewSkeleton's
    // presence via the overall loading structure (no header testid present yet)
    expect(screen.queryByTestId('client-header')).not.toBeInTheDocument();
    // Skeleton renders div elements; the main content area exists
    const main = document.querySelector('main');
    expect(main).toBeInTheDocument();
  });
});

// ── Component: error state ────────────────────────────────────────────────────

describe('ClientDashboard — error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOptional.mockResolvedValue(null);
  });

  it('shows error message when workspace fetch fails', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Failed to load dashboard')).toBeInTheDocument();
    });
  });

  it('shows a Try Again button on error', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    });
  });
});

// ── Component: auth gate ──────────────────────────────────────────────────────

describe('ClientDashboard — auth gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockGetOptional.mockResolvedValue(null); // no auto-auth, no auth-mode
  });

  it('shows ClientAuthGate when workspace requires a password and user is not authenticated', async () => {
    const ws = makeWorkspace({ requiresPassword: true });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('client-auth-gate')).toBeInTheDocument();
    });
  });

  it('does NOT show ClientAuthGate for open workspaces (no password required)', async () => {
    const ws = makeWorkspace({ requiresPassword: false });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('client-header')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('client-auth-gate')).not.toBeInTheDocument();
  });

  it('shows dashboard directly when session auth is already set in sessionStorage', async () => {
    sessionStorage.setItem('dash_auth_ws-test', 'true');
    const ws = makeWorkspace({ requiresPassword: true });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('client-header')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('client-auth-gate')).not.toBeInTheDocument();
  });
});

// ── Component: successful render ──────────────────────────────────────────────

describe('ClientDashboard — authenticated render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockGetOptional.mockResolvedValue(null);
  });

  it('renders the workspace name in the ClientHeader', async () => {
    const ws = makeWorkspace({ name: 'Rocket Labs' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      // Name appears in both the mocked header and PageHeader subtitle
      expect(screen.getAllByText('Rocket Labs').length).toBeGreaterThan(0);
    });
    expect(screen.getByTestId('client-header')).toBeInTheDocument();
  });

  it('renders the PageHeader title from the active tab label', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    // default tab is overview → label is "Insights"
    renderDashboard({ initialTab: 'overview' });

    await waitFor(() => {
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });
  });

  it('renders the powered-by footer', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Powered by/i)).toBeInTheDocument();
    });
  });

  it('forwards WORKSPACE_UPDATED payload data into centralized client invalidation', async () => {
    mockGet.mockResolvedValue(makeWorkspace());
    const { queryClient } = renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('client-header')).toBeInTheDocument();
    });

    const subscription = [...vi.mocked(useWorkspaceEvents).mock.calls]
      .reverse()
      .find(([subscribedWorkspaceId]) => subscribedWorkspaceId === 'ws-test');
    const workspaceUpdated = subscription?.[1][WS_EVENTS.WORKSPACE_UPDATED];
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    expect(workspaceUpdated).toBeTypeOf('function');
    act(() => workspaceUpdated?.({ googleConnectionChanged: true }));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.client.intelligence('ws-test'),
    });
  });
});

// ── Component: tab rendering ──────────────────────────────────────────────────

describe('ClientDashboard — tab content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockGetOptional.mockResolvedValue(null);
  });

  it('renders the Overview tab by default', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
    });
  });

  it('renders the Health tab when initialTab is "health"', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    renderDashboard({ initialTab: 'health' });

    await waitFor(() => {
      expect(screen.getByTestId('health-tab')).toBeInTheDocument();
    });
  });

  it('renders the Plans tab when initialTab is "plans"', async () => {
    const ws = makeWorkspace({ tier: 'free' });
    mockGet.mockResolvedValue(ws);

    renderDashboard({ initialTab: 'plans' });

    await waitFor(() => {
      expect(screen.getByTestId('plans-tab')).toBeInTheDocument();
    });
  });

  it('renders performance tab for legacy "search" alias', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    renderDashboard({ initialTab: 'search' });

    await waitFor(() => {
      expect(screen.getByTestId('performance-tab')).toBeInTheDocument();
    });
  });

  it('renders performance tab for legacy "analytics" alias', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    renderDashboard({ initialTab: 'analytics' });

    await waitFor(() => {
      expect(screen.getByTestId('performance-tab')).toBeInTheDocument();
    });
  });

  it('falls back to overview for an unknown tab segment', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    renderDashboard({ initialTab: 'does-not-exist' });

    await waitFor(() => {
      expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
    });
  });
});

describe('ClientDashboard — brand tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockGetOptional.mockResolvedValue(null);
  });

  it('renders brand tab when selected directly', async () => {
    const ws = makeWorkspace({ tier: 'premium' });
    mockGet.mockResolvedValue(ws);

    renderDashboard({ initialTab: 'brand' });

    await waitFor(() => {
      expect(screen.getByTestId('brand-tab')).toBeInTheDocument();
    });
  });
});

// ── Component: trial banners ──────────────────────────────────────────────────

describe('ClientDashboard — trial banners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mockGetOptional.mockResolvedValue(null);
  });

  it('shows a countdown banner when trial has 5 days remaining', async () => {
    const ws = makeWorkspace({ isTrial: true, trialDaysRemaining: 5, trialEndsAt: '2026-06-16T00:00:00.000Z', tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/5 days/i)).toBeInTheDocument();
    });
  });

  it('does NOT show a countdown banner when trial has 6 days remaining', async () => {
    const ws = makeWorkspace({ isTrial: true, trialDaysRemaining: 6, tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('client-header')).toBeInTheDocument();
    });
    expect(screen.queryByText(/days left on your Growth trial/i)).not.toBeInTheDocument();
  });

  it('shows singular "day" when exactly 1 day remains', async () => {
    const ws = makeWorkspace({ isTrial: true, trialDaysRemaining: 1, trialEndsAt: '2026-06-12T00:00:00.000Z', tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/1 day\b/i)).toBeInTheDocument();
    });
  });

  it('opens Plans from the trial countdown CTA', async () => {
    const ws = makeWorkspace({ isTrial: true, trialDaysRemaining: 5, trialEndsAt: '2026-06-16T00:00:00.000Z', tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/5 days/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /view plans/i }));

    expect(navigateMock).toHaveBeenCalledWith('/client/ws-test/plans');
  });

  it('dismisses the trial countdown banner per workspace and trial end date', async () => {
    const ws = makeWorkspace({ isTrial: true, trialDaysRemaining: 5, trialEndsAt: '2026-06-16T00:00:00.000Z', tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    const view = renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/5 days/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /dismiss trial reminder/i }));

    expect(screen.queryByText(/5 days/i)).not.toBeInTheDocument();
    expect(localStorage.getItem('client-trial-banner-dismissed:ws-test:2026-06-16T00:00:00.000Z')).toBe('1');

    view.unmount();
    mockGet.mockResolvedValue(ws);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('client-header')).toBeInTheDocument();
    });
    expect(screen.queryByText(/5 days/i)).not.toBeInTheDocument();
  });

  it('shows "trial has ended" banner when trialDaysRemaining is 0', async () => {
    const ws = makeWorkspace({ isTrial: true, trialDaysRemaining: 0, tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/trial has ended/i)).toBeInTheDocument();
    });
  });

  it('does NOT show trial banner when workspace is not on trial', async () => {
    const ws = makeWorkspace({ isTrial: false, tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('client-header')).toBeInTheDocument();
    });
    expect(screen.queryByText(/trial has ended/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/days left on your Growth trial/i)).not.toBeInTheDocument();
  });

  it('does NOT show trial banners in betaMode', async () => {
    const ws = makeWorkspace({ isTrial: true, trialDaysRemaining: 3, tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard({ betaMode: true });

    await waitFor(() => {
      expect(screen.getByTestId('client-header')).toBeInTheDocument();
    });
    expect(screen.queryByText(/days left/i)).not.toBeInTheDocument();
  });

  it('does NOT show trial banners for external billing workspaces', async () => {
    const ws = makeWorkspace({ isTrial: true, trialDaysRemaining: 3, tier: 'growth', billingMode: 'external' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('client-header')).toBeInTheDocument();
    });
    expect(screen.queryByText(/days left/i)).not.toBeInTheDocument();
  });
});

// ── Component: SeoCartDrawer visibility ───────────────────────────────────────

describe('ClientDashboard — SeoCartDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockGetOptional.mockResolvedValue(null);
  });

  it('renders SeoCartDrawer in normal mode', async () => {
    const ws = makeWorkspace({ billingMode: 'platform' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('seo-cart-drawer')).toBeInTheDocument();
    });
  });

  it('does NOT render SeoCartDrawer in betaMode', async () => {
    const ws = makeWorkspace({ billingMode: 'platform' });
    mockGet.mockResolvedValue(ws);

    renderDashboard({ betaMode: true });

    await waitFor(() => {
      expect(screen.getByTestId('client-header')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('seo-cart-drawer')).not.toBeInTheDocument();
  });

  it('does NOT render SeoCartDrawer when billingMode is external', async () => {
    const ws = makeWorkspace({ billingMode: 'external' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('client-header')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('seo-cart-drawer')).not.toBeInTheDocument();
  });
});

// ── Component: auto-auth via JWT cookie ───────────────────────────────────────

describe('ClientDashboard — JWT auto-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('auto-authenticates and renders dashboard when /api/public/client-me returns a user', async () => {
    const ws = makeWorkspace({ requiresPassword: true });
    mockGet.mockResolvedValue(ws);
    mockGetOptional.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('client-me')) {
        return Promise.resolve({ user: { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'editor' } });
      }
      return Promise.resolve(null);
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('client-header')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('client-auth-gate')).not.toBeInTheDocument();
  });
});

// ── R1-A → R1-B seam: impactBandsByCheck prop flow ───────────────────────────
//
// Asserts that ClientDashboard builds the per-check impact map from the
// client recommendations and passes it through to HealthTab.

describe('ClientDashboard — impactBandsByCheck wiring (R1 seam)', () => {
  const mockUseRecommendations = vi.mocked(useRecommendations);

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockGetOptional.mockResolvedValue(null);
  });

  it('passes impactBandsByCheck to HealthTab derived from audit-sourced recs', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    // Stub two audit recs with impactBand — one with audit: prefix, one site-wide
    mockUseRecommendations.mockReturnValue({
      recs: [
        {
          id: 'rec-1',
          workspaceId: 'ws-test',
          priority: 'fix_now',
          type: 'metadata',
          title: 'Fix titles',
          description: 'desc',
          insight: 'insight',
          impact: 'high',
          effort: 'low',
          impactScore: 80,
          source: 'audit:title',
          affectedPages: ['/home'],
          trafficAtRisk: 200,
          impressionsAtRisk: 1000,
          estimatedGain: 'Better rankings',
          actionType: 'purchase',
          status: 'pending',
          createdAt: '2026-06-01T00:00:00Z',
          updatedAt: '2026-06-01T00:00:00Z',
          impactBand: { band: 'medium', monthlyRangeUsd: [100, 200] },
        },
        {
          id: 'rec-2',
          workspaceId: 'ws-test',
          priority: 'fix_soon',
          type: 'schema',
          title: 'Add schema',
          description: 'desc',
          insight: 'insight',
          impact: 'medium',
          effort: 'medium',
          impactScore: 55,
          source: 'audit:structured-data',
          affectedPages: ['/about'],
          trafficAtRisk: 50,
          impressionsAtRisk: 200,
          estimatedGain: 'Richer SERP',
          actionType: 'purchase',
          status: 'pending',
          createdAt: '2026-06-01T00:00:00Z',
          updatedAt: '2026-06-01T00:00:00Z',
          impactBand: { band: 'low', monthlyRangeUsd: [30, 60] },
        },
      ],
      loaded: true,
      forPage: vi.fn(),
      ofType: vi.fn(),
      forPageAndType: vi.fn(),
    });

    renderDashboard({ initialTab: 'health' });

    await waitFor(() => {
      expect(screen.getByTestId('health-tab')).toBeInTheDocument();
    });

    const healthTab = screen.getByTestId('health-tab');
    const rawBands = healthTab.getAttribute('data-impact-bands');
    expect(rawBands).not.toBeNull();
    const bands = JSON.parse(rawBands!);
    expect(bands.title).toEqual({ band: 'medium', monthlyRangeUsd: [100, 200] });
    expect(bands['structured-data']).toEqual({ band: 'low', monthlyRangeUsd: [30, 60] });
  });

  it('passes an empty impactBandsByCheck when recs have no audit source', async () => {
    const ws = makeWorkspace();
    mockGet.mockResolvedValue(ws);

    mockUseRecommendations.mockReturnValue({
      recs: [
        {
          id: 'rec-1',
          workspaceId: 'ws-test',
          priority: 'fix_soon',
          type: 'content',
          title: 'Content gap',
          description: 'desc',
          insight: 'insight',
          impact: 'medium',
          effort: 'medium',
          impactScore: 40,
          source: 'strategy:content-gap',
          affectedPages: [],
          trafficAtRisk: 0,
          impressionsAtRisk: 0,
          estimatedGain: 'More traffic',
          actionType: 'content_creation',
          status: 'pending',
          createdAt: '2026-06-01T00:00:00Z',
          updatedAt: '2026-06-01T00:00:00Z',
          impactBand: { band: 'medium', monthlyRangeUsd: [80, 160] },
        },
      ],
      loaded: true,
      forPage: vi.fn(),
      ofType: vi.fn(),
      forPageAndType: vi.fn(),
    });

    renderDashboard({ initialTab: 'health' });

    await waitFor(() => {
      expect(screen.getByTestId('health-tab')).toBeInTheDocument();
    });

    const healthTab = screen.getByTestId('health-tab');
    // data-impact-bands attr should be absent (empty object → adapter renders undefined)
    // OR be an empty object — either is acceptable; both mean "no impact for any check"
    const rawBands = healthTab.getAttribute('data-impact-bands');
    if (rawBands !== null) {
      expect(JSON.parse(rawBands)).toEqual({});
    }
  });
});

// ── Rules of Hooks: loading → loaded hook-count guard ─────────────────────────
//
// ClientDashboard calls ~40 hooks unconditionally and then performs several
// early returns (`if (loading) return`, `if (error || !ws) return`, the
// auth-gate and email-gate returns). `loading` starts `true` and flips to
// `false` once useClientWorkspaceBootstrap resolves the workspace, so the
// component renders at least twice. Because every hook sits BEFORE the early
// returns, the loading=true and loading=false renders must call the same number
// of hooks. A hook accidentally placed AFTER any early return would execute only
// on the loading=false render, change the hook count between renders, and crash
// the dashboard with React's "Rendered more hooks than during the previous
// render." invariant (the exact failure mode Strategy v2 Phase 6b risked when it
// added `useFeatureFlag('strategy-command-center')` next to the early returns).
//
// The other suites in this file mock useFeatureFlag to a no-op plain function,
// which consumes ZERO React hook slots — so they can never observe a hook-count
// change and a misplaced hook stays invisible to them. This test instead drives
// the REAL loading=true → false transition on a single component instance with
// React's hook-count check active, so any future (real) hook placed after an
// early return fails here. Keeping useFeatureFlag mocked is fine: the guard
// protects against the next real hook, whatever it is.
describe('ClientDashboard — Rules of Hooks (loading→loaded hook count)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mockGetOptional.mockResolvedValue(null);
  });

  it('runs the full hook list across a real loading→loaded transition without a hook-count error', async () => {
    // Real bootstrap, driven by the mocked workspace fetch — NOT a mocked
    // `loading` flag. `loading` starts true; once useClientWorkspaceBootstrap
    // resolves the workspace it flips to false and the SAME instance re-renders.
    const ws = makeWorkspace({ requiresPassword: false });
    mockGet.mockResolvedValue(ws);

    // Render 1: loading=true. Execution stops at `if (loading) return`, so only
    // the hooks BEFORE that early return have run and the (mocked) ClientHeader
    // — rendered only past the early returns — is absent.
    renderDashboard();
    expect(screen.queryByTestId('client-header')).not.toBeInTheDocument();

    // Render 2: loading=false runs the FULL hook list past every early return.
    // If a hook were placed after an early return it would run only on this
    // render, change the hook count, and crash with "Rendered more hooks than
    // during the previous render." — so the dashboard would never commit and
    // this assertion would fail. Reaching the committed ClientHeader proves the
    // loading and loaded renders called the same number of hooks.
    await waitFor(() => {
      expect(screen.getByTestId('client-header')).toBeInTheDocument();
    });
  });
});
