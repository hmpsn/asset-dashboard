import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../../src/App';
import { KeywordsSurface } from '../../../src/components/keywords-rebuilt/KeywordsSurface';
import { expectNoA11yViolations } from '../a11y';

const mockCreate = vi.fn();
const mockDelete = vi.fn();
const mockLink = vi.fn();
const mockUnlink = vi.fn();

const workspace = {
  id: 'ws-1',
  name: 'Acme',
  webflowSiteId: 'site-1',
  webflowSiteName: 'acme.com',
  folder: 'acme',
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

vi.mock('../../../src/hooks/admin', () => ({
  WORKSPACES_KEY: ['workspaces'],
  QUEUE_KEY: ['queue'],
  useWorkspaces: () => ({ data: [workspace] }),
  useHealthCheck: () => ({
    data: { hasOpenAIKey: false, hasWebflowToken: true },
    isSuccess: true,
  }),
  useQueue: () => ({ data: [] }),
  useWorkspaceBadges: () => ({ data: { pendingRequests: 0 } }),
  useCreateWorkspace: () => ({ mutateAsync: mockCreate }),
  useDeleteWorkspace: () => ({ mutateAsync: mockDelete }),
  useLinkSite: () => ({ mutateAsync: mockLink }),
  useUnlinkSite: () => ({ mutateAsync: mockUnlink }),
}));

vi.mock('../../../src/hooks/admin/useNotifications', () => ({
  useNotifications: () => ({ data: [] }),
}));

vi.mock('../../../src/hooks/useGlobalAdminEvents', () => ({
  useGlobalAdminEvents: vi.fn(),
}));

vi.mock('../../../src/hooks/useWsInvalidation', () => ({
  useWsInvalidation: vi.fn(),
}));

vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      list: () => Promise.resolve({ 'ui-rebuild-shell': true }),
    },
  };
});

vi.mock('../../../src/components/KeywordHub', () => ({
  KeywordHub: () => <div data-testid="legacy-keyword-hub">Legacy Keyword Hub</div>,
}));

vi.mock('../../../src/components/layout/Sidebar', () => ({
  Sidebar: () => <aside data-testid="legacy-sidebar">Legacy sidebar</aside>,
}));

vi.mock('../../../src/components/layout/Breadcrumbs', () => ({
  Breadcrumbs: () => <nav data-testid="legacy-breadcrumbs">Legacy breadcrumbs</nav>,
}));

vi.mock('../../../src/components/StatusBar', () => ({
  StatusBar: () => <footer data-testid="legacy-status">Legacy status</footer>,
}));

vi.mock('../../../src/components/CommandPalette', () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

vi.mock('../../../src/components/AdminChat', () => ({
  AdminChat: () => <div data-testid="admin-chat" />,
}));

function renderSurface(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <KeywordsSurface workspaceId="ws-1" />
    </MemoryRouter>,
  );
}

function renderDashboard(path = '/ws/ws-1/seo-keywords?tab=lifecycle') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Dashboard theme="dark" toggleTheme={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KeywordsSurface rebuilt pilot scaffold', () => {
  it('receives rebuilt lens, filter, search, page, and keyword deep-link params', async () => {
    const { container } = renderSurface('/ws/ws-1/seo-keywords?tab=lifecycle&filter=tracked&search=cosmetic&page=3&q=emergency+dentist');

    expect(screen.getByRole('radio', { name: 'Lifecycle' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Tracked' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('searchbox')).toHaveValue('cosmetic');
    expect(screen.getByText(/page 3/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'emergency dentist' })).toBeInTheDocument();

    await expectNoA11yViolations(container);
  }, 15_000);

  it('preserves legacy ?tab segment links by treating them as filters', () => {
    renderSurface('/ws/ws-1/seo-keywords?tab=tracked&q=cosmetic+dentistry');

    expect(screen.getByRole('radio', { name: 'Rankings' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Tracked' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'cosmetic dentistry' })).toBeInTheDocument();
  });

  it('mounts at the app shell root after the real feature-flag query resolves ON', async () => {
    renderDashboard();

    expect(screen.getByTestId('legacy-sidebar')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Keywords' })).toBeInTheDocument();
    });

    expect(screen.queryByTestId('legacy-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('legacy-keyword-hub')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument();
  });
});
