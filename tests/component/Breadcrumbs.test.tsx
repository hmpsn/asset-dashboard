import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Breadcrumbs, TAB_LABELS } from '../../src/components/layout/Breadcrumbs';
import type { Workspace } from '../../src/components/WorkspaceSelector';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// NotificationBell uses fetch internally; mock it to avoid side effects
vi.mock('../../src/components/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

const WORKSPACES: Workspace[] = [
  { id: 'ws-1', name: 'Acme', webflowSiteId: 'site-1', webflowSiteName: 'acme.com', folder: 'acme', createdAt: '2025-01-01' },
  { id: 'ws-2', name: 'Beta', folder: 'beta', createdAt: '2025-02-01' },
];

function renderBreadcrumbs(overrides = {}) {
  const props = {
    workspaces: WORKSPACES,
    selected: WORKSPACES[0] as Workspace | null,
    tab: 'home' as const,
    pendingContentRequests: 0,
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <Breadcrumbs {...props} />
    </MemoryRouter>
  );
}

describe('Breadcrumbs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders Command Center link', () => {
    renderBreadcrumbs();
    expect(screen.getByText('Command Center')).toBeInTheDocument();
  });

  it('navigates to / on Command Center click', () => {
    renderBreadcrumbs();
    fireEvent.click(screen.getByText('Command Center'));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('shows workspace name when selected', () => {
    renderBreadcrumbs();
    // acme.com appears in breadcrumb + workspace dropdown
    const matches = screen.getAllByText('acme.com');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows workspace.name when webflowSiteName is missing', () => {
    renderBreadcrumbs({ selected: WORKSPACES[1] });
    // 'Beta' appears in both the breadcrumb and the workspace dropdown
    const matches = screen.getAllByText('Beta');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows tab label when not on home', () => {
    renderBreadcrumbs({ tab: 'seo-audit' });
    expect(screen.getByText('Site Audit')).toBeInTheDocument();
  });

  it('does not show tab breadcrumb segment on home', () => {
    const { container } = renderBreadcrumbs({ tab: 'home' });
    // On home tab, there should be no second '/' separator after workspace name
    const separators = container.querySelectorAll('span.text-zinc-700');
    // Only 1 separator: Command Center / workspace
    expect(separators).toHaveLength(1);
  });

  it('shows back arrow on non-home tab', () => {
    renderBreadcrumbs({ tab: 'seo-editor' });
    expect(screen.getByTitle('Back to workspace home')).toBeInTheDocument();
  });

  it('navigates back to workspace home on back arrow click', () => {
    renderBreadcrumbs({ tab: 'seo-audit' });
    fireEvent.click(screen.getByTitle('Back to workspace home'));
    expect(mockNavigate).toHaveBeenCalledWith('/ws/ws-1');
  });

  it('shows global tab without workspace', () => {
    renderBreadcrumbs({ selected: null, tab: 'settings' });
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.queryByText('acme.com')).not.toBeInTheDocument();
  });

  it('shows pending requests badge when > 0', () => {
    renderBreadcrumbs({ pendingContentRequests: 3 });
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders notification bell', () => {
    renderBreadcrumbs();
    expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
  });

  it('renders command palette trigger', () => {
    renderBreadcrumbs();
    expect(screen.getByTitle('Command Palette (⌘K)')).toBeInTheDocument();
  });

  it('TAB_LABELS has entries for known tabs', () => {
    expect(TAB_LABELS['home']).toBe('Home');
    expect(TAB_LABELS['seo-audit']).toBe('Site Audit');
    expect(TAB_LABELS['analytics-hub']).toBe('Analytics');
    expect(TAB_LABELS['settings']).toBe('Settings');
    expect(TAB_LABELS['revenue']).toBe('Revenue');
  });
});
