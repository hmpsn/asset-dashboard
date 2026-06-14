import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { InboxTab } from '../../../src/components/client/InboxTab';
import { BetaProvider } from '../../../src/components/client/BetaContext';
import type { ClientContentRequest, ClientRequest } from '../../../src/components/client/types';

const mockUnifiedInbox = vi.fn();

vi.mock('../../../src/components/client/inbox/UnifiedInbox', () => ({
  UnifiedInbox: (props: unknown) => {
    mockUnifiedInbox(props);
    return <div data-testid="unified-inbox" />;
  },
}));

const baseProps = {
  workspaceId: 'ws-1',
  effectiveTier: 'growth' as const,
  requests: [] as ClientRequest[],
  requestsLoading: false,
  clientUser: { id: 'client-1', name: 'Pat', email: 'pat@example.com', role: 'owner' },
  loadRequests: vi.fn(),
  contentRequests: [] as ClientContentRequest[],
  setContentRequests: vi.fn(),
  briefPrice: 200,
  fullPostPrice: 500,
  fmtPrice: (n: number) => `$${n}`,
  setPricingModal: vi.fn(),
  pricingConfirming: false,
  setToast: vi.fn(),
  hidePrices: false,
};

function renderInbox(props = {}) {
  return render(
    <MemoryRouter initialEntries={['/client/ws-1/inbox']}>
      <InboxTab {...baseProps} {...props} />
    </MemoryRouter>,
  );
}

function renderInboxAt(path: string, props = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <InboxTab {...baseProps} {...props} />
    </MemoryRouter>,
  );
}

function renderBetaInboxAt(path: string, props = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BetaProvider value>
        <InboxTab {...baseProps} {...props} />
      </BetaProvider>
    </MemoryRouter>,
  );
}

function InboxWithRouteControls() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/client/ws-1/inbox?tab=reviews')}>
        Reviews tab
      </button>
      <button type="button" onClick={() => navigate('/client/ws-1/inbox?tab=conversations')}>
        Conversations tab
      </button>
      <InboxTab {...baseProps} />
    </>
  );
}

function renderInboxWithRouteControls() {
  return render(
    <MemoryRouter initialEntries={['/client/ws-1/inbox?tab=decisions']}>
      <InboxWithRouteControls />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InboxTab', () => {
  it('renders the canonical unified inbox wrapper copy', () => {
    renderInbox();
    expect(screen.getByText('Everything that needs your attention — all in one place.')).toBeInTheDocument();
    expect(screen.getByTestId('unified-inbox')).toBeInTheDocument();
  });

  it('passes the unified inbox props through to the canonical inbox surface', () => {
    renderInbox();
    expect(mockUnifiedInbox).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        effectiveTier: 'growth',
        clientUser: expect.objectContaining({ id: 'client-1' }),
        requests: [],
        requestsLoading: false,
        contentRequests: [],
        briefPrice: 200,
        fullPostPrice: 500,
        hidePrices: false,
      }),
    );
  });

  it('resolves legacy inbox aliases through the shared filter resolver', () => {
    renderInboxAt('/client/ws-1/inbox?tab=requests');
    expect(mockUnifiedInbox).toHaveBeenCalledWith(
      expect.objectContaining({ initialFilter: 'conversations' }),
    );
  });

  it('resolves canonical inbox section deep links', () => {
    renderInboxAt('/client/ws-1/inbox?tab=reviews');
    expect(mockUnifiedInbox).toHaveBeenCalledWith(
      expect.objectContaining({ initialFilter: 'reviews' }),
    );

    vi.clearAllMocks();
    renderInboxAt('/client/ws-1/inbox?tab=conversations');
    expect(mockUnifiedInbox).toHaveBeenCalledWith(
      expect.objectContaining({ initialFilter: 'conversations' }),
    );
  });

  it('resolves beta inbox Reviews deep links without coercing them to Decisions', () => {
    renderBetaInboxAt('/client/beta/ws-1/inbox?tab=reviews');
    expect(mockUnifiedInbox).toHaveBeenCalledWith(
      expect.objectContaining({ initialFilter: 'reviews' }),
    );

    vi.clearAllMocks();
    renderBetaInboxAt('/client/beta/ws-1/inbox?tab=content');
    expect(mockUnifiedInbox).toHaveBeenCalledWith(
      expect.objectContaining({ initialFilter: 'reviews' }),
    );
  });

  it('updates the unified inbox filter when the URL tab changes while mounted', () => {
    renderInboxWithRouteControls();
    expect(mockUnifiedInbox).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialFilter: 'decisions' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reviews tab' }));
    expect(mockUnifiedInbox).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialFilter: 'reviews' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Conversations tab' }));
    expect(mockUnifiedInbox).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialFilter: 'conversations' }),
    );
  });

  it('resolves legacy approvals inbox alias to Decisions', () => {
    renderInboxAt('/client/ws-1/inbox?tab=approvals');
    expect(mockUnifiedInbox).toHaveBeenCalledWith(
      expect.objectContaining({ initialFilter: 'decisions' }),
    );
  });

  it('resolves legacy content inbox alias to Reviews', () => {
    renderInboxAt('/client/ws-1/inbox?tab=content');
    expect(mockUnifiedInbox).toHaveBeenCalledWith(
      expect.objectContaining({ initialFilter: 'reviews' }),
    );
  });

  it('passes hidePrices through for pricing-sensitive portals', () => {
    renderInbox({ hidePrices: true });
    expect(mockUnifiedInbox).toHaveBeenCalledWith(
      expect.objectContaining({ hidePrices: true }),
    );
  });
});
