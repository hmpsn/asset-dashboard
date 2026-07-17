// @ds-rebuilt
import { fireEvent, render, screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceOutcomeOverview } from '../../../shared/types/outcome-tracking';
import type { WorkspaceOverviewItem } from '../../../shared/types/workspace-overview';
import { OutcomeWorkspaceLens } from '../../../src/components/global-ops-rebuilt/OutcomeWorkspaceLens';
import { OutcomesBookLens } from '../../../src/components/global-ops-rebuilt/OutcomesBookLens';
import { expectNoA11yViolations } from '../a11y';

const mocks = vi.hoisted(() => ({
  workspaceOverview: vi.fn(),
  outcomeOverview: vi.fn(),
}));

vi.mock('../../../src/hooks/admin/useWorkspaceOverview', () => ({
  useWorkspaceOverviewData: () => mocks.workspaceOverview(),
}));

vi.mock('../../../src/hooks/admin/useOutcomes', () => ({
  useOutcomeOverview: () => mocks.outcomeOverview(),
}));

vi.mock('../../../src/components/admin/outcomes/OutcomeDashboard', () => ({
  default: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="outcome-dashboard-machinery" data-workspace-id={workspaceId}>
      Record published work · Top Wins · Scorecard · Playbooks · Actions · Learnings · Coverage
    </div>
  ),
}));

function workspace(overrides: Partial<WorkspaceOverviewItem> = {}): WorkspaceOverviewItem {
  return {
    id: 'ws-acme',
    name: 'Acme Dental',
    webflowSiteId: 'site-acme',
    webflowSiteName: 'Acme Dental Website',
    hasGsc: true,
    hasGa4: true,
    hasPassword: true,
    tier: 'growth',
    isTrial: false,
    audit: null,
    requests: { total: 0, new: 0, active: 0, latestDate: null },
    approvals: { pending: 0, total: 0 },
    contentRequests: { pending: 0, inProgress: 0, delivered: 0, total: 0 },
    workOrders: { pending: 0, total: 0 },
    churnSignals: { critical: 0, warning: 0 },
    pageStates: { issueDetected: 0, inReview: 0, approved: 0, rejected: 0, live: 0, total: 0 },
    outcomeValue: {
      valuePerMonth: 1_200,
      clicks: 240,
      wins: 4,
      withValue: 1,
      platformExecuted: 3,
      externallyExecuted: 1,
      notActedOnExcluded: true,
    },
    gscRollup: {
      connected: true,
      dataAvailable: true,
      clicks: 240,
      traffic: 240,
      impressions: 4_200,
      avgCtr: 5.7,
      avgPosition: 5.2,
      dateRange: { start: '2026-04-10', end: '2026-07-09' },
    },
    siteHealthIssueMatrix: {
      workspaceId: 'ws-acme',
      totalIssues: 2,
      issues: [{ issueType: 'dead_links', label: 'Broken links', category: 'links', severity: 'error', count: 2, affectedPages: 2 }],
    },
    ...overrides,
  };
}

