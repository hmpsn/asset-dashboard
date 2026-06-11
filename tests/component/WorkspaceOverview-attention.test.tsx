// tests/component/WorkspaceOverview-attention.test.tsx
//
// Component tests for the "Needs Attention" section of WorkspaceOverview.
//
// Asserts:
//   1. Each attention item renders a ClickableRow with the correct adminPath href.
//   2. Items are ordered by severity (priority) — most urgent first.
//   3. Workspace name attribution is rendered on each row.
//   4. ?tab= deep-link items carry the correct query string.
//   5. Clicking a row calls navigate() with the correct href.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkspaceOverview — Needs Attention section', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  // ── 1. New client requests ──────────────────────────────────────────────────

  it('renders a clickable row for new client requests and navigates to the requests page', async () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-1', name: 'Acme Corp', requests: { total: 2, new: 2, active: 0, latestDate: null } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    // Label is present
    expect(screen.getByText('2 new client requests')).toBeDefined();
    // Workspace name appears at least once (attribution row in Needs Attention)
    expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1);

    // Row has aria-label combining label + workspace name
    const row = screen.getByRole('button', { name: /2 new client requests.*Acme Corp/i });
    fireEvent.click(row);
    expect(navigateMock).toHaveBeenCalledWith('/ws/ws-1/requests');
  });

  // ── 2. Pending approvals ────────────────────────────────────────────────────

  it('renders pending approvals row linking to seo-editor', async () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-2', name: 'Globex', approvals: { pending: 3, total: 3 } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.getByText('3 pending approvals')).toBeDefined();
    expect(screen.getAllByText('Globex').length).toBeGreaterThanOrEqual(1);

    const row = screen.getByRole('button', { name: /3 pending approvals.*Globex/i });
    fireEvent.click(row);
    expect(navigateMock).toHaveBeenCalledWith('/ws/ws-2/seo-editor');
  });

  // ── 3. Content briefs — ?tab=briefs deep-link ────────────────────────────────

  it('renders content briefs row with ?tab=briefs deep-link', async () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-3', name: 'Initech', contentRequests: { pending: 1, inProgress: 0, delivered: 0, total: 1 } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.getByText('1 content brief awaiting review')).toBeDefined();
    expect(screen.getAllByText('Initech').length).toBeGreaterThanOrEqual(1);

    const row = screen.getByRole('button', { name: /1 content brief.*Initech/i });
    fireEvent.click(row);
    // Must include ?tab=briefs (ContentPipeline reads searchParams.get('tab'))
    expect(navigateMock).toHaveBeenCalledWith('/ws/ws-3/content-pipeline?tab=briefs');
  });

  // ── 4. No site linked — ?tab=connections deep-link ──────────────────────────

  it('renders no-site-linked row with ?tab=connections deep-link', async () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-4', name: 'Umbrella', webflowSiteId: null, webflowSiteName: null }),
      ]),
      isLoading: false,
    });

    renderOverview();

    // "No site linked" label text is in both the attention row AND the workspace card
    expect(screen.getAllByText(/No site linked/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Umbrella').length).toBeGreaterThanOrEqual(1);

    const row = screen.getByRole('button', { name: /No site linked.*connect Webflow.*Umbrella/i });
    fireEvent.click(row);
    // Must include ?tab=connections (WorkspaceSettings reads searchParams.get('tab'))
    expect(navigateMock).toHaveBeenCalledWith('/ws/ws-4/workspace-settings?tab=connections');
  });

  // ── 5. Low health score — links to seo-audit ────────────────────────────────

  it('renders low health score row linking to seo-audit', async () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-5', name: 'Nakatomi', audit: { score: 42, totalPages: 10, errors: 5, warnings: 3 } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.getByText(/Health score 42/i)).toBeDefined();
    expect(screen.getAllByText('Nakatomi').length).toBeGreaterThanOrEqual(1);

    const row = screen.getByRole('button', { name: /Health score 42.*Nakatomi/i });
    fireEvent.click(row);
    expect(navigateMock).toHaveBeenCalledWith('/ws/ws-5/seo-audit');
  });

  // ── 6. Rejected changes — links to seo-editor ───────────────────────────────

  it('renders rejected changes row linking to seo-editor', async () => {
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

    const row = screen.getByRole('button', { name: /2 rejected changes.*Stark/i });
    fireEvent.click(row);
    expect(navigateMock).toHaveBeenCalledWith('/ws/ws-6/seo-editor');
  });

  // ── 7. Severity ordering ────────────────────────────────────────────────────

  it('displays churn-risk row before new-requests row (priority 1.5 before 2)', async () => {
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

    const buttons = screen.getAllByRole('button');
    // Find the positions of the two attention rows
    const churnIdx = buttons.findIndex(b => b.getAttribute('aria-label')?.includes('churn'));
    const requestsIdx = buttons.findIndex(b => b.getAttribute('aria-label')?.includes('new client request'));

    expect(churnIdx).not.toBe(-1);
    expect(requestsIdx).not.toBe(-1);
    expect(churnIdx).toBeLessThan(requestsIdx);
  });

  it('displays new-requests before pending-approvals before content-briefs (priority order)', async () => {
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

    const labels = screen.getAllByRole('button').map(b => b.getAttribute('aria-label') || '');
    const requestsIdx = labels.findIndex(l => l.includes('new client request'));
    const approvalsIdx = labels.findIndex(l => l.includes('pending approval'));
    const contentIdx = labels.findIndex(l => l.includes('content brief'));

    expect(requestsIdx).not.toBe(-1);
    expect(approvalsIdx).not.toBe(-1);
    expect(contentIdx).not.toBe(-1);
    expect(requestsIdx).toBeLessThan(approvalsIdx);
    expect(approvalsIdx).toBeLessThan(contentIdx);
  });

  // ── 8. Per-workspace attribution ─────────────────────────────────────────────

  it('shows workspace name as attribution on each attention row', async () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-9', name: 'Weyland-Yutani', requests: { total: 1, new: 1, active: 0, latestDate: null } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    // The workspace name appears in the aria-label of the row
    const row = screen.getByRole('button', { name: /1 new client request.*Weyland-Yutani/i });
    expect(row).toBeDefined();
  });

  // ── 9. Per-workspace rows for multi-workspace items ──────────────────────────

  it('creates a separate row per workspace when multiple have the same issue', async () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-a', name: 'Alpha', requests: { total: 1, new: 1, active: 0, latestDate: null } }),
        makeWorkspace({ id: 'ws-b', name: 'Beta', requests: { total: 2, new: 2, active: 0, latestDate: null } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    // Should have a row for each workspace
    expect(screen.getByRole('button', { name: /1 new client request.*Alpha/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /2 new client requests.*Beta/i })).toBeDefined();
  });

  // ── 10. No attention section when all is clear ───────────────────────────────

  it('does not render Needs Attention section when all workspaces are healthy', async () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-ok', name: 'Happy Client' }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.queryByText('Needs Attention')).toBeNull();
  });

  // ── 11. Work orders link to workspace-settings ────────────────────────────────

  it('renders work orders row linking to workspace-settings', async () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-wo', name: 'WidgetCo', workOrders: { pending: 1, total: 1 } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.getByText('1 purchased fix awaiting fulfillment')).toBeDefined();

    const row = screen.getByRole('button', { name: /1 purchased fix/i });
    fireEvent.click(row);
    expect(navigateMock).toHaveBeenCalledWith('/ws/ws-wo/workspace-settings');
  });

  // ── 12. Churn risk links to requests page ─────────────────────────────────────

  it('renders churn-risk row linking to requests page', async () => {
    mockUseWorkspaceOverviewData.mockReturnValue({
      data: makeOverviewData([
        makeWorkspace({ id: 'ws-churn', name: 'Churnco', churnSignals: { critical: 0, warning: 2 } }),
      ]),
      isLoading: false,
    });

    renderOverview();

    expect(screen.getByText('At risk of churn')).toBeDefined();
    expect(screen.getAllByText('Churnco').length).toBeGreaterThanOrEqual(1);

    const row = screen.getByRole('button', { name: /At risk of churn.*Churnco/i });
    fireEvent.click(row);
    expect(navigateMock).toHaveBeenCalledWith('/ws/ws-churn/requests');
  });
});
