import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RebuiltAppChrome, useRebuildShellEnabled } from '../../../src/components/layout/RebuiltAppChrome';
import type { Workspace } from '../../../src/components/WorkspaceSelector';
import { FEATURE_FLAGS } from '../../../shared/types/feature-flags';

vi.mock('../../../src/hooks/admin/useNotifications', () => ({
  useNotifications: () => ({ data: [] }),
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

const WORKSPACES: Workspace[] = [
  { id: 'ws-1', name: 'Acme', webflowSiteId: 'site-1', webflowSiteName: 'acme.com', folder: 'acme', createdAt: '2026-01-01' },
];

const chromeProps = {
  workspaces: WORKSPACES,
  selected: WORKSPACES[0],
  tab: 'seo-keywords' as const,
  theme: 'dark' as const,
  pendingContentRequests: 0,
  onCreate: vi.fn(),
  onDelete: vi.fn(),
  onLinkSite: vi.fn(),
  onUnlinkSite: vi.fn(),
  toggleTheme: vi.fn(),
  onLogout: vi.fn(),
};

function FlaggedShellProbe() {
  const enabled = useRebuildShellEnabled();
  if (!enabled) return <div data-testid="legacy-shell">legacy shell</div>;
  return (
    <RebuiltAppChrome {...chromeProps}>
      <h1>Keyword pilot body</h1>
    </RebuiltAppChrome>
  );
}

function renderProbe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ws/ws-1/seo-keywords']}>
        <FlaggedShellProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RebuiltAppChrome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('keeps ui-rebuild-shell default OFF', () => {
    expect(FEATURE_FLAGS['ui-rebuild-shell']).toBe(false);
  });

  it('renders sidebar, breadcrumb, skip link, and children after the flag query resolves ON', async () => {
    renderProbe();

    expect(screen.getByTestId('legacy-shell')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Keyword pilot body')).toBeInTheDocument();
    });

    expect(screen.getByText('Skip to content')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getAllByText('Keyword Hub').length).toBeGreaterThanOrEqual(2);
  });
});
