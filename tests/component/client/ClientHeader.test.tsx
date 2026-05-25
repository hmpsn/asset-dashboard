/**
 * Component tests for ClientHeader.
 *
 * The header renders workspace name, logo, user avatar, logout button,
 * navigation tabs, date-range controls, and theme toggle. All are purely
 * prop-driven — no hooks or API calls, so no mocks are needed beyond SeoCart
 * (which needs a context it doesn't have in this test environment).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ClientHeader } from '../../../src/components/client/ClientHeader';
import type { WorkspaceInfo, ClientTab } from '../../../src/components/client/types';
import { Home, Search, Activity } from 'lucide-react';

// SeoCartButton pulls from a context that isn't available here.
vi.mock('../../../src/components/client/SeoCart', () => ({
  SeoCartButton: () => <div data-testid="seo-cart-button" />,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseWs: WorkspaceInfo = {
  id: 'ws-hdr',
  name: 'Header Corp',
  tier: 'growth',
};

const NAV = [
  { id: 'overview' as ClientTab, label: 'Overview', icon: Home, locked: false },
  { id: 'search' as ClientTab, label: 'Search', icon: Search, locked: false },
  { id: 'analytics' as ClientTab, label: 'Analytics', icon: Activity, locked: true },
];

const noopRef = { current: null };

const baseProps = {
  ws: baseWs,
  betaMode: false,
  theme: 'dark' as const,
  toggleTheme: vi.fn(),
  tab: 'overview' as ClientTab,
  setTab: vi.fn(),
  NAV,
  days: 28,
  customDateRange: null,
  showDatePicker: false,
  setShowDatePicker: vi.fn(),
  changeDays: vi.fn(),
  applyCustomRange: vi.fn(),
  customStartRef: noopRef,
  customEndRef: noopRef,
  clientUser: null,
  handleClientLogout: vi.fn(),
  setShowUpgradeModal: vi.fn(),
  pendingApprovals: 0,
  unreadTeamNotes: 0,
  contentPlanSummary: null,
  hasData: () => false,
  contentRequests: [],
  hasAnalytics: false,
  hasAnyData: false,
  effectiveTier: 'growth' as const,
};

const renderHeader = (props = {}) =>
  render(
    <MemoryRouter>
      <ClientHeader {...baseProps} {...props} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ClientHeader — workspace branding', () => {
  it('renders the workspace name', () => {
    renderHeader();
    expect(screen.getByText('Header Corp')).toBeInTheDocument();
  });

  it('renders the logo image', () => {
    renderHeader();
    const logo = screen.getByRole('img');
    expect(logo).toBeInTheDocument();
    expect(logo.getAttribute('src')).toBe('/logo.svg');
  });

  it('shows "Insights Engine" subtitle', () => {
    renderHeader();
    expect(screen.getByText(/Insights Engine/i)).toBeInTheDocument();
  });

  it('shows trial badge when workspace is on trial', () => {
    renderHeader({ ws: { ...baseWs, isTrial: true, trialDaysRemaining: 10 } });
    expect(screen.getByText(/Growth Trial · 10d/i)).toBeInTheDocument();
  });

  it('does not show trial badge when not on trial', () => {
    renderHeader();
    expect(screen.queryByText(/Growth Trial/i)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ClientHeader — user avatar and logout', () => {
  it('shows user initials in avatar when clientUser is provided', () => {
    renderHeader({
      clientUser: { id: 'u1', name: 'Jane Smith', email: 'jane@example.com', role: 'editor' },
    });
    // Initials: JS
    expect(screen.getByText('JS')).toBeInTheDocument();
  });

  it('shows user name next to avatar', () => {
    renderHeader({
      clientUser: { id: 'u1', name: 'Jane Smith', email: 'jane@example.com', role: 'editor' },
    });
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('renders logout button when user is logged in', () => {
    renderHeader({
      clientUser: { id: 'u1', name: 'Jane Smith', email: 'jane@example.com', role: 'editor' },
    });
    expect(screen.getByRole('button', { name: /Sign out/i })).toBeInTheDocument();
  });

  it('calls handleClientLogout when logout button is clicked', () => {
    const handleClientLogout = vi.fn();
    renderHeader({
      clientUser: { id: 'u1', name: 'Jane Smith', email: 'jane@example.com', role: 'editor' },
      handleClientLogout,
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign out/i }));
    expect(handleClientLogout).toHaveBeenCalledTimes(1);
  });

  it('does not render user avatar when clientUser is null', () => {
    renderHeader({ clientUser: null });
    expect(screen.queryByText(/sign out/i)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ClientHeader — navigation tabs', () => {
  it('renders all nav tab labels', () => {
    renderHeader();
    expect(screen.getByRole('tab', { name: /Overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Search/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Analytics/i })).toBeInTheDocument();
  });

  it('marks the active tab with aria-selected', () => {
    renderHeader({ tab: 'overview' });
    const overviewTab = screen.getByRole('tab', { name: /Overview/i });
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
  });

  it('marks non-active tabs as not selected', () => {
    renderHeader({ tab: 'overview' });
    const searchTab = screen.getByRole('tab', { name: /Search/i });
    expect(searchTab).toHaveAttribute('aria-selected', 'false');
  });

  it('calls setTab when an unlocked tab is clicked', () => {
    const setTab = vi.fn();
    renderHeader({ setTab });
    fireEvent.click(screen.getByRole('tab', { name: /Search/i }));
    expect(setTab).toHaveBeenCalledWith('search');
  });

  it('calls setShowUpgradeModal when a locked tab is clicked', () => {
    const setShowUpgradeModal = vi.fn();
    renderHeader({ setShowUpgradeModal });
    fireEvent.click(screen.getByRole('tab', { name: /Analytics/i }));
    expect(setShowUpgradeModal).toHaveBeenCalledWith(true);
  });

  it('does NOT call setTab when a locked tab is clicked', () => {
    const setTab = vi.fn();
    renderHeader({ setTab });
    fireEvent.click(screen.getByRole('tab', { name: /Analytics/i }));
    expect(setTab).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ClientHeader — inbox badge', () => {
  it('shows a badge on the inbox tab when pendingApprovals > 0', () => {
    const navWithInbox = [
      ...NAV,
      { id: 'inbox' as ClientTab, label: 'Inbox', icon: Home, locked: false },
    ];
    renderHeader({ NAV: navWithInbox, pendingApprovals: 4 });
    // The badge count is pendingApprovals + pendingReviews + unreadTeamNotes
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('does not show badge when all counts are zero', () => {
    const navWithInbox = [
      { id: 'inbox' as ClientTab, label: 'Inbox', icon: Home, locked: false },
    ];
    renderHeader({ NAV: navWithInbox, pendingApprovals: 0, unreadTeamNotes: 0 });
    // No numeric badge text in DOM
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ClientHeader — theme toggle', () => {
  it('renders theme toggle button in dark mode', () => {
    renderHeader({ theme: 'dark' });
    expect(screen.getByRole('button', { name: /Switch to light mode/i })).toBeInTheDocument();
  });

  it('renders theme toggle button in light mode', () => {
    renderHeader({ theme: 'light' });
    expect(screen.getByRole('button', { name: /Switch to dark mode/i })).toBeInTheDocument();
  });

  it('calls toggleTheme when the button is clicked', () => {
    const toggleTheme = vi.fn();
    renderHeader({ toggleTheme });
    fireEvent.click(screen.getByRole('button', { name: /Switch to light mode/i }));
    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ClientHeader — date range controls', () => {
  it('does not render date buttons when hasAnalytics is false', () => {
    renderHeader({ hasAnalytics: false });
    expect(screen.queryByRole('button', { name: /28d/i })).not.toBeInTheDocument();
  });

  it('renders date range preset buttons when hasAnalytics is true', () => {
    renderHeader({ hasAnalytics: true });
    expect(screen.getByRole('button', { name: /28d/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /7d/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1y/i })).toBeInTheDocument();
  });

  it('calls changeDays with the correct value on preset click', () => {
    const changeDays = vi.fn();
    renderHeader({ hasAnalytics: true, changeDays });
    fireEvent.click(screen.getByRole('button', { name: /7d/i }));
    expect(changeDays).toHaveBeenCalledWith(7, baseWs);
  });
});
