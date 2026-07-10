// @ds-rebuilt
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/components/Toast';
import {
  AiUsageBusinessSurface,
  DiagnosticsSurface,
  GlobalSettingsSurface,
  OutcomeWorkspaceSurface,
  OutcomesOverviewSurface,
  ProspectBusinessSurface,
  RequestsSurface,
  RevenueBusinessSurface,
  RoadmapSurface,
  WorkspaceSettingsSurface,
} from '../../../src/components/global-ops-rebuilt';
import { BusinessLens } from '../../../src/components/global-ops-rebuilt/BusinessLens';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { expectNoA11yViolations } from '../a11y';

const mocks = vi.hoisted(() => ({
  featureFlagsList: vi.fn(),
  roadmapGet: vi.fn(),
  roadmapUpdate: vi.fn(),
  startJob: vi.fn(),
  archiveMutate: vi.fn(),
  workspaceOverview: vi.fn(),
  outcomeOverview: vi.fn(),
}));

vi.mock('../../../src/hooks/admin/useWorkspaceOverview', () => ({
  useWorkspaceOverviewData: () => mocks.workspaceOverview(),
}));

vi.mock('../../../src/hooks/admin/useOutcomes', () => ({
  useOutcomeOverview: () => mocks.outcomeOverview(),
}));

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

vi.mock('../../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({
    startJob: mocks.startJob,
    jobs: [],
  }),
}));

vi.mock('../../../src/api/platform', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/platform')>('../../../src/api/platform');
  return {
    ...actual,
    roadmap: {
      ...actual.roadmap,
      get: (...args: unknown[]) => mocks.roadmapGet(...args),
      updateItem: (...args: unknown[]) => mocks.roadmapUpdate(...args),
    },
  };
});

