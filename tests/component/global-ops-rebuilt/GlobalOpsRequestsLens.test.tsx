// @ds-rebuilt
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestsLens } from '../../../src/components/global-ops-rebuilt/RequestsLens';
import { expectNoA11yViolations } from '../a11y';

let pendingReplies = 0;
vi.mock('../../../src/hooks/admin/useWorkspaceBadges', () => ({
  useWorkspaceBadges: () => ({
    data: {
      pendingRequests: 0,
      hasContent: false,
      pendingReplies: { count: pendingReplies, requestIds: [], newestAt: null },
    },
  }),
}));

vi.mock('../../../src/components/admin/ClientDeliverablesPane', () => ({
  ClientDeliverablesPane: () => <div data-testid="deliverables-pane">Deliverables capability</div>,
}));
vi.mock('../../../src/components/admin/AdminInbox', () => ({
  AdminInbox: () => <div data-testid="signals-pane">Signals capability</div>,
}));
vi.mock('../../../src/components/RequestManager', () => ({
  RequestManager: () => <div data-testid="requests-pane">Request lifecycle capability</div>,
}));
vi.mock('../../../src/components/admin/ClientActionsTab', () => ({
  ClientActionsTab: () => <div data-testid="actions-pane">Client actions capability</div>,
}));

function renderRequests(initialEntry = '/ws/ws-1/requests') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RequestsLens workspaceId="ws-1" />
    </MemoryRouter>,
  );
}

describe('Global Ops Requests visual composition', () => {
  beforeEach(() => {
    pendingReplies = 0;
  });

  it('uses the prototype-measured canvas and truthful client-return header', async () => {
    const { container } = renderRequests();

    expect(screen.getByTestId('requests-rebuilt')).toHaveClass('max-w-[920px]', 'sm:px-[30px]');
    expect(screen.getByText('Client requests · workspace inbox')).toHaveClass('t-mono');
    expect(screen.getByRole('heading', { level: 1, name: 'What your clients sent back.' })).toHaveClass('t-h1');
    expect(screen.getByText(/Follow deliverables and signals/)).toBeInTheDocument();
    expect(screen.queryByText(/promoted straight into/i)).not.toBeInTheDocument();

    const tabs = within(screen.getByTestId('requests-mode-tray')).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Deliverables', 'Signals', 'All requests', 'Client actions']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByTestId('deliverables-pane')).toHaveLength(1);
    await expectNoA11yViolations(container);
  });

  it('keeps each production capability at one reachable tab home with keyboard navigation', () => {
    renderRequests();
    const tabs = within(screen.getByTestId('requests-mode-tray')).getAllByRole('tab');

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(tabs[1]).toHaveFocus();
    fireEvent.keyDown(tabs[1], { key: 'Enter' });
    expect(screen.getAllByTestId('signals-pane')).toHaveLength(1);
    expect(screen.queryByTestId('deliverables-pane')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'All requests' }));
    expect(screen.getAllByTestId('requests-pane')).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Client actions' }));
    expect(screen.getAllByTestId('actions-pane')).toHaveLength(1);
  });

  it('preserves validated deep links and invalid fallback behavior', () => {
    const result = renderRequests('/ws/ws-1/requests?tab=requests');
    expect(screen.getByTestId('requests-rebuilt')).toHaveAttribute('data-active-tab', 'requests');
    expect(screen.getAllByTestId('requests-pane')).toHaveLength(1);
    result.unmount();

    renderRequests('/ws/ws-1/requests?tab=unknown');
    expect(screen.getByTestId('requests-rebuilt')).toHaveAttribute('data-active-tab', 'deliverables');
    expect(screen.getByTestId('requests-invalid-tab-fallback')).toBeInTheDocument();
  });

  it('lands on the unanswered client section while an explicit deep link still wins', () => {
    pendingReplies = 2;
    const result = renderRequests();
    expect(screen.getByTestId('requests-rebuilt')).toHaveAttribute('data-active-tab', 'requests');
    expect(screen.getAllByTestId('requests-pane')).toHaveLength(1);
    result.unmount();

    renderRequests('/ws/ws-1/requests?tab=deliverables');
    expect(screen.getByTestId('requests-rebuilt')).toHaveAttribute('data-active-tab', 'deliverables');
    expect(screen.getAllByTestId('deliverables-pane')).toHaveLength(1);
  });
});
