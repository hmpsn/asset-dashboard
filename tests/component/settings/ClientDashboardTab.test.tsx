/**
 * Component tests for ClientDashboardTab.
 * Covers client access, password management, client users CRUD,
 * content pricing, and the no-webflow-site guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ClientDashboardTab } from '../../../src/components/settings/ClientDashboardTab';

// ── API mocks ────────────────────────────────────────────────────────────────

const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();
const delMock = vi.fn();
const getSafeMock = vi.fn();

vi.mock('../../../src/api/client', () => ({
  get: (...args: unknown[]) => getMock(...args),
  post: (...args: unknown[]) => postMock(...args),
  patch: (...args: unknown[]) => patchMock(...args),
  del: (...args: unknown[]) => delMock(...args),
  getSafe: (...args: unknown[]) => getSafeMock(...args),
}));

// Clipboard API
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  configurable: true,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeWrapper() {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter>{children}</MemoryRouter>
  );
}

const baseWs = {
  hasPassword: false,
  clientEmail: 'test@example.com',
  ga4PropertyId: undefined as string | undefined,
  contentPricing: null as null | { briefPrice: number; fullPostPrice: number; currency: string },
};

const defaultProps = {
  workspaceId: 'ws-123',
  webflowSiteId: 'site-abc',
  ws: baseWs,
  patchWorkspace: vi.fn().mockResolvedValue({}),
  toast: vi.fn(),
};

function renderTab(props: Partial<typeof defaultProps> = {}) {
  return render(<ClientDashboardTab {...defaultProps} {...props} />, {
    wrapper: makeWrapper(),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ClientDashboardTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue([]);
  });

  // ── Guard: no webflow site ────────────────────────────────────────────────

  it('shows "Link a Webflow site first" when webflowSiteId is absent', () => {
    renderTab({ webflowSiteId: undefined });
    expect(screen.getByText(/Link a Webflow site first/i)).toBeInTheDocument();
  });

  it('does not render client access section when webflowSiteId is absent', () => {
    renderTab({ webflowSiteId: undefined });
    expect(screen.queryByText('Client Access')).not.toBeInTheDocument();
  });

  // ── Client access section ─────────────────────────────────────────────────

  it('renders the Client Access heading when webflowSiteId is present', () => {
    renderTab();
    expect(screen.getByText('Client Access')).toBeInTheDocument();
  });

  it('displays dashboard link with workspaceId', () => {
    renderTab();
    expect(screen.getByText(/\/client\/ws-123/)).toBeInTheDocument();
  });

  it('renders Copy button', () => {
    renderTab();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('clicking Copy writes to clipboard and shows "Copied!" text', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    await waitFor(() => expect(defaultProps.toast).toHaveBeenCalledWith('Dashboard link copied'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('/client/ws-123'),
    );
  });

  it('shows "Set Password" button when no password is set', () => {
    renderTab({ ws: { ...baseWs, hasPassword: false } });
    expect(screen.getByRole('button', { name: /set password/i })).toBeInTheDocument();
  });

  it('shows "Password Protected" badge when password is set', () => {
    renderTab({ ws: { ...baseWs, hasPassword: true } });
    expect(screen.getByText(/Password Protected/i)).toBeInTheDocument();
  });

  it('shows Change and Remove buttons when password is set', () => {
    renderTab({ ws: { ...baseWs, hasPassword: true } });
    expect(screen.getByRole('button', { name: /change/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('clicking "Set Password" reveals the password input form', () => {
    renderTab({ ws: { ...baseWs, hasPassword: false } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    expect(screen.getByPlaceholderText(/enter new password/i)).toBeInTheDocument();
  });

  it('Save password button calls patchWorkspace with clientPassword', async () => {
    const patchWorkspace = vi.fn().mockResolvedValue({});
    renderTab({ ws: { ...baseWs, hasPassword: false }, patchWorkspace });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    const input = screen.getByPlaceholderText(/enter new password/i);
    fireEvent.change(input, { target: { value: 'secret123' } });
    // Multiple "Save" buttons may appear (email + password). Target the one
    // adjacent to the password input by taking the first Save within the form row.
    const saveButtons = screen.getAllByRole('button', { name: /^save$/i });
    fireEvent.click(saveButtons[0]);

    await waitFor(() =>
      expect(patchWorkspace).toHaveBeenCalledWith({ clientPassword: 'secret123' }),
    );
  });

  it('Remove password calls patchWorkspace with empty clientPassword', async () => {
    const patchWorkspace = vi.fn().mockResolvedValue({});
    renderTab({ ws: { ...baseWs, hasPassword: true }, patchWorkspace });
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() =>
      expect(patchWorkspace).toHaveBeenCalledWith({ clientPassword: '' }),
    );
  });

  // ── Client notification email ─────────────────────────────────────────────

  it('renders Client Notification Email section', () => {
    renderTab();
    expect(screen.getByText(/Client Notification Email/i)).toBeInTheDocument();
  });

  it('pre-fills email input with ws.clientEmail', () => {
    renderTab();
    const input = screen.getByPlaceholderText(/client@company.com/i);
    expect((input as HTMLInputElement).value).toBe('test@example.com');
  });

  // ── Client users section ──────────────────────────────────────────────────

  it('renders Client Users heading', () => {
    renderTab();
    expect(screen.getByText('Client Users')).toBeInTheDocument();
  });

  it('shows empty state when no client users are returned', async () => {
    getMock.mockResolvedValue([]);
    renderTab();
    await waitFor(() =>
      expect(screen.getByText(/No client users yet/i)).toBeInTheDocument(),
    );
  });

  it('shows user list when client users are returned', async () => {
    getMock.mockResolvedValue([
      { id: 'u1', name: 'Alice Smith', email: 'alice@co.com', role: 'client_owner', lastLoginAt: null },
    ]);
    renderTab();
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(screen.getByText('alice@co.com')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('shows user count when there are users', async () => {
    getMock.mockResolvedValue([
      { id: 'u1', name: 'Alice Smith', email: 'alice@co.com', role: 'client_member', lastLoginAt: null },
      { id: 'u2', name: 'Bob Jones', email: 'bob@co.com', role: 'client_member', lastLoginAt: null },
    ]);
    renderTab();
    await waitFor(() => screen.getByText(/2 users/i));
  });

  it('clicking Add User reveals the new-user form', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /add user/i }));
    expect(screen.getByPlaceholderText(/Jane Smith/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/jane@company.com/i)).toBeInTheDocument();
  });

  it('Add User form submit calls POST endpoint', async () => {
    postMock.mockResolvedValue({});
    getMock.mockResolvedValue([]);
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: /add user/i }));
    fireEvent.change(screen.getByPlaceholderText(/Jane Smith/i), { target: { value: 'Jane Test' } });
    fireEvent.change(screen.getByPlaceholderText(/jane@company.com/i), { target: { value: 'jane@test.com' } });
    fireEvent.change(screen.getByPlaceholderText(/Temporary password/i), { target: { value: 'pass123' } });

    // Click the "Add User" submit button inside the form (primary variant)
    const addButtons = screen.getAllByRole('button', { name: /add user/i });
    fireEvent.click(addButtons[addButtons.length - 1]);

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/api/workspaces/ws-123/client-users',
        expect.objectContaining({ name: 'Jane Test', email: 'jane@test.com' }),
      ),
    );
  });

  it('Cancel in Add User form hides the form', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /add user/i }));
    expect(screen.getByPlaceholderText(/Jane Smith/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByPlaceholderText(/Jane Smith/i)).not.toBeInTheDocument();
  });

  // ── Content pricing section ───────────────────────────────────────────────

  it('renders Content Pricing section', () => {
    renderTab();
    expect(screen.getByText('Content Pricing')).toBeInTheDocument();
  });

  it('shows "No pricing set" when contentPricing is null', () => {
    renderTab({ ws: { ...baseWs, contentPricing: null } });
    expect(screen.getByText(/No pricing set/i)).toBeInTheDocument();
  });

  it('shows pricing values when contentPricing is set', () => {
    renderTab({
      ws: { ...baseWs, contentPricing: { briefPrice: 150, fullPostPrice: 500, currency: 'USD' } },
    });
    expect(screen.getByText('$150')).toBeInTheDocument();
    expect(screen.getByText('$500')).toBeInTheDocument();
  });

  it('shows Active badge when pricing is configured', () => {
    renderTab({
      ws: { ...baseWs, contentPricing: { briefPrice: 150, fullPostPrice: 500, currency: 'USD' } },
    });
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('clicking Configure reveals pricing form', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByPlaceholderText(/150/)).toBeInTheDocument();
  });

  it('Save Pricing calls patchWorkspace with contentPricing', async () => {
    const patchWorkspace = vi.fn().mockResolvedValue({});
    renderTab({ patchWorkspace });
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));

    const briefInput = screen.getByPlaceholderText('150');
    const fullInput = screen.getByPlaceholderText('500');
    fireEvent.change(briefInput, { target: { value: '200' } });
    fireEvent.change(fullInput, { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: /save pricing/i }));

    await waitFor(() =>
      expect(patchWorkspace).toHaveBeenCalledWith({
        contentPricing: expect.objectContaining({ briefPrice: 200, fullPostPrice: 600 }),
      }),
    );
  });

  // ── Event config section (ga4PropertyId present) ──────────────────────────

  it('does not show Event Display section when ga4PropertyId is absent', () => {
    renderTab({ ws: { ...baseWs, ga4PropertyId: undefined } });
    expect(screen.queryByText(/Event Display/i)).not.toBeInTheDocument();
  });

  it('shows Event Display section when ga4PropertyId is present', () => {
    renderTab({ ws: { ...baseWs, ga4PropertyId: 'GA4-123' } });
    expect(screen.getByText(/Event Display/i)).toBeInTheDocument();
  });
});