const outcome: WorkspaceOutcomeOverview = {
  workspaceId: 'ws-acme',
  workspaceName: 'Acme Dental',
  winRate: 0.5,
  trend: 'improving',
  activeActions: 2,
  scoredLast30d: 3,
  topWin: {
    actionId: 'action-1',
    actionType: 'content_refreshed',
    sourceType: 'post',
    sourceId: 'post-1',
    sourceLabel: 'Velvet Sofa Care refresh reversed decay',
    pageUrl: 'https://acme.example/velvet-sofa-care',
    targetKeyword: 'velvet sofa care',
    delta: {
      primary_metric: 'clicks',
      baseline_value: 100,
      current_value: 180,
      delta_absolute: 80,
      delta_percent: 80,
      direction: 'improved',
    },
    score: 'strong_win',
    attributedValue: 1_100,
    attribution: 'externally_executed',
    createdAt: '2026-07-01T00:00:00.000Z',
    scoredAt: '2026-07-08T00:00:00.000Z',
  },
  attentionNeeded: true,
  attentionReason: 'Coverage has not reconciled all measured outcomes.',
  coverage: { tracked: 5, measured: 4, reconciled: 3 },
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderBook() {
  return render(
    <MemoryRouter initialEntries={['/outcomes-overview']}>
      <Routes>
        <Route path="/outcomes-overview" element={<><OutcomesBookLens /><LocationProbe /></>} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.workspaceOverview.mockReset();
  mocks.outcomeOverview.mockReset();
  mocks.workspaceOverview.mockReturnValue({
    data: { workspaces: [workspace()] },
    isLoading: false,
    isError: false,
  });
  mocks.outcomeOverview.mockReturnValue({ data: [outcome], isLoading: false, isError: false });
});

describe('Global Ops Outcomes visual composition', () => {
  it('matches the book-level hierarchy while preserving additive production evidence in disclosure', () => {
    renderBook();

    expect(screen.getByRole('heading', { name: 'What your work has delivered.' })).toBeInTheDocument();
    expect(screen.getByText('Action results · across your book')).toBeInTheDocument();
    expect(screen.getByText('Book totals are not yet available')).toBeInTheDocument();
    expect(screen.getByText('By workspace')).toBeInTheDocument();
    expect(screen.getByText('$1,200')).toBeInTheDocument();
    expect(screen.getByText('Improving')).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Outcomes by workspace' })).toHaveClass('overflow-auto', 'md:max-h-[390px]');
    expect(screen.getByRole('columnheader', { name: 'Workspace' }).parentElement).toHaveClass('sticky', 'top-0');

    fireEvent.click(screen.getByRole('button', { name: 'View Acme Dental outcome evidence' }));

    expect(screen.getByText('3 platform · 1 client-side')).toBeInTheDocument();
    expect(screen.getByText('5.2')).toBeInTheDocument();
    expect(screen.getByText('3 / 5')).toBeInTheDocument();
    expect(screen.getByText('Broken links: 2')).toBeInTheDocument();
    expect(screen.getByText('Coverage has not reconciled all measured outcomes.')).toBeInTheDocument();
  });

  it('labels each outcome aggregate with its true measurement window', () => {
    renderBook();

    expect(screen.queryByText(/rolling 90/i)).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Value delivered / mo (all-time)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Clicks (28d)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Wins (all-time)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View Acme Dental outcome evidence' }));
    expect(screen.getByText('Win rate (all-time)')).toBeInTheDocument();
  });

  it('renders attribution-honest recent proof and keeps the workspace route reachable', () => {
    renderBook();

    expect(screen.getByText('Velvet Sofa Care refresh reversed decay')).toBeInTheDocument();
    expect(screen.getByText('Client-side · measured result')).toBeInTheDocument();
    expect(screen.queryByText(/we shipped/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Open Acme Dental outcomes: Velvet Sofa Care/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/ws/ws-acme/outcomes');
  });

  it('keeps the ranked workspace row CTA wired to the production outcome dashboard', () => {
    renderBook();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/ws/ws-acme/outcomes');
  });

  it('keeps loading and empty states inside the same comparison spine', () => {
    mocks.workspaceOverview.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mocks.outcomeOverview.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const result = renderBook();

    expect(screen.getByRole('grid', { name: 'Outcomes by workspace' })).toBeInTheDocument();
    expect(screen.getByLabelText('Loading recent wins')).toBeInTheDocument();
    expect(screen.queryByText('No graduated wins yet')).not.toBeInTheDocument();
    result.unmount();

    mocks.workspaceOverview.mockReturnValue({ data: { workspaces: [] }, isLoading: false, isError: false });
    mocks.outcomeOverview.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderBook();
    expect(screen.getByText('No workspace outcome evidence yet')).toBeInTheDocument();
    expect(screen.getByText('No graduated wins yet')).toBeInTheDocument();
  });

  it('passes the shared accessibility floor', async () => {
    const { container } = renderBook();
    await expectNoA11yViolations(container);
  });

  it('preserves the full per-workspace outcome dashboard exactly once', () => {
    render(
      <MemoryRouter>
        <OutcomeWorkspaceLens workspaceId="ws-acme" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Outcome Dashboard' })).toBeInTheDocument();
    expect(screen.getByTestId('outcome-dashboard-frame')).toBeInTheDocument();
    expect(screen.getAllByTestId('outcome-dashboard-machinery')).toHaveLength(1);
    expect(screen.getByTestId('outcome-dashboard-machinery')).toHaveAttribute('data-workspace-id', 'ws-acme');
  });

  it('keeps the no-workspace receiver safe', () => {
    render(
      <MemoryRouter>
        <OutcomeWorkspaceLens />
      </MemoryRouter>,
    );

    expect(screen.getByText('Choose a workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('outcome-dashboard-machinery')).not.toBeInTheDocument();
  });
});
