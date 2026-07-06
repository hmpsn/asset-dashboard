import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RebuiltSidebar } from '../../../src/components/layout/RebuiltSidebar';
import { NAV_REGISTRY, NAV_REGISTRY_BY_ID } from '../../../src/lib/navRegistry';
import type { Workspace } from '../../../src/components/WorkspaceSelector';
import type { FeatureFlagKey } from '../../../shared/types/feature-flags';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../../src/hooks/admin/useNotifications', () => ({
  useNotifications: () => ({ data: [] }),
}));

let featureFlagResponse: Partial<Record<FeatureFlagKey, boolean>> = {};
vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      list: () => Promise.resolve(featureFlagResponse),
    },
  };
});

const WORKSPACES: Workspace[] = [
  { id: 'ws-1', name: 'Acme', webflowSiteId: 'site-1', webflowSiteName: 'acme.com', folder: 'acme', createdAt: '2026-01-01' },
  { id: 'ws-2', name: 'Beta', folder: 'beta', createdAt: '2026-02-01' },
];

const defaultProps = {
  workspaces: WORKSPACES,
  selected: WORKSPACES[0],
  tab: 'home' as const,
  theme: 'dark' as const,
  pendingContentRequests: 0,
  onCreate: vi.fn(),
  onDelete: vi.fn(),
  onLinkSite: vi.fn(),
  onUnlinkSite: vi.fn(),
  toggleTheme: vi.fn(),
  onLogout: vi.fn(),
};

function renderSidebar(overrides: Partial<typeof defaultProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RebuiltSidebar {...defaultProps} {...overrides} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function expectBefore(first: HTMLElement, second: HTMLElement) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

describe('RebuiltSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    featureFlagResponse = {};
  });

  afterEach(() => {
    NAV_REGISTRY_BY_ID.features.flagBehavior = undefined;
  });

  it('renders registry groups in the legacy sidebar order', () => {
    renderSidebar();

    const monitoring = screen.getByRole('button', { name: 'MONITORING' });
    const siteHealth = screen.getByRole('button', { name: 'SITE HEALTH' });
    const strategy = screen.getByRole('button', { name: 'STRATEGY' });
    const optimization = screen.getByRole('button', { name: 'OPTIMIZATION' });
    const content = screen.getByRole('button', { name: 'CONTENT' });
    const admin = screen.getByRole('button', { name: 'ADMIN' });

    expectBefore(monitoring, siteHealth);
    expectBefore(siteHealth, strategy);
    expectBefore(strategy, optimization);
    expectBefore(optimization, content);
    expectBefore(content, admin);

    const renderedLabels = new Set(['MONITORING', 'SITE HEALTH', 'STRATEGY', 'OPTIMIZATION', 'CONTENT', 'ADMIN']);
    const nonUtilityGroups = new Set(NAV_REGISTRY.map((entry) => entry.group).filter((group) => group !== 'utility'));
    expect(nonUtilityGroups).toEqual(new Set(['home', 'monitoring', 'site-health', 'seo-strategy', 'optimization', 'content', 'admin']));
    for (const label of renderedLabels) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('disables needsSite items without a linked site and enables them once a site exists', () => {
    const { rerender } = renderSidebar({ selected: WORKSPACES[1] });

    expect(screen.getByRole('button', { name: 'Search & Traffic' })).toHaveAttribute('aria-disabled', 'true');

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <RebuiltSidebar {...defaultProps} selected={WORKSPACES[0]} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('button', { name: 'Search & Traffic' })).not.toHaveAttribute('aria-disabled');
  });

  it('auto-expands the group containing the active tab and marks the item current', async () => {
    localStorage.setItem('admin-sidebar-collapsed', JSON.stringify(['MONITORING']));
    renderSidebar({ tab: 'analytics-hub' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Search & Traffic' })).toHaveAttribute('aria-current', 'page');
    });
    expect(screen.getByRole('button', { name: 'MONITORING' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('persists group collapse state in the shared legacy localStorage key', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'CONTENT' }));

    await waitFor(() => {
      expect(localStorage.getItem('admin-sidebar-collapsed')).toContain('CONTENT');
    });
    expect(screen.queryByRole('button', { name: 'Pipeline' })).not.toBeInTheDocument();
  });

  it('does not render registry entries hidden by a resolved feature flag', async () => {
    NAV_REGISTRY_BY_ID.features.flagBehavior = { flag: 'ui-rebuild-shell', hideWhenOn: true };
    featureFlagResponse = { 'ui-rebuild-shell': true };

    renderSidebar();

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Features' })).not.toBeInTheDocument();
    });
  });

  it('keyboard-walks nav items with roving tabindex and activates the focused item', async () => {
    const user = userEvent.setup();
    renderSidebar();

    const home = screen.getByRole('button', { name: 'Home' });
    home.focus();
    await user.keyboard('{ArrowDown}{Enter}');

    expect(mockNavigate).toHaveBeenCalledWith('/ws/ws-1/analytics-hub');
    // Single-fire: roving onKeyDown preventDefaults, so the native button click must NOT
    // also fire — a regression that drops preventDefault would double-navigate (review PR #1478).
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('mounts the carried-over footer utilities + workspace switcher (additive-parity lock)', () => {
    renderSidebar();

    // The switcher (WorkspaceSelector) surfaces the selected workspace by name.
    expect(screen.getByText('Acme')).toBeInTheDocument();
    // Footer-only utility buttons (their labels don't collide with nav items).
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('shows the pending-content count on the CONTENT group header when it is collapsed', async () => {
    const user = userEvent.setup();
    renderSidebar({ pendingContentRequests: 4 });

    await user.click(screen.getByRole('button', { name: 'CONTENT' }));

    // The content-pipeline item (with its own badge) is now hidden — the count must survive
    // on the collapsed group header (review PR #1478).
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Pipeline' })).not.toBeInTheDocument();
    });
    const header = screen.getByRole('button', { name: /CONTENT/ });
    expect(header).toHaveTextContent('4');
  });

  it('keyboard-walk skips disabled needsSite rows for no-site workspaces', async () => {
    const user = userEvent.setup();
    renderSidebar({ selected: WORKSPACES[1] });

    const home = screen.getByRole('button', { name: 'Home' });
    home.focus();
    await user.keyboard('{ArrowDown}');

    expect(document.activeElement).toHaveTextContent('Action Results');

    await user.keyboard('{Enter}');

    expect(mockNavigate).toHaveBeenCalledWith('/ws/ws-2/outcomes');
  });
});
