// tests/component/WorkspaceOverview-attention.test.tsx
//
// Component tests for the "Needs Attention" section of WorkspaceOverview.
//
// After Wave 1, NeedsAttention renders href-bearing rows as <Link> elements
// (role="link") not <button> elements. Navigation is asserted via href, not
// navigateMock. The ordering tests use link accessible names.
//
// Asserts:
//   1. Each attention item renders a link with the correct href.
//   2. Items are ordered by severity (priority) — most urgent first.
//   3. Workspace name (meta) attribution is rendered on each row.
//   4. ?tab= deep-link items carry the correct query string in the href.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Navigate mock ─────────────────────────────────────────────────────────────

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// ── Hook mocks ────────────────────────────────────────────────────────────────

vi.mock('../../src/hooks/useGlobalAdminEvents', () => ({
  useGlobalAdminEvents: vi.fn(),
}));

vi.mock('../../src/hooks/admin', () => ({
  useWorkspaceOverviewData: vi.fn(),
}));

// ── Static imports (must come AFTER vi.mock declarations) ─────────────────────

import type { WorkspaceOverviewData } from '../../src/hooks/admin/useWorkspaceOverview';
import { useWorkspaceOverviewData } from '../../src/hooks/admin';
import { WorkspaceOverview } from '../../src/components/WorkspaceOverview';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWorkspace(overrides: Partial<{
  id: string;
  name: string;
  webflowSiteId: string | null;
  webflowSiteName: string | null;
  hasGsc: boolean;
  hasGa4: boolean;
  hasPassword: boolean;
  tier: 'free' | 'growth' | 'premium';
  isTrial: boolean;
  trialDaysRemaining: number;
  audit: { score: number; totalPages: number; errors: number; warnings: number } | null;
  requests: { total: number; new: number; active: number; latestDate: string | null };
  approvals: { pending: number; total: number };
  contentRequests: { pending: number; inProgress: number; delivered: number; total: number };
  workOrders: { pending: number; total: number };
  churnSignals: { critical: number; warning: number };
  pageStates: { issueDetected: number; inReview: number; approved: number; rejected: number; live: number; total: number };
}> = {}) {
  return {
    id: 'ws-1',
    name: 'Acme Corp',
    webflowSiteId: 'site-1',
    webflowSiteName: 'Acme Site',
    hasGsc: false,
    hasGa4: false,
    hasPassword: true,
    tier: 'free' as const,
    isTrial: false,
    trialDaysRemaining: 0,
    audit: null,
    requests: { total: 0, new: 0, active: 0, latestDate: null },
    approvals: { pending: 0, total: 0 },
    contentRequests: { pending: 0, inProgress: 0, delivered: 0, total: 0 },
    workOrders: { pending: 0, total: 0 },
    churnSignals: { critical: 0, warning: 0 },
    pageStates: { issueDetected: 0, inReview: 0, approved: 0, rejected: 0, live: 0, total: 0 },
    ...overrides,
  };
}

function makeOverviewData(workspaces: ReturnType<typeof makeWorkspace>[]): WorkspaceOverviewData {
  return {
    workspaces,
    recentActivity: [],
    anomalies: [],
    presence: {},
    timeSaved: null,
  };
}

const mockUseWorkspaceOverviewData = useWorkspaceOverviewData as ReturnType<typeof vi.fn>;

