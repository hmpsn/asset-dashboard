// tests/component/WorkspaceHome.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { WorkspaceHome } from '../../src/components/WorkspaceHome';

// ── Router mocks ──────────────────────────────────────────────────────────────
const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// ── Heavy sub-components stubs ────────────────────────────────────────────────
vi.mock('../../src/components/client/InsightsEngine', () => ({
  InsightsEngine: () => <div data-testid="insights-engine" />,
}));

vi.mock('../../src/components/admin/BriefingReviewQueue', () => ({
  BriefingReviewQueue: () => <div data-testid="briefing-review-queue" />,
}));

vi.mock('../../src/components/AnomalyAlerts', () => ({
  AnomalyAlerts: () => <div data-testid="anomaly-alerts" />,
}));

vi.mock('../../src/components/workspace-home', () => ({
  SeoWorkStatus: () => <div data-testid="seo-work-status" />,
  ActivityFeed: () => <div data-testid="activity-feed" />,
  RankingsSnapshot: () => <div data-testid="rankings-snapshot" />,
  ActiveRequestsAnnotations: () => <div data-testid="active-requests-annotations" />,
  SeoChangeImpact: () => <div data-testid="seo-change-impact" />,
  WeeklyAccomplishments: () => <div data-testid="weekly-accomplishments" />,
}));

// WorkspaceHealthBadge was removed from WorkspaceHome in T2.2 (design-cleanup Wave 2).
// The Site Health StatCard + MetricRing is now the single canonical health representation.

