import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InboxTab } from '../../../src/components/client/InboxTab';
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

  it('passes hidePrices through for pricing-sensitive portals', () => {
    renderInbox({ hidePrices: true });
    expect(mockUnifiedInbox).toHaveBeenCalledWith(
      expect.objectContaining({ hidePrices: true }),
    );
  });
});
