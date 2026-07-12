// @ds-rebuilt
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/components/Toast';
import { GlobalSettingsLens } from '../../../src/components/global-ops-rebuilt/GlobalSettingsLens';
import { RoadmapLens } from '../../../src/components/global-ops-rebuilt/RoadmapLens';
import { WorkspaceSettingsLens } from '../../../src/components/global-ops-rebuilt/WorkspaceSettingsLens';
import { expectNoA11yViolations } from '../a11y';

const mocks = vi.hoisted(() => ({
  roadmapGet: vi.fn(),
  roadmapUpdate: vi.fn(),
  archiveMutate: vi.fn(),
  startJob: vi.fn(),
}));

vi.mock('../../../src/components/FeatureFlagSettings', () => ({
  FeatureFlagSettings: () => <section><h2>Feature Flags</h2></section>,
}));

vi.mock('../../../src/components/McpApiKeysSettings', () => ({
  McpApiKeysSettings: () => <section><h2>MCP API Keys</h2></section>,
}));

vi.mock('../../../src/components/StripeSettings', () => ({
  StripeSettings: () => <section><h2>Payments</h2></section>,
}));

vi.mock('../../../src/components/WorkspaceSettings', () => ({
  WorkspaceSettings: ({
    workspaceName,
    workspaceDomain,
    prototypeHeader,
  }: {
    workspaceName: string;
    workspaceDomain?: string;
    prototypeHeader?: boolean;
  }) => (
    <section
      data-testid="production-workspace-settings"
      data-prototype-header={prototypeHeader ? 'true' : 'false'}
    >
      {prototypeHeader ? (
        <header>
          <span role="img" aria-label={`${workspaceName} workspace`}>{workspaceName.slice(0, 2)}</span>
          <h2>Workspace settings</h2>
          <p>{workspaceName} · {workspaceDomain}</p>
        </header>
      ) : <h2>{workspaceName}</h2>}
      <nav aria-label="Production workspace settings">
        {['Connections', 'Features', 'Feature Flags', 'Publishing', 'Client Dashboard', 'Data Export', 'LLMs.txt']
          .map((label) => <button key={label} type="button">{label}</button>)}
      </nav>
    </section>
  ),
}));

vi.mock('../../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ startJob: mocks.startJob, jobs: [] }),
}));