vi.mock('../../src/components/client/useCart', () => ({
  CartProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Admin hooks ───────────────────────────────────────────────────────────────
vi.mock('../../src/hooks/admin', () => ({
  useWorkspaceHomeData: vi.fn(),
  useAdminROI: vi.fn(),
  useWorkspaceIntelligence: vi.fn(),
  useAnomalyAlerts: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock('../../src/hooks/usePageEditStates', () => ({
  usePageEditStates: vi.fn(),
}));

vi.mock('../../src/hooks/useAuditSummary', () => ({
  useAuditSummary: vi.fn(),
}));

// ── Feature flags ─────────────────────────────────────────────────────────────
vi.mock('../../src/components/ui/FeatureFlag', () => ({
  FeatureFlag: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getAdminHooks() {
  return import('../../src/hooks/admin');
}

async function getAuditHook() {
  return import('../../src/hooks/useAuditSummary');
}

async function getPageEditHook() {
  return import('../../src/hooks/usePageEditStates');
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderWorkspaceHome(props?: Partial<React.ComponentProps<typeof WorkspaceHome>>) {
  const defaults = {
    workspaceId: 'ws1',
    workspaceName: 'Acme Corp',
    webflowSiteId: 'wf-site-1',
    webflowSiteName: 'acme.webflow.io',
    gscPropertyUrl: 'https://acme.com',
    ga4PropertyId: 'G-12345',
  };
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={['/ws/ws1']}>
        <WorkspaceHome {...defaults} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Default mock data ─────────────────────────────────────────────────────────
const mockHomeData = {
  searchData: { totalClicks: 1200, totalImpressions: 15000, avgCtr: 0.08 },
  ga4Data: { totalUsers: 3400, totalSessions: 4200, newUserPercentage: 62 },
  comparison: { users: { current: 3400, previous: 3000 } },
  ranks: [
    { query: 'seo tool', position: 3, previousPosition: 5, change: 2 },
    { query: 'analytics', position: 8, previousPosition: 6, change: -2 },
  ],
  requests: [],
  contentRequests: [],
  activity: [
    { id: 'a1', type: 'audit', title: 'SEO audit completed', createdAt: new Date().toISOString() },
  ],
  annotations: [],
  churnSignals: [],
  workOrders: [],
  contentPipeline: null,
  contentVelocity: null,
  contentDecay: null,
  weeklySummary: null,
};

const mockAudit = { id: 'a1', siteScore: 82, errors: 3, warnings: 7, totalPages: 50, infos: 10, previousScore: 78 };

const mockPageEditSummary = { clean: 10, issueDetected: 0, fixProposed: 0, inReview: 0, approved: 0, rejected: 0, live: 10, total: 10 };

describe('WorkspaceHome', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    navigateMock.mockReset();

    const adminHooks = await getAdminHooks();
    vi.mocked(adminHooks.useWorkspaceHomeData).mockReturnValue({
      data: mockHomeData,
      isLoading: false,
      isFetching: false,
      dataUpdatedAt: Date.now(),
    } as ReturnType<typeof adminHooks.useWorkspaceHomeData>);

    vi.mocked(adminHooks.useAdminROI).mockReturnValue({
      data: { organicTrafficValue: 5000, adSpendEquivalent: 3000 },
    } as ReturnType<typeof adminHooks.useAdminROI>);

    vi.mocked(adminHooks.useWorkspaceIntelligence).mockReturnValue({
      data: null,
    } as ReturnType<typeof adminHooks.useWorkspaceIntelligence>);

    const auditHook = await getAuditHook();
    vi.mocked(auditHook.useAuditSummary).mockReturnValue({
      audit: mockAudit,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    const pageEditHook = await getPageEditHook();
    vi.mocked(pageEditHook.usePageEditStates).mockReturnValue({
      summary: mockPageEditSummary,
      states: {},
      loading: false,
      refresh: vi.fn(),
    });
  });

  it('renders without crash with mocked workspace data', () => {
    renderWorkspaceHome();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('shows the workspace name as the page title', () => {
    renderWorkspaceHome();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('shows the webflow site name as subtitle', () => {
    renderWorkspaceHome();
    expect(screen.getByText('acme.webflow.io')).toBeInTheDocument();
  });

  it('shows loading spinner when data is loading', async () => {
    const adminHooks = await getAdminHooks();
    vi.mocked(adminHooks.useWorkspaceHomeData).mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      dataUpdatedAt: undefined,
    } as ReturnType<typeof adminHooks.useWorkspaceHomeData>);
    renderWorkspaceHome();
    // The Loader2 spinner is rendered during loading
    const container = document.querySelector('.animate-spin');
    expect(container).toBeTruthy();
  });

  it('shows search clicks stat card when GSC data is present', () => {
    renderWorkspaceHome();
    expect(screen.getByText('Search Clicks')).toBeInTheDocument();
  });

  it('shows formatted click count from search data', () => {
    renderWorkspaceHome();
    expect(screen.getByText('1.2K')).toBeInTheDocument();
  });

  it('shows GA4 users stat card when ga4 data is present', () => {
    renderWorkspaceHome();
    expect(screen.getByText('Users')).toBeInTheDocument();
  });

  it('shows rank changes stat card', () => {
    renderWorkspaceHome();
    expect(screen.getByText('Rank Changes')).toBeInTheDocument();
  });

  it('shows traffic value stat card when ROI data is present', () => {
    renderWorkspaceHome();
    expect(screen.getByText('Traffic Value')).toBeInTheDocument();
  });

  it('shows workspace section tabs without the retired Meeting Brief tab', () => {
    renderWorkspaceHome();
    expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /activity/i })).toBeInTheDocument();
    expect(screen.queryByText('Meeting Brief')).not.toBeInTheDocument();
  });

  it('shows Refresh button', () => {
    renderWorkspaceHome();
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  it('shows Settings → link', () => {
    renderWorkspaceHome();
    expect(screen.getByText('Settings →')).toBeInTheDocument();
  });

  it('shows activity feed sub-component in the Activity tab', () => {
    // FIX 3 (Wave 2): Activity Feed moved to Activity tab to de-dup from Overview tab
    renderWorkspaceHome();
    const activityTab = screen.getByRole('tab', { name: /activity/i });
    fireEvent.click(activityTab);
    expect(screen.getByTestId('activity-feed')).toBeInTheDocument();
  });

  it('shows rankings snapshot sub-component in the Activity tab', () => {
    // FIX 3 (Wave 2): Rankings Snapshot moved to Activity tab to de-dup from Overview tab
    renderWorkspaceHome();
    const activityTab = screen.getByRole('tab', { name: /activity/i });
    fireEvent.click(activityTab);
    expect(screen.getByTestId('rankings-snapshot')).toBeInTheDocument();
  });

  it('shows anomaly alerts sub-component', () => {
    renderWorkspaceHome();
    expect(screen.getByTestId('anomaly-alerts')).toBeInTheDocument();
  });

  it('shows setup suggestions in NeedsAttention when integrations are missing and checklist is dismissed', () => {
    // Wave 2 (T2.1): setup items surface in NeedsAttention only when the checklist is dismissed.
    // Simulate dismissed state so the component surfaces them in the attention list.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (String(key).includes('onboarding_checklist_dismissed')) return '1';
      return null;
    });
    renderWorkspaceHome({ webflowSiteId: undefined, gscPropertyUrl: undefined, ga4PropertyId: undefined });
    // NeedsAttention renders title as "Needs Attention · N" when showCount=true — use partial match
    expect(screen.getByText(/Needs Attention/)).toBeInTheDocument();
  });

  // T2.2 (design-cleanup Wave 2): WorkspaceHealthBadge was removed. Health is now
  // represented solely by the Site Health StatCard + MetricRing. The compositeHealthScore
  // from intel no longer drives a separate badge on this screen.
  it('does not render a workspace-health-badge element', async () => {
    const adminHooks = await getAdminHooks();
    vi.mocked(adminHooks.useWorkspaceIntelligence).mockReturnValue({
      data: {
        clientSignals: { compositeHealthScore: 78 },
      },
    } as ReturnType<typeof adminHooks.useWorkspaceIntelligence>);
    renderWorkspaceHome();
    expect(screen.queryByTestId('workspace-health-badge')).not.toBeInTheDocument();
  });

  it('shows "Site Health" stat card as the canonical health representation', () => {
    renderWorkspaceHome();
    expect(screen.getByText('Site Health')).toBeInTheDocument();
  });

  it('shows weekly accomplishments when weekly summary is present', async () => {
    const adminHooks = await getAdminHooks();
    vi.mocked(adminHooks.useWorkspaceHomeData).mockReturnValue({
      data: { ...mockHomeData, weeklySummary: { published: 3, briefs: 2, resolved: 1, week: 'This week' } },
      isLoading: false,
      isFetching: false,
      dataUpdatedAt: Date.now(),
    } as ReturnType<typeof adminHooks.useWorkspaceHomeData>);
    renderWorkspaceHome();
    expect(screen.getByTestId('weekly-accomplishments')).toBeInTheDocument();
  });

  it('does not crash when no webflow site is linked', () => {
    renderWorkspaceHome({ webflowSiteId: undefined, webflowSiteName: undefined });
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Workspace Dashboard')).toBeInTheDocument();
  });

  it('shows content decay stat card when decay data has decaying pages', async () => {
    const adminHooks = await getAdminHooks();
    vi.mocked(adminHooks.useWorkspaceHomeData).mockReturnValue({
      data: { ...mockHomeData, contentDecay: { totalDecaying: 5, critical: 2, warning: 3 } },
      isLoading: false,
      isFetching: false,
      dataUpdatedAt: Date.now(),
    } as ReturnType<typeof adminHooks.useWorkspaceHomeData>);
    renderWorkspaceHome();
    expect(screen.getByText('Content Decay')).toBeInTheDocument();
  });
});