function renderOverview() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WorkspaceOverview onSelectWorkspace={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Helper: find the NeedsAttention link whose accessible name includes a substring.
// NeedsAttention renders href rows as <Link> (role="link") after Wave 1.
function getAttentionLink(namePattern: RegExp) {
  return screen.getByRole('link', { name: namePattern });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkspaceOverview — Needs Attention section', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  // ── 1. New client requests ──────────────────────────────────────────────────

  it('renders a link for new client requests pointing to the requests page', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-1', name: 'Acme Corp', requests: { total: 2, new: 2, active: 0, latestDate: null } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.getByText('2 new client requests')).toBeDefined();
    expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1);

    // Wave 1: href-bearing rows render as <Link> (role="link")
    const link = getAttentionLink(/2 new client requests/i);
    expect(link.getAttribute('href')).toBe('/ws/ws-1/requests');
  });

  // ── 2. Pending approvals ────────────────────────────────────────────────────

  it('renders pending approvals link pointing to seo-editor', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-2', name: 'Globex', approvals: { pending: 3, total: 3 } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.getByText('3 pending approvals')).toBeDefined();
    expect(screen.getAllByText('Globex').length).toBeGreaterThanOrEqual(1);

    const link = getAttentionLink(/3 pending approvals/i);
    expect(link.getAttribute('href')).toBe('/ws/ws-2/seo-editor');
  });

  // ── 3. Content briefs — ?tab=briefs deep-link ────────────────────────────────

  it('renders content briefs link with ?tab=briefs deep-link', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-3', name: 'Initech', contentRequests: { pending: 1, inProgress: 0, delivered: 0, total: 1 } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.getByText('1 content brief awaiting review')).toBeDefined();
    expect(screen.getAllByText('Initech').length).toBeGreaterThanOrEqual(1);

    const link = getAttentionLink(/1 content brief/i);
    // Must include ?tab=briefs (ContentPipeline reads searchParams.get('tab'))
    expect(link.getAttribute('href')).toBe('/ws/ws-3/content-pipeline?tab=briefs');
  });

  // ── 4. No site linked — ?tab=connections deep-link ──────────────────────────

  it('renders no-site-linked link with ?tab=connections deep-link', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-4', name: 'Umbrella', webflowSiteId: null, webflowSiteName: null }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.getAllByText(/No site linked/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Umbrella').length).toBeGreaterThanOrEqual(1);

    const link = getAttentionLink(/No site linked/i);
    // Must include ?tab=connections (WorkspaceSettings reads searchParams.get('tab'))
    expect(link.getAttribute('href')).toBe('/ws/ws-4/workspace-settings?tab=connections');
  });

  // ── 5. Low health score — links to seo-audit ────────────────────────────────

  it('renders low health score link pointing to seo-audit', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-5', name: 'Nakatomi', audit: { score: 42, totalPages: 10, errors: 5, warnings: 3 } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.getByText(/Health score 42/i)).toBeDefined();
    expect(screen.getAllByText('Nakatomi').length).toBeGreaterThanOrEqual(1);

    const link = getAttentionLink(/Health score 42/i);
    expect(link.getAttribute('href')).toBe('/ws/ws-5/seo-audit');
  });

  // ── 6. Rejected changes — links to seo-editor ───────────────────────────────

  it('renders rejected changes link pointing to seo-editor', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({
          id: 'ws-6', name: 'Stark',
          pageStates: { issueDetected: 0, inReview: 0, approved: 0, rejected: 2, live: 0, total: 2 },
        }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.getByText('2 rejected changes need revision')).toBeDefined();
    expect(screen.getAllByText('Stark').length).toBeGreaterThanOrEqual(1);

    const link = getAttentionLink(/2 rejected changes/i);
    expect(link.getAttribute('href')).toBe('/ws/ws-6/seo-editor');
  });

  // ── 7. Severity ordering ────────────────────────────────────────────────────

  it('displays critical-churn before warning-churn even when warning workspace is inserted first', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-warn', name: 'WarningCo', churnSignals: { critical: 0, warning: 2 } }),
        makeWorkspace({ id: 'ws-crit', name: 'CriticalCo', churnSignals: { critical: 1, warning: 0 } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    // Links — ordered in DOM by priority
    const links = screen.getAllByRole('link');
    const critIdx = links.findIndex(l => l.textContent?.includes('CriticalCo'));
    const warnIdx = links.findIndex(l => l.textContent?.includes('WarningCo'));

    expect(critIdx).not.toBe(-1);
    expect(warnIdx).not.toBe(-1);
    expect(critIdx).toBeLessThan(warnIdx);
  });

  it('displays churn-risk row before new-requests row (critical churn priority 1 before requests priority 2)', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({
          id: 'ws-7', name: 'Wayne Enterprises',
          requests: { total: 1, new: 1, active: 0, latestDate: null },
          churnSignals: { critical: 1, warning: 0 },
        }),
      ]),
      isLoading: false,
    });

    renderOverview();

    const links = screen.getAllByRole('link');
    const churnIdx = links.findIndex(l => l.textContent?.includes('churn'));
    const requestsIdx = links.findIndex(l => l.textContent?.includes('new client request'));

    expect(churnIdx).not.toBe(-1);
    expect(requestsIdx).not.toBe(-1);
    expect(churnIdx).toBeLessThan(requestsIdx);
  });

  it('displays new-requests before pending-approvals before content-briefs (priority order)', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({
          id: 'ws-8', name: 'Cyberdyne',
          requests: { total: 1, new: 1, active: 0, latestDate: null },
          approvals: { pending: 1, total: 1 },
          contentRequests: { pending: 1, inProgress: 0, delivered: 0, total: 1 },
        }),
      ]),
      isLoading: false,
    });

    renderOverview();

    const links = screen.getAllByRole('link');
    const texts = links.map(l => l.textContent || '');
    const requestsIdx = texts.findIndex(t => t.includes('new client request'));
    const approvalsIdx = texts.findIndex(t => t.includes('pending approval'));
    const contentIdx = texts.findIndex(t => t.includes('content brief'));

    expect(requestsIdx).not.toBe(-1);
    expect(approvalsIdx).not.toBe(-1);
    expect(contentIdx).not.toBe(-1);
    expect(requestsIdx).toBeLessThan(approvalsIdx);
    expect(approvalsIdx).toBeLessThan(contentIdx);
  });

  // ── 8. Per-workspace attribution ─────────────────────────────────────────────

  it('shows workspace name (meta) on each attention row', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-9', name: 'Weyland-Yutani', requests: { total: 1, new: 1, active: 0, latestDate: null } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    // The workspace name appears in the row text content (as meta)
    const link = getAttentionLink(/1 new client request/i);
    expect(link.textContent).toContain('Weyland-Yutani');
  });

  // ── 9. Per-workspace rows for multi-workspace items ──────────────────────────

  it('creates a separate row per workspace when multiple have the same issue', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-a', name: 'Alpha', requests: { total: 1, new: 1, active: 0, latestDate: null } }),
        makeWorkspace({ id: 'ws-b', name: 'Beta', requests: { total: 2, new: 2, active: 0, latestDate: null } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    const alphaLink = getAttentionLink(/1 new client request/i);
    expect(alphaLink.textContent).toContain('Alpha');
    const betaLink = getAttentionLink(/2 new client requests/i);
    expect(betaLink.textContent).toContain('Beta');
  });

  // ── 10. No attention section when all is clear ───────────────────────────────

  it('does not render Needs Attention section when all workspaces are healthy', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-ok', name: 'Happy Client' }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.queryByText('Needs Attention')).toBeNull();
  });

  // ── 11. Work orders link to requests page (ClientDeliverablesPane) ────────────

  it('renders work orders link pointing to requests page (not workspace-settings)', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-wo', name: 'WidgetCo', workOrders: { pending: 1, total: 1 } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.getByText('1 purchased fix awaiting fulfillment')).toBeDefined();

    const link = getAttentionLink(/1 purchased fix/i);
    // Work orders live on the requests page (ClientDeliverablesPane), not workspace-settings
    expect(link.getAttribute('href')).toBe('/ws/ws-wo/requests');
  });

  // ── 12. Churn risk links to requests page ─────────────────────────────────────

  it('renders churn-risk link pointing to requests page', () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-churn', name: 'Churnco', churnSignals: { critical: 0, warning: 2 } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.getByText('At risk of churn')).toBeDefined();
    expect(screen.getAllByText('Churnco').length).toBeGreaterThanOrEqual(1);

    const link = getAttentionLink(/At risk of churn/i);
    expect(link.getAttribute('href')).toBe('/ws/ws-churn/requests');
  });
});
