import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConnectionsTab } from '../../src/components/settings/ConnectionsTab';

// Hoisted mocks so the factory can close over the mutable refs
const mocks = vi.hoisted(() => ({
  linkSiteMutateAsync: vi.fn(),
  linkSiteIsPending: false,
  flowToken: '',
  flowSetToken: vi.fn(),
  flowShowToken: false,
  flowSetShowToken: vi.fn(),
  flowSites: [] as { id: string; displayName: string; shortName: string }[],
  flowLoadingSites: false,
  flowTokenError: '',
  flowFetchSites: vi.fn(),
  flowReset: vi.fn(),
}));

vi.mock('../../src/hooks/admin/useWorkspaces', () => ({
  useLinkSite: () => ({
    mutateAsync: mocks.linkSiteMutateAsync,
    isPending: mocks.linkSiteIsPending,
  }),
}));

vi.mock('../../src/hooks/useLinkSiteFlow', () => ({
  useLinkSiteFlow: () => ({
    token: mocks.flowToken,
    setToken: mocks.flowSetToken,
    showToken: mocks.flowShowToken,
    setShowToken: mocks.flowSetShowToken,
    sites: mocks.flowSites,
    loadingSites: mocks.flowLoadingSites,
    tokenError: mocks.flowTokenError,
    tokenInputRef: { current: null },
    fetchSites: mocks.flowFetchSites,
    reset: mocks.flowReset,
  }),
}));

vi.mock('../../src/hooks/admin/useIntegrationHealth', () => ({
  useIntegrationHealth: () => ({ data: undefined, isLoading: false }),
}));

const defaultProps = {
  workspaceId: 'ws-1',
  webflowSiteId: undefined as string | undefined,
  webflowSiteName: undefined as string | undefined,
  googleStatus: null,
  gscSites: [],
  ga4Properties: [],
  loadingGoogle: false,
  ws: null,
  connectGoogle: vi.fn(),
  disconnectGoogle: vi.fn(),
  saveGscProperty: vi.fn(),
  saveGa4Property: vi.fn(),
  saveLiveDomain: vi.fn(),
};

function renderTab(props: Partial<typeof defaultProps> = {}) {
  return render(
    <MemoryRouter>
      <ConnectionsTab {...defaultProps} {...props} />
    </MemoryRouter>,
  );
}

describe('ConnectionsTab — site linking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset flow state to defaults
    mocks.flowToken = '';
    mocks.flowSites = [];
    mocks.flowLoadingSites = false;
    mocks.flowTokenError = '';
    mocks.flowShowToken = false;
    mocks.linkSiteIsPending = false;
  });

  it('shows the token input when no site is linked', () => {
    renderTab({ webflowSiteId: undefined });
    expect(screen.getByPlaceholderText(/paste webflow api token/i)).toBeInTheDocument();
  });

  it('does NOT show the token input when a site is already linked', () => {
    renderTab({ webflowSiteId: 'site-abc', webflowSiteName: 'My Site' });
    expect(screen.queryByPlaceholderText(/paste webflow api token/i)).not.toBeInTheDocument();
  });

  it('"Find sites" button calls fetchSites with the current token', async () => {
    mocks.flowToken = 'test-token';
    mocks.flowFetchSites.mockResolvedValue(undefined);

    renderTab({ webflowSiteId: undefined });
    const btn = screen.getByRole('button', { name: /find sites/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mocks.flowFetchSites).toHaveBeenCalledWith('test-token');
    });
  });

  it('calls linkSiteMutation when a site is selected from the list', async () => {
    mocks.flowToken = 'my-token';
    mocks.flowSites = [{ id: 'site-1', displayName: 'Acme Site', shortName: 'acme' }];
    mocks.linkSiteMutateAsync.mockResolvedValue({});

    renderTab({ webflowSiteId: undefined });

    const row = screen.getByText('Acme Site');
    fireEvent.click(row);

    await waitFor(() => {
      expect(mocks.linkSiteMutateAsync).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        siteId: 'site-1',
        siteName: 'Acme Site',
        token: 'my-token',
      });
    });
  });

  it('calls onSiteLinked callback after successful link', async () => {
    mocks.flowToken = 'my-token';
    mocks.flowSites = [{ id: 'site-1', displayName: 'Acme Site', shortName: 'acme' }];
    mocks.linkSiteMutateAsync.mockResolvedValue({});
    const onSiteLinked = vi.fn();

    renderTab({ webflowSiteId: undefined, onSiteLinked });
    fireEvent.click(screen.getByText('Acme Site'));

    await waitFor(() => {
      expect(onSiteLinked).toHaveBeenCalled();
    });
  });
});