vi.mock('../../../src/hooks/admin/useGlobalOpsSettings', () => ({
  useGlobalOpsWorkspaces: () => ({
    data: [{
      id: 'ws-1',
      name: 'Acme Dental',
      webflowSiteId: 'site-1',
      webflowSiteName: 'Acme Site',
      gscPropertyUrl: 'https://acme.example',
      ga4PropertyId: 'properties/123',
      clientPortalEnabled: true,
      tier: 'growth',
      autoReports: true,
      autoReportFrequency: 'weekly',
      folder: 'acme',
      createdAt: '2026-07-07T00:00:00.000Z',
    }],
    isLoading: false,
    isError: false,
  }),
  useGlobalOpsGoogleStatus: () => ({ data: { connected: true, configured: true }, isLoading: false, isError: false }),
  useGlobalOpsGscSites: () => ({ data: [{ siteUrl: 'https://acme.example', permissionLevel: 'siteOwner' }], isLoading: false }),
  useGlobalOpsHealth: () => ({
    data: { hasOpenAIKey: true, hasWebflowToken: true, hasGoogleAuth: true, hasEmailConfig: false, hasStripe: true },
    isLoading: false,
    isError: false,
  }),
  useGlobalOpsStorage: () => ({
    data: {
      totalBytes: 1024,
      totalFiles: 3,
      breakdown: [{ name: 'reports', label: 'Reports', bytes: 1024, fileCount: 3 }],
      backupRetentionDays: 3,
      chatSessionCount: 2,
      oldestChatSession: null,
      timestamp: '2026-07-07T12:00:00.000Z',
    },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useGlobalOpsStudioConfig: () => ({ data: { bookingUrl: 'https://cal.example/acme' } }),
  useGlobalOpsGoogleAuthUrl: () => ({ mutate: vi.fn(), isPending: false }),
  useDisconnectGlobalGoogle: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveGlobalBookingUrl: () => ({ mutate: vi.fn(), isPending: false }),
  usePruneGlobalStorage: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveWorkspace: () => ({ mutate: mocks.archiveMutate, isPending: false }),
}));

vi.mock('../../../src/components/RevenueDashboard', () => ({ RevenueDashboard: () => <div data-testid="revenue-panel">Revenue panel</div> }));
vi.mock('../../../src/components/AIUsageSection', () => ({ AIUsageSection: () => <div data-testid="ai-usage-panel">AI usage panel</div> }));
vi.mock('../../../src/components/FeatureLibrary', () => ({ default: () => <div data-testid="features-panel">Features panel</div> }));
vi.mock('../../../src/components/SalesReport', () => ({ SalesReport: () => <div data-testid="prospects-panel">Prospects panel</div> }));
vi.mock('../../../src/components/WorkspaceSettings', () => ({ WorkspaceSettings: () => <div data-testid="legacy-workspace-settings">Workspace settings machinery</div> }));
vi.mock('../../../src/components/admin/DiagnosticReport/DiagnosticReportPage', () => ({ DiagnosticReportPage: () => <div data-testid="legacy-diagnostics">Diagnostics machinery</div> }));
vi.mock('../../../src/components/admin/AdminInbox', () => ({ AdminInbox: () => <div data-testid="signals-pane">Signals pane</div> }));
vi.mock('../../../src/components/admin/ClientActionsTab', () => ({ ClientActionsTab: () => <div data-testid="actions-pane">Actions pane</div> }));
vi.mock('../../../src/components/admin/ClientDeliverablesPane', () => ({ ClientDeliverablesPane: () => <div data-testid="deliverables-pane">Deliverables pane</div> }));
vi.mock('../../../src/components/RequestManager', () => ({ RequestManager: () => <div data-testid="requests-pane">All requests pane</div> }));

function renderWithProviders(ui: ReactElement, initialEntry = '/revenue') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          {ui}
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function FlagHarness() {
  const enabled = useFeatureFlag('ui-rebuild-shell');
  return enabled ? <GlobalSettingsSurface /> : <div data-testid="legacy-settings">Legacy settings</div>;
}

beforeEach(() => {
  mocks.featureFlagsList.mockReset();
  mocks.roadmapGet.mockReset();
  mocks.roadmapUpdate.mockReset();
  mocks.startJob.mockReset();
  mocks.archiveMutate.mockReset();
  mocks.workspaceOverview.mockReset();
  mocks.outcomeOverview.mockReset();
  mocks.workspaceOverview.mockReturnValue({
    data: {
      workspaces: [{
        id: 'ws-1',
        name: 'Acme Dental',
        outcomeValue: {
          valuePerMonth: 1200,
          wins: 4,
          withValue: 1,
          platformExecuted: 3,
          externallyExecuted: 1,
        },
        gscRollup: { clicks: 240, avgPosition: 5.2 },
        siteHealthIssueMatrix: { totalIssues: 2 },
      }],
    },
    isLoading: false,
  });
  mocks.outcomeOverview.mockReturnValue({
    data: [{
      workspaceId: 'ws-1',
      workspaceName: 'Acme Dental',
      winRate: 0.5,
      trend: 'stable',
      activeActions: 2,
      scoredLast30d: 3,
      topWin: null,
      attentionNeeded: false,
      coverage: { tracked: 5, measured: 4, reconciled: 3 },
    }],
    isLoading: false,
  });
  mocks.roadmapGet.mockResolvedValue({
    sprints: [
      {
        id: 'current',
        name: 'Current Sprint',
        items: [
          {
            id: 1,
            title: 'Archive workspace',
            status: 'pending',
            priority: 'P1',
            est: '2h',
            notes: 'SB-043 operator archive path',
            createdAt: '2026-07-07T00:00:00.000Z',
          },
          {
            id: 2,
            title: 'Old completed item',
            status: 'done',
            priority: 'P3',
            est: '1h',
            notes: '',
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      },
    ],
  });
  mocks.roadmapUpdate.mockResolvedValue({ ok: true, item: { id: 1, title: 'Archive workspace', status: 'in_progress' } });
});

describe('Global Ops rebuilt receivers', () => {
  it('mounts after a real useFeatureFlag loading to loaded transition', async () => {
    let resolveFlags: (value: Record<string, boolean>) => void = () => {};
    mocks.featureFlagsList.mockReturnValue(new Promise((resolve) => { resolveFlags = resolve; }));
    renderWithProviders(<FlagHarness />, '/settings');

    expect(screen.getByTestId('legacy-settings')).toBeInTheDocument();

    await act(async () => {
      resolveFlags({ 'ui-rebuild-shell': true });
    });

    await waitFor(() => expect(screen.getByTestId('global-settings-rebuilt')).toBeInTheDocument());
  });

  it('has no obvious a11y violations on a rebuilt Business tab', async () => {
    const { container } = renderWithProviders(<BusinessLens defaultTab="features" />, '/revenue?tab=features');
    await expectNoA11yViolations(container);
  });

  it('receives valid Business tabs and falls back on invalid tabs', () => {
    renderWithProviders(<RevenueBusinessSurface />, '/revenue?tab=ai-usage');
    expect(screen.getByTestId('business-rebuilt')).toHaveAttribute('data-active-tab', 'ai-usage');
    expect(screen.getByTestId('ai-usage-panel')).toBeInTheDocument();
  });

  it('defaults old Business page aliases to their matching tabs', () => {
    renderWithProviders(<ProspectBusinessSurface />, '/prospect');
    expect(screen.getByTestId('business-rebuilt')).toHaveAttribute('data-active-tab', 'prospects');
    expect(screen.getByTestId('prospects-panel')).toBeInTheDocument();
  });

  it('falls back invalid Business tabs to the page default', () => {
    renderWithProviders(<AiUsageBusinessSurface />, '/ai-usage?tab=unknown');
    expect(screen.getByTestId('business-rebuilt')).toHaveAttribute('data-active-tab', 'ai-usage');
    expect(screen.getByTestId('business-invalid-tab-fallback')).toBeInTheDocument();
  });

  it('receives Workspace Settings tabs and falls back to Connections', () => {
    renderWithProviders(<WorkspaceSettingsSurface workspaceId="ws-1" />, '/ws/ws-1/workspace-settings?tab=dashboard');
    expect(screen.getByTestId('workspace-settings-rebuilt')).toHaveAttribute('data-active-tab', 'dashboard');
  });

  it('handles invalid Workspace Settings tabs', () => {
    renderWithProviders(<WorkspaceSettingsSurface workspaceId="ws-1" />, '/ws/ws-1/workspace-settings?tab=nope');
    expect(screen.getByTestId('workspace-settings-rebuilt')).toHaveAttribute('data-active-tab', 'connections');
    expect(screen.getByTestId('workspace-settings-invalid-tab-fallback')).toBeInTheDocument();
  });

  it('receives Roadmap view params and renders searched roadmap rows', async () => {
    renderWithProviders(<RoadmapSurface />, '/roadmap?view=backlog&q=archive&sort=title&dir=desc');
    expect(screen.getByTestId('roadmap-rebuilt')).toHaveAttribute('data-active-view', 'backlog');
    await waitFor(() => expect(screen.getByText('Archive workspace')).toBeInTheDocument());
    expect(screen.queryByText('Old completed item')).not.toBeInTheDocument();
  });

  it('falls back invalid Roadmap views to Sprint', async () => {
    renderWithProviders(<RoadmapSurface />, '/roadmap?view=bad');
    expect(screen.getByTestId('roadmap-rebuilt')).toHaveAttribute('data-active-view', 'sprint');
    await waitFor(() => expect(screen.getByText('Unknown Roadmap view')).toBeInTheDocument());
  });

  it('receives Diagnostics report links and falls back to list mode for an empty report param', () => {
    renderWithProviders(<DiagnosticsSurface workspaceId="ws-1" />, '/ws/ws-1/diagnostics?report=diag-1');
    expect(screen.getByTestId('diagnostics-rebuilt')).toHaveAttribute('data-report-id', 'diag-1');
  });

  it('uses Diagnostics list mode when report is absent', () => {
    renderWithProviders(<DiagnosticsSurface workspaceId="ws-1" />, '/ws/ws-1/diagnostics?report=');
    expect(screen.getByTestId('diagnostics-rebuilt')).toHaveAttribute('data-report-id', '');
  });

  it('receives Requests tabs and preserves the All Requests view', () => {
    renderWithProviders(
      <Routes>
        <Route path="/ws/:workspaceId/requests" element={<RequestsSurface workspaceId="ws-1" />} />
      </Routes>,
      '/ws/ws-1/requests?tab=requests', // inbox-legacy-filter-literal-ok -- admin Requests page deep-link, not client inbox filter
    );
    expect(screen.getByTestId('requests-rebuilt')).toHaveAttribute('data-active-tab', 'requests');
    expect(screen.getByTestId('requests-pane')).toBeInTheDocument();
  });

  it('falls back invalid Requests tabs to Deliverables', () => {
    renderWithProviders(<RequestsSurface workspaceId="ws-1" />, '/ws/ws-1/requests?tab=bad');
    expect(screen.getByTestId('requests-rebuilt')).toHaveAttribute('data-active-tab', 'deliverables');
    expect(screen.getByTestId('deliverables-pane')).toBeInTheDocument();
    expect(screen.getByTestId('requests-invalid-tab-fallback')).toBeInTheDocument();
  });

  it('uses server-owned workspace evidence without inventing a cross-workspace rollup', () => {
    renderWithProviders(<OutcomesOverviewSurface />, '/outcomes-overview');

    expect(screen.getByTestId('outcomes-book-rebuilt')).toBeInTheDocument();
    expect(screen.queryByText('Wins counted')).not.toBeInTheDocument();
    expect(screen.queryByText('Client-side called')).not.toBeInTheDocument();
    expect(screen.getByText('3 / 5')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Workspace' }).parentElement?.style.gridTemplateColumns)
      .toContain('minmax(180px, 1.3fr)');
  });

  it('does not expose internal rebuild or migration language', () => {
    const forbidden = [
      /additive aliases/i,
      /legacy parity/i,
      /carry-over parity/i,
      /deferred/i,
      /\?view=/i,
      /workspace-scoped route/i,
      /handoff planned/i,
    ];
    const assertVisibleCopy = () => {
      const visibleText = document.body.textContent ?? '';
      forbidden.forEach((pattern) => expect(visibleText).not.toMatch(pattern));
    };

    let result = renderWithProviders(<BusinessLens defaultTab="revenue" />, '/revenue');
    assertVisibleCopy();
    result.unmount();

    result = renderWithProviders(<WorkspaceSettingsSurface workspaceId="ws-1" />, '/ws/ws-1/workspace-settings?tab=dashboard');
    assertVisibleCopy();
    result.unmount();

    result = renderWithProviders(<WorkspaceSettingsSurface />, '/workspace-settings');
    assertVisibleCopy();
    result.unmount();

    result = renderWithProviders(<RoadmapSurface />, '/roadmap');
    assertVisibleCopy();
    result.unmount();

    result = renderWithProviders(<RequestsSurface workspaceId="ws-1" />, '/ws/ws-1/requests?tab=actions');
    assertVisibleCopy();
    result.unmount();

    result = renderWithProviders(<RequestsSurface />, '/requests');
    assertVisibleCopy();
    result.unmount();

    result = renderWithProviders(<DiagnosticsSurface />, '/diagnostics');
    assertVisibleCopy();
    result.unmount();

    result = renderWithProviders(<OutcomeWorkspaceSurface />, '/outcomes');
    assertVisibleCopy();
  });
});
