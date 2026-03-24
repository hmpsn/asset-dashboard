import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../../src/components/layout/Sidebar';
import type { Workspace } from '../../src/components/WorkspaceSelector';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const WORKSPACES: Workspace[] = [
  { id: 'ws-1', name: 'Acme', webflowSiteId: 'site-1', webflowSiteName: 'acme.com', folder: 'acme', createdAt: '2025-01-01' },
  { id: 'ws-2', name: 'Beta', folder: 'beta', createdAt: '2025-02-01' },
];

const defaultProps = {
  workspaces: WORKSPACES,
  selected: WORKSPACES[0],
  tab: 'home' as const,
  theme: 'dark' as const,
  pendingContentRequests: 0,
  hasContentItems: false,
  onCreate: vi.fn(),
  onDelete: vi.fn(),
  onLinkSite: vi.fn(),
  onUnlinkSite: vi.fn(),
  toggleTheme: vi.fn(),
  onLogout: vi.fn(),
};

function renderSidebar(overrides = {}) {
  return render(
    <MemoryRouter>
      <Sidebar {...defaultProps} {...overrides} />
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('renders the Home nav item', () => {
    renderSidebar();
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('renders nav group labels', () => {
    renderSidebar();
    expect(screen.getByText('ANALYTICS')).toBeInTheDocument();
    expect(screen.getByText('SITE HEALTH')).toBeInTheDocument();
    expect(screen.getByText('SEO')).toBeInTheDocument();
    expect(screen.getByText('CONTENT')).toBeInTheDocument();
  });

  it('renders navigation items within groups', () => {
    renderSidebar();
    expect(screen.getByText('Search Console')).toBeInTheDocument();
    expect(screen.getByText('Site Audit')).toBeInTheDocument();
    expect(screen.getByText('SEO Editor')).toBeInTheDocument();
    expect(screen.getByText('Content Pipeline')).toBeInTheDocument();
  });

  it('highlights the active tab', () => {
    renderSidebar({ tab: 'search' });
    const searchBtn = screen.getByText('Search Console').closest('button')!;
    expect(searchBtn.className).toContain('bg-blue-500/10');
  });

  it('disables items that need a site when no site linked', () => {
    renderSidebar({ selected: WORKSPACES[1] }); // Beta has no webflowSiteId
    const searchBtn = screen.getByText('Search Console').closest('button')!;
    expect(searchBtn.className).toContain('cursor-not-allowed');
  });

  it('shows pending content request badge', () => {
    renderSidebar({ pendingContentRequests: 5 });
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('navigates to settings when settings button clicked', () => {
    renderSidebar();
    const settingsBtn = screen.getByTitle('Settings');
    fireEvent.click(settingsBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
  });

  it('navigates to revenue when revenue button clicked', () => {
    renderSidebar();
    const revenueBtn = screen.getByTitle('Revenue');
    fireEvent.click(revenueBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/revenue');
  });

  it('calls toggleTheme on theme button click', () => {
    const toggleTheme = vi.fn();
    renderSidebar({ toggleTheme });
    fireEvent.click(screen.getByTitle('Switch to light mode'));
    expect(toggleTheme).toHaveBeenCalledOnce();
  });

  it('renders logout button when onLogout provided', () => {
    renderSidebar();
    expect(screen.getByTitle('Log out')).toBeInTheDocument();
  });

  it('does not render logout button when onLogout omitted', () => {
    renderSidebar({ onLogout: undefined });
    expect(screen.queryByTitle('Log out')).not.toBeInTheDocument();
  });

  it('collapses group on click and re-expands', () => {
    renderSidebar();
    const analyticsHeader = screen.getByText('ANALYTICS');
    expect(screen.getByText('Search Console')).toBeInTheDocument();
    fireEvent.click(analyticsHeader);
    expect(screen.queryByText('Search Console')).not.toBeInTheDocument();
    fireEvent.click(analyticsHeader);
    expect(screen.getByText('Search Console')).toBeInTheDocument();
  });
});
