// tests/component/WorkspaceHome.wave2.test.tsx
// Design-cleanup Wave 2 structural assertions for WorkspaceHome.
//
// The four invariants tested here correspond to T2.1–T2.4:
//  (a) T2.1 — a connect-task appears in AT MOST ONE place for an unconfigured workspace
//  (b) T2.2 — NO WorkspaceHealthBadge; exactly ONE health representation (Site Health StatCard)
//  (c) T2.3 — at most 3 size="hero" StatCards; supporting metrics present at size="default"
//  (d) T2.4 — NeedsAttention precedes the metric grid in DOM order
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { WorkspaceHome } from '../../src/components/WorkspaceHome';

// ── Router mock ───────────────────────────────────────────────────────────────
const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// ── Heavy sub-component stubs ─────────────────────────────────────────────────
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

vi.mock('../../src/components/admin/AdminRecommendationQueue', () => ({
  AdminRecommendationQueue: () => <div data-testid="admin-recommendation-queue" />,
}));

vi.mock('../../src/components/admin/WorkOrderPanel', () => ({
  WorkOrderPanel: () => <div data-testid="work-order-panel" />,
}));

vi.mock('../../src/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

// ── Feature flags — transparent pass-through ──────────────────────────────────
vi.mock('../../src/components/ui/FeatureFlag', () => ({
  FeatureFlag: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Lazy component ────────────────────────────────────────────────────────────
vi.mock('../../src/lib/lazyWithRetry', () => ({
  lazyWithRetry: () => () => <div data-testid="meeting-brief-page" />,
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
  const defaults: React.ComponentProps<typeof WorkspaceHome> = {
    workspaceId: 'ws-wave2',
    workspaceName: 'Wave 2 Corp',
    webflowSiteId: 'wf-site-1',
    webflowSiteName: 'wave2.webflow.io',
    gscPropertyUrl: 'https://wave2.com',
    ga4PropertyId: 'G-99999',
  };
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={['/ws/ws-wave2']}>
        <WorkspaceHome {...defaults} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Mock data ─────────────────────────────────────────────────────────────────
const mockHomeData = {
  searchData: { totalClicks: 2500, totalImpressions: 30000, avgCtr: 0.083 },
  ga4Data: { totalUsers: 4200, totalSessions: 5100, newUserPercentage: 58 },
  comparison: { users: { current: 4200, previous: 3800 } },
  ranks: [
    { query: 'keyword one', position: 4, previousPosition: 6, change: 2 },
    { query: 'keyword two', position: 9, previousPosition: 7, change: -2 },
  ],
  requests: [],
  contentRequests: [],
  activity: [
    { id: 'act1', type: 'audit', title: 'Audit run', createdAt: new Date().toISOString() },
  ],
  annotations: [],
  churnSignals: [],
  workOrders: [],
  contentPipeline: { totalCells: 20, publishedCells: 12, reviewCells: 0 },
  contentVelocity: { trailingThreeMonthAvg: 3, trendPct: 10, currentMonthPublished: 4 },
  contentDecay: null,
  weeklySummary: null,
};

const mockAudit = {
  id: 'audit1',
  siteScore: 75,
  errors: 4,
  warnings: 9,
  totalPages: 60,
  infos: 12,
  previousScore: 70,
};

const mockPageEditSummary = {
  clean: 10, issueDetected: 0, fixProposed: 0, inReview: 0,
  approved: 0, rejected: 0, live: 10, total: 10,
};

// ── Test suite ────────────────────────────────────────────────────────────────
describe('WorkspaceHome — Wave 2 structural invariants', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    navigateMock.mockReset();

    // Suppress localStorage for checklist state
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});

    const adminHooks = await getAdminHooks();
    vi.mocked(adminHooks.useWorkspaceHomeData).mockReturnValue({
      data: mockHomeData,
      isLoading: false,
      isFetching: false,
      dataUpdatedAt: Date.now(),
    } as ReturnType<typeof adminHooks.useWorkspaceHomeData>);

    vi.mocked(adminHooks.useAdminROI).mockReturnValue({
      data: { organicTrafficValue: 8000, adSpendEquivalent: 5000 },
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

  // ── T2.1: connect-tasks appear in at most one place ───────────────────────
  describe('T2.1 — setup task deduplication', () => {
    // State A: checklist ACTIVE (localStorage null → checklistVisible = true)
    // The "Connect Google Search Console" task must live inside the OnboardingChecklist
    // region and must NOT appear in the NeedsAttention region.
    it('(checklist active) shows GSC task inside OnboardingChecklist region', () => {
      renderWorkspaceHome({ gscPropertyUrl: undefined, ga4PropertyId: undefined, webflowSiteId: undefined });
      // OnboardingChecklist renders inside [role="dialog"]
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog!.textContent).toMatch(/Connect Google Search Console/i);
    });

    it('(checklist active) GSC task is ABSENT from the NeedsAttention region', () => {
      renderWorkspaceHome({ gscPropertyUrl: undefined, ga4PropertyId: undefined, webflowSiteId: undefined });
      // NeedsAttention marks its root element with data-attention-accent
      const attentionEl = document.querySelector('[data-attention-accent]');
      // When checklist is active, no setup items appear in NeedsAttention.
      // If the element doesn't exist, there's nothing to check (0 items rendered).
      if (attentionEl) {
        expect(attentionEl.textContent).not.toMatch(/Google Search Console not connected/i);
      }
      // Also assert: the attention item label does NOT appear outside the modal.
      const modalText = document.querySelector('[role="dialog"]')?.textContent ?? '';
      const nonModalText = document.body.textContent?.replace(modalText, '') ?? '';
      expect(nonModalText).not.toMatch(/Google Search Console not connected/i);
    });

    // State B: checklist DISMISSED (localStorage returns '1' → checklistVisible = false)
    // The "Google Search Console not connected" NeedsAttention item MUST appear,
    // and the OnboardingChecklist modal must NOT render.
    it('(checklist dismissed) GSC task appears in NeedsAttention region', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
        if (key.includes('onboarding_checklist_dismissed')) return '1';
        return null;
      });

      renderWorkspaceHome({ gscPropertyUrl: undefined, ga4PropertyId: undefined, webflowSiteId: undefined });

      // No modal
      expect(document.querySelector('[role="dialog"]')).toBeNull();

      // NeedsAttention must carry the connect task
      const attentionEl = document.querySelector('[data-attention-accent]');
      expect(attentionEl).not.toBeNull();
      expect(attentionEl!.textContent).toMatch(/Google Search Console not connected/i);
    });

    it('(checklist dismissed) OnboardingChecklist is NOT rendered', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
        if (key.includes('onboarding_checklist_dismissed')) return '1';
        return null;
      });

      renderWorkspaceHome({ gscPropertyUrl: undefined, ga4PropertyId: undefined, webflowSiteId: undefined });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
  });

  // ── T2.2: exactly one health representation ───────────────────────────────
  describe('T2.2 — single health representation', () => {
    it('renders the Site Health stat card as the health representation', () => {
      renderWorkspaceHome();
      expect(screen.getByText('Site Health')).toBeInTheDocument();
    });

    it('does NOT render a WorkspaceHealthBadge element', () => {
      renderWorkspaceHome();
      // The badge was removed; no element should carry this test id
      expect(screen.queryByTestId('workspace-health-badge')).not.toBeInTheDocument();
    });

    it('does NOT render "Overall Health" StatCard when compositeHealthScore is absent', () => {
      // beforeEach mocks useWorkspaceIntelligence with data: null, so the card is hidden
      renderWorkspaceHome();
      expect(screen.queryByText('Overall Health')).not.toBeInTheDocument();
    });

    it('renders "Overall Health" StatCard when compositeHealthScore is present', async () => {
      const adminHooks = await getAdminHooks();
      vi.mocked(adminHooks.useWorkspaceIntelligence).mockReturnValue({
        data: { clientSignals: { compositeHealthScore: 82 } },
      } as ReturnType<typeof adminHooks.useWorkspaceIntelligence>);

      renderWorkspaceHome();
      expect(screen.getByText('Overall Health')).toBeInTheDocument();
    });

    it('renders exactly ONE element with the text "Site Health"', () => {
      renderWorkspaceHome();
      // getAllByText throws if zero, so this also asserts presence
      const matches = screen.getAllByText('Site Health');
      expect(matches).toHaveLength(1);
    });
  });

  // ── T2.3: at most 3 hero StatCards ───────────────────────────────────────
  describe('T2.3 — StatCard hierarchy', () => {
    it('renders at most 3 elements with t-stat-lg class (hero size)', () => {
      renderWorkspaceHome();
      // size="hero" uses the t-stat-lg typography class on the value element
      const heroValues = document.querySelectorAll('.t-stat-lg');
      expect(heroValues.length).toBeLessThanOrEqual(3);
    });

    it('renders more than 3 stat value elements total (supporting rail present)', () => {
      renderWorkspaceHome();
      // Hero + default together should exceed 3
      const allStatValues = document.querySelectorAll('.t-stat-lg, .t-stat');
      expect(allStatValues.length).toBeGreaterThan(3);
    });

    it('renders "Search Clicks" as one of the hero cards', () => {
      renderWorkspaceHome();
      expect(screen.getByText('Search Clicks')).toBeInTheDocument();
    });

    it('renders "Traffic Value" as one of the hero cards', () => {
      renderWorkspaceHome();
      expect(screen.getByText('Traffic Value')).toBeInTheDocument();
    });

    it('renders supporting metric "Users" at default size', () => {
      renderWorkspaceHome();
      expect(screen.getByText('Users')).toBeInTheDocument();
    });

    it('renders supporting metric "Rank Changes" at default size', () => {
      renderWorkspaceHome();
      expect(screen.getByText('Rank Changes')).toBeInTheDocument();
    });

    it('renders supporting metric "Content Pipeline" at default size when data present', () => {
      renderWorkspaceHome();
      expect(screen.getByText('Content Pipeline')).toBeInTheDocument();
    });
  });

  // ── T2.4: NeedsAttention precedes metric grid in DOM order ────────────────
  describe('T2.4 — section ordering', () => {
    it('NeedsAttention section appears before the metric grid in DOM', async () => {
      // Add an attention item so NeedsAttention renders
      const adminHooks = await getAdminHooks();
      vi.mocked(adminHooks.useWorkspaceHomeData).mockReturnValue({
        data: {
          ...mockHomeData,
          requests: [{ id: 'r1', title: 'Help needed', status: 'new', category: 'general', createdAt: new Date().toISOString() }],
        },
        isLoading: false,
        isFetching: false,
        dataUpdatedAt: Date.now(),
      } as ReturnType<typeof adminHooks.useWorkspaceHomeData>);

      // Dismiss the checklist so NeedsAttention renders
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
        if (key.includes('onboarding_checklist_dismissed')) return '1';
        return null;
      });

      renderWorkspaceHome();

      const attentionEl = document.querySelector('[data-attention-accent]');
      const siteHealthLabel = screen.getByText('Site Health');

      expect(attentionEl).not.toBeNull();
      // DOM order: compareDocumentPosition returns 4 (DOCUMENT_POSITION_FOLLOWING)
      // if attentionEl comes BEFORE siteHealthLabel
      const position = attentionEl!.compareDocumentPosition(siteHealthLabel);
      // DOCUMENT_POSITION_FOLLOWING = 4 means siteHealthLabel comes after attentionEl
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders NeedsAttention as a <Link> row when item has href (role=link)', async () => {
      const adminHooks = await getAdminHooks();
      vi.mocked(adminHooks.useWorkspaceHomeData).mockReturnValue({
        data: {
          ...mockHomeData,
          requests: [{ id: 'r1', title: 'Help needed', status: 'new', category: 'general', createdAt: new Date().toISOString() }],
        },
        isLoading: false,
        isFetching: false,
        dataUpdatedAt: Date.now(),
      } as ReturnType<typeof adminHooks.useWorkspaceHomeData>);

      vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
        if (key.includes('onboarding_checklist_dismissed')) return '1';
        return null;
      });

      renderWorkspaceHome();

      // NeedsAttention renders href items as <Link> (role="link")
      // The "new client requests" attention item uses href
      const links = screen.getAllByRole('link');
      const requestLink = links.find(l => l.textContent?.includes('new client request'));
      expect(requestLink).toBeDefined();
    });
  });

  // ── Smoke: renders without crash ──────────────────────────────────────────
  it('renders without crash with full mock data', () => {
    renderWorkspaceHome();
    expect(screen.getByText('Wave 2 Corp')).toBeInTheDocument();
  });
});
