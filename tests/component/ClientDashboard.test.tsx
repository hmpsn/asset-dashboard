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
import { render, screen, waitFor, act } from '@testing-library/react';
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

vi.mock('../../src/hooks/useToast', () => ({
  useToast: vi.fn(() => ({
    toast: null,
    setToast: vi.fn(),
    clearToast: vi.fn(),
  })),
}));

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn(() => false),
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
  useClientPageKeywords: () => ({ data: null, isLoading: false, error: null }),
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
  HealthTab: () => <div data-testid="health-tab">Health</div>,
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
import {
  resolveClientTab,
  KNOWN_CLIENT_TABS,
} from '../../src/lib/client-dashboard-tab';
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
  return render(
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
}

// ── Pure function tests: resolveClientTab ────────────────────────────────────

describe('resolveClientTab', () => {
  it('returns overview for undefined input', () => {
    expect(resolveClientTab(undefined, false)).toBe('overview');
  });

  it('returns overview for null input', () => {
    expect(resolveClientTab(null, false)).toBe('overview');
  });

  it('returns overview for an empty string', () => {
    expect(resolveClientTab('', false)).toBe('overview');
  });

  it('returns overview for an unknown tab', () => {
    expect(resolveClientTab('completely-unknown-tab', false)).toBe('overview');
  });

  it('maps legacy "search" alias to performance', () => {
    expect(resolveClientTab('search', false)).toBe('performance');
  });

  it('maps legacy "analytics" alias to performance', () => {
    expect(resolveClientTab('analytics', false)).toBe('performance');
  });

  it('maps retired "schema-review" to inbox', () => {
    expect(resolveClientTab('schema-review', false)).toBe('inbox');
  });

  it('resolves "brand" to overview when feature flag is off', () => {
    expect(resolveClientTab('brand', false)).toBe('overview');
  });

  it('resolves "brand" to brand when feature flag is on', () => {
    expect(resolveClientTab('brand', true)).toBe('brand');
  });

  it('passes through every known tab unchanged (flag=false)', () => {
    const flaggedTabs = new Set(['brand']);
    for (const tab of KNOWN_CLIENT_TABS) {
      if (!flaggedTabs.has(tab)) {
        expect(resolveClientTab(tab, false)).toBe(tab);
      }
    }
  });

  it('passes through every known tab unchanged (flag=true)', () => {
    for (const tab of KNOWN_CLIENT_TABS) {
      expect(resolveClientTab(tab, true)).toBe(tab);
    }
  });

  it('KNOWN_CLIENT_TABS excludes brand (it is feature-flagged, not pass-through)', () => {
    expect(KNOWN_CLIENT_TABS).not.toContain('brand');
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

// ── Component: feature-flag gating ───────────────────────────────────────────

describe('ClientDashboard — feature flag gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockGetOptional.mockResolvedValue(null);
  });

  it('does NOT render brand tab when client-brand-section flag is false', async () => {
    const { useFeatureFlag } = await import('../../src/hooks/useFeatureFlag');
    vi.mocked(useFeatureFlag).mockReturnValue(false);

    const ws = makeWorkspace({ tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard({ initialTab: 'brand' });

    await waitFor(() => {
      // brand resolves to overview when flag is off
      expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('brand-tab')).not.toBeInTheDocument();
  });

  it('renders brand tab when client-brand-section flag is true', async () => {
    const { useFeatureFlag } = await import('../../src/hooks/useFeatureFlag');
    vi.mocked(useFeatureFlag).mockReturnValue(true);

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
    mockGetOptional.mockResolvedValue(null);
  });

  it('shows a countdown banner when trial has ≤10 days remaining', async () => {
    const ws = makeWorkspace({ isTrial: true, trialDaysRemaining: 5, tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/5 days/i)).toBeInTheDocument();
    });
  });

  it('shows singular "day" when exactly 1 day remains', async () => {
    const ws = makeWorkspace({ isTrial: true, trialDaysRemaining: 1, tier: 'growth' });
    mockGet.mockResolvedValue(ws);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/1 day\b/i)).toBeInTheDocument();
    });
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
