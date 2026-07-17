import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RebuiltSidebar } from '../../../src/components/layout/RebuiltSidebar';
import { NAV_REGISTRY_BY_ID, resolveNavLabel } from '../../../src/lib/navRegistry';
import { queryKeys } from '../../../src/lib/queryKeys';
import type { Workspace } from '../../../src/components/WorkspaceSelector';
import type { FeatureFlagKey } from '../../../shared/types/feature-flags';
import { expectNoA11yViolations } from '../a11y';

const mockNavigate = vi.fn();
let pendingReplies = 0;
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../../src/hooks/admin/useNotifications', () => ({
  useNotifications: () => ({ data: [] }),
}));

vi.mock('../../../src/hooks/admin/useWorkspaceBadges', () => ({
  useWorkspaceBadges: () => ({
    data: {
      pendingRequests: 0,
      hasContent: false,
      pendingReplies: { count: pendingReplies, requestIds: [], newestAt: null },
    },
  }),
}));

let featureFlagResponse: Partial<Record<FeatureFlagKey, boolean>> = { 'ui-rebuild-shell': true };
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
  // Pre-seed the feature-flag query so RebuiltSidebar's `useQuery` (staleTime: Infinity)
  // reads the flags SYNCHRONOUSLY from render 1 — no loading→loaded transition to race.
  // The old test waited on that async resolution with waitFor's default 1000ms timeout,
  // which flaked under CI's resource-constrained component shard. Seeding matches the
  // resolved-flag state each test declares via `featureFlagResponse`.
  queryClient.setQueryData(queryKeys.shared.featureFlags(), featureFlagResponse);
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
    featureFlagResponse = { 'ui-rebuild-shell': true };
    pendingReplies = 0;
  });

  afterEach(() => {
    NAV_REGISTRY_BY_ID.features.flagBehavior = undefined;
  });

  it('renders rebuilt sidebar destinations in the prototype zone order', async () => {
    const { container } = renderSidebar();

    const cockpit = screen.getByRole('button', { name: 'Cockpit' });
    const engine = screen.getByRole('button', { name: 'Insights Engine' });
    const strategyContent = screen.getByRole('button', { name: 'STRATEGY & CONTENT' });
    const searchHealth = screen.getByRole('button', { name: 'SEARCH & SITE HEALTH' });
    const optimization = screen.getByRole('button', { name: 'OPTIMIZATION' });
    const clientFacing = screen.getByRole('button', { name: 'CLIENT-FACING' });
    const admin = screen.getByRole('button', { name: 'ADMIN' });

    expectBefore(cockpit, engine);
    expectBefore(engine, strategyContent);
    expectBefore(strategyContent, searchHealth);
    expectBefore(searchHealth, optimization);
    expectBefore(optimization, clientFacing);
    expectBefore(clientFacing, admin);

    for (const label of ['Keywords', 'Competitors', 'Content Pipeline', 'Local Presence', 'Asset Manager', 'AI Visibility', 'Action Results', 'Requests']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    const flagOn = (flag: FeatureFlagKey) => flag === 'ui-rebuild-shell';
    for (const [id, label] of [
      ['seo-strategy', 'Insights Engine'],
      ['seo-keywords', 'Keywords'],
      ['content-pipeline', 'Content Pipeline'],
      ['media', 'Asset Manager'],
    ] as const) {
      expect(resolveNavLabel(NAV_REGISTRY_BY_ID[id], flagOn)).toBe(label);
    }
    expect(screen.queryByRole('button', { name: 'Content Perf' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'MONITORING' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'CONTENT' })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  }, 15_000);

  it('uses styleguide nav roles and token accents for the rebuilt sidebar chrome', () => {
    renderSidebar();

    const strategyContent = screen.getByRole('button', { name: 'STRATEGY & CONTENT' });
    const searchHealth = screen.getByRole('button', { name: 'SEARCH & SITE HEALTH' });
    const optimization = screen.getByRole('button', { name: 'OPTIMIZATION' });
    const clientFacing = screen.getByRole('button', { name: 'CLIENT-FACING' });
    expect(strategyContent).toHaveClass('t-label');
    expect(searchHealth).toHaveClass('t-label');
    expect(optimization).toHaveClass('t-label');
    expect(clientFacing).toHaveClass('t-label');
    expect(strategyContent.parentElement?.style.getPropertyValue('--nav-group-accent')).toBe('var(--blue)');
    expect(searchHealth.parentElement?.style.getPropertyValue('--nav-group-accent')).toBe('var(--cyan)');
    expect(optimization.parentElement?.style.getPropertyValue('--nav-group-accent')).toBe('var(--teal)');
    expect(clientFacing.parentElement?.style.getPropertyValue('--nav-group-accent')).toBe('var(--brand-yellow)');

    const keywords = screen.getByRole('button', { name: 'Keywords' });
    const search = screen.getByRole('button', { name: 'Search & Traffic' });
    const editor = screen.getByRole('button', { name: 'SEO Editor' });
    const outcomes = screen.getByRole('button', { name: 'Action Results' });
    expect(keywords).toHaveClass('t-ui');
    expect(search).toHaveClass('t-ui');
    expect(editor).toHaveClass('t-ui');
    expect(outcomes).toHaveClass('t-ui');
    expect(keywords.style.getPropertyValue('--nav-accent')).toBe('var(--blue)');
    expect(search.style.getPropertyValue('--nav-accent')).toBe('var(--cyan)');
    expect(editor.style.getPropertyValue('--nav-accent')).toBe('var(--teal)');
    expect(outcomes.style.getPropertyValue('--nav-accent')).toBe('var(--brand-yellow)');
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
  }, 15_000);

  it('auto-expands the group containing the active tab and marks the item current', async () => {
    localStorage.setItem('admin-sidebar-collapsed', JSON.stringify(['SEARCH & SITE HEALTH']));
    renderSidebar({ tab: 'analytics-hub' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Search & Traffic' })).toHaveAttribute('aria-current', 'page');
    });
    expect(screen.getByRole('button', { name: 'SEARCH & SITE HEALTH' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('persists group collapse state in the shared legacy localStorage key', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'CLIENT-FACING' }));

    await waitFor(() => {
      expect(localStorage.getItem('admin-sidebar-collapsed')).toContain('CLIENT-FACING');
    });
    expect(screen.queryByRole('button', { name: 'Action Results' })).not.toBeInTheDocument();
  });

  it('does not render registry entries hidden by a resolved feature flag', () => {
    NAV_REGISTRY_BY_ID.features.flagBehavior = { flag: 'ui-rebuild-shell', hideWhenOn: true };
    featureFlagResponse = { 'ui-rebuild-shell': true };

    // The seeded flag query resolves synchronously (see renderSidebar), so the hide takes
    // effect on the first render — assert directly, no flaky async wait.
    renderSidebar();

    expect(screen.queryByRole('button', { name: 'Features' })).not.toBeInTheDocument();
    // Control: a sibling ADMIN-group entry with no flag behavior still renders, so a
    // blanket render failure can't masquerade as "the flag hid the entry".
    expect(screen.getByRole('button', { name: 'Diagnostics' })).toBeInTheDocument();
  });

  it('keyboard-walks nav items with roving tabindex and activates the focused item', async () => {
    const user = userEvent.setup();
    renderSidebar();

    const cockpit = screen.getByRole('button', { name: 'Cockpit' });
    cockpit.focus();
    await user.keyboard('{ArrowDown}{Enter}');

    expect(mockNavigate).toHaveBeenCalledWith('/ws/ws-1/seo-strategy');
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

    await user.click(screen.getByRole('button', { name: 'STRATEGY & CONTENT' }));

    // The content-pipeline item (with its own badge) is now hidden — the count must survive
    // on the collapsed group header (review PR #1478).
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Content Pipeline' })).not.toBeInTheDocument();
    });
    const header = screen.getByRole('button', { name: /STRATEGY & CONTENT/ });
    expect(header).toHaveTextContent('4');
  });

  it('shows the server pending-reply count on Requests and preserves it on the collapsed client-facing group', async () => {
    pendingReplies = 3;
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.getByRole('button', { name: /^Requests/ })).toHaveTextContent('3');
    await user.click(screen.getByRole('button', { name: 'CLIENT-FACING' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Requests/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /CLIENT-FACING/ })).toHaveTextContent('3');
  });

  it('keyboard-walk skips disabled needsSite rows for no-site workspaces', async () => {
    const user = userEvent.setup();
    renderSidebar({ selected: WORKSPACES[1] });

    const cockpit = screen.getByRole('button', { name: 'Cockpit' });
    cockpit.focus();
    await user.keyboard('{ArrowDown}');

    expect(document.activeElement).toHaveTextContent('Asset Manager');

    await user.keyboard('{Enter}');

    expect(mockNavigate).toHaveBeenCalledWith('/ws/ws-2/media');
  });
});