vi.mock('../../../src/hooks/admin/useGlobalOpsSettings', () => ({
  useGlobalOpsWorkspaces: () => ({
    data: [{
      id: 'ws-1',
      name: 'Rinse Dental',
      webflowSiteId: 'site-1',
      webflowSiteName: 'Rinse Dental',
      liveDomain: 'https://rinse.example/',
      gscPropertyUrl: 'sc-domain:rinse.example',
      ga4PropertyId: 'properties/123',
      clientPortalEnabled: true,
      tier: 'premium',
      folder: 'rinse',
      createdAt: '2026-07-07T00:00:00.000Z',
    }],
    isLoading: false,
    isError: false,
  }),
  useGlobalOpsGoogleStatus: () => ({ data: { connected: true, configured: true }, isLoading: false, isError: false }),
  useGlobalOpsGscSites: () => ({ data: [{ siteUrl: 'sc-domain:rinse.example', permissionLevel: 'siteOwner' }], isLoading: false }),
  useGlobalOpsHealth: () => ({
    data: { hasOpenAIKey: true, hasWebflowToken: true, hasGoogleAuth: true, hasEmailConfig: false, hasStripe: true },
    isLoading: false,
    isError: false,
  }),
  useGlobalOpsStorage: () => ({
    data: {
      totalBytes: 2048,
      totalFiles: 5,
      breakdown: [{ name: 'reports', label: 'Reports', bytes: 2048, fileCount: 5 }],
      backupRetentionDays: 3,
      chatSessionCount: 2,
      oldestChatSession: null,
      timestamp: '2026-07-07T12:00:00.000Z',
    },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useGlobalOpsStudioConfig: () => ({ data: { bookingUrl: 'https://cal.example/rinse' } }),
  useGlobalOpsGoogleAuthUrl: () => ({ mutate: vi.fn(), isPending: false }),
  useDisconnectGlobalGoogle: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveGlobalBookingUrl: () => ({ mutate: vi.fn(), isPending: false }),
  usePruneGlobalStorage: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveWorkspace: () => ({ mutate: mocks.archiveMutate, isPending: false }),
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

function renderWithProviders(ui: ReactElement, initialEntry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.roadmapGet.mockReset();
  mocks.roadmapUpdate.mockReset();
  mocks.archiveMutate.mockReset();
  mocks.startJob.mockReset();
  mocks.roadmapGet.mockResolvedValue({
    sprints: [{
      id: 'current',
      name: 'Current Sprint',
      rationale: 'Finish the parity pass',
      hours: 'phased - isolated integration sandbox, then one staging PR per dependency',
      items: [
        { id: 1, title: 'Settings composition', status: 'in_progress', priority: 'P1', est: '4h', tags: ['ui'] },
        { id: 2, title: 'Owner circle-back', status: 'deferred', priority: 'P2', est: '2h', tags: ['review'] },
        { id: 3, title: 'Shipped surface', status: 'done', priority: 'P3', est: '1h', shippedAt: '2026-07-01' },
      ],
    }],
  });
  mocks.roadmapUpdate.mockResolvedValue({ ok: true });
});

describe('Global Ops Wave A composition contracts', () => {
  it('uses the prototype section order without the redundant settings KPI strip', () => {
    renderWithProviders(<GlobalSettingsLens />, '/settings');

    const surface = screen.getByTestId('global-settings-rebuilt');
    const text = surface.textContent ?? '';
    const headings = ['Google Account', 'Webflow Connections', 'Platform Health', 'Storage Monitor', 'Booking Link', 'Feature Flags', 'MCP API Keys', 'Payments'];
    headings.reduce((previous, heading) => {
      const next = text.indexOf(heading);
      expect(next).toBeGreaterThan(previous);
      return next;
    }, -1);
    expect(within(surface).queryByText('GSC properties')).not.toBeInTheDocument();
    expect(within(surface).queryByRole('grid')).not.toBeInTheDocument();
  });

  it('offers a safe new-tab preview only while the booking URL is valid', () => {
    renderWithProviders(<GlobalSettingsLens />, '/settings');

    const preview = screen.getByRole('link', { name: 'Preview link' });
    expect(preview).toHaveAttribute('href', 'https://cal.example/rinse');
    expect(preview).toHaveAttribute('target', '_blank');
    expect(preview).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(preview).toHaveAttribute('rel', expect.stringContaining('noreferrer'));

    fireEvent.change(screen.getByPlaceholderText('https://cal.com/yourname'), {
      target: { value: 'javascript:alert(1)' },
    });
    expect(screen.queryByRole('link', { name: 'Preview link' })).not.toBeInTheDocument();
  });

  it('pairs the production seven-tab settings UI with the prototype identity header', () => {
    renderWithProviders(<WorkspaceSettingsLens workspaceId="ws-1" />, '/ws/ws-1/workspace-settings?tab=dashboard');

    const surface = screen.getByTestId('workspace-settings-rebuilt');
    expect(surface).toHaveAttribute('data-active-tab', 'dashboard');
    expect(within(surface).getAllByRole('button', { name: 'Connections' })).toHaveLength(1);
    expect(within(surface).getAllByRole('button', { name: 'Client Dashboard' })).toHaveLength(1);
    expect(within(surface).getByRole('heading', { name: 'Workspace settings' })).toBeInTheDocument();
    expect(within(surface).getByRole('img', { name: 'Rinse Dental workspace' })).toBeInTheDocument();
    expect(within(surface).getByText('Rinse Dental · rinse.example')).toBeInTheDocument();
    expect(within(surface).getByTestId('production-workspace-settings')).toHaveAttribute('data-prototype-header', 'true');
    expect(within(surface).getByRole('button', { name: 'Run Audit' })).toBeInTheDocument();
    expect(within(surface).getByRole('button', { name: 'Run Strategy' })).toBeInTheDocument();
    expect(within(surface).getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('renders the sprint-grouped roadmap composition and a neutral deferred state', async () => {
    const { container } = renderWithProviders(<RoadmapLens />, '/roadmap?view=sprint');

    const surface = await screen.findByTestId('roadmap-rebuilt');
    expect(await within(surface).findByRole('heading', { name: 'Current Sprint' })).toBeInTheDocument();
    expect(within(surface).getByText('Overall progress')).toBeInTheDocument();
    expect(within(surface).getByLabelText('Filter by priority')).toBeInTheDocument();
    expect(within(surface).getByLabelText('Filter by status')).toBeInTheDocument();
    expect(within(surface).getAllByText('On hold').length).toBeGreaterThan(0);
    expect(within(surface).getByRole('button', { name: /deferred status/i })).toBeDisabled();
    expect(within(surface).queryByText(/phased - isolated integration sandbox/i)).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('keeps backlog priority, estimate, and status in a six-column scan', async () => {
    renderWithProviders(<RoadmapLens />, '/roadmap?view=backlog');

    const surface = await screen.findByTestId('roadmap-rebuilt');
    const header = await within(surface).findByTestId('roadmap-backlog-header');
    expect(header).toHaveAttribute('data-layout', 'six-column');
    expect(within(header).getByText('ID')).toBeInTheDocument();
    expect(within(header).getByText('Item')).toBeInTheDocument();
    expect(within(header).getByText('Priority')).toBeInTheDocument();
    expect(within(header).getByText('Est')).toBeInTheDocument();
    expect(within(header).getByText('Status')).toBeInTheDocument();
    expect(within(surface).getAllByText('P1').length).toBeGreaterThan(0);
    const firstRow = within(surface).getAllByTestId(/^roadmap-backlog-row-/)[0];
    expect(within(firstRow).getByText('In Progress')).toBeInTheDocument();
    expect(within(firstRow).queryByText('Current Sprint')).not.toBeInTheDocument();
  });
});
