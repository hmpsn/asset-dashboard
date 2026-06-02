/**
 * Component tests for the PR-2b admin "Client Deliverables" pane (DARK behind `unified-inbox`).
 *
 * Asserts:
 *  1. Renders the status-axis groups (Awaiting client / Changes requested / Approved (to apply)).
 *  2. A Remind button appears on awaiting_client items and calls the remind mutation; non-awaiting
 *     items (approved/changes_requested) have no Remind button.
 *  3. Stale styling/badge surfaces for stale awaiting items.
 *  4. Empty list → action-oriented empty state.
 *
 * Flag gating is enforced at the hook level (useWorkspaceDeliverables disables the fetch unless the
 * flag is on) and at the mount level (App.tsx only mounts this pane when the flag is ON) — see
 * tests/integration/admin-deliverables-route.test.ts for the endpoint and the App mount branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AdminDeliverableView } from '../../shared/types/admin-deliverable-view';

// ── Mocks ──
vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: () => ({ send: vi.fn() }),
}));

const mockRemindMutate = vi.fn();
const mockUseWorkspaceDeliverables = vi.fn();
vi.mock('../../src/hooks/admin/useWorkspaceDeliverables', () => ({
  useWorkspaceDeliverables: (...args: unknown[]) => mockUseWorkspaceDeliverables(...args),
  useRemindDeliverable: () => ({ mutate: mockRemindMutate, isPending: false }),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

import { ClientDeliverablesPane } from '../../src/components/admin/ClientDeliverablesPane';

function makeView(overrides: Partial<AdminDeliverableView> = {}): AdminDeliverableView {
  return {
    id: 'cd_1',
    workspaceId: 'ws-1',
    externalRef: null,
    type: 'redirect',
    kind: 'decision',
    status: 'awaiting_client',
    title: 'Redirect plan',
    summary: 'Proposed redirects',
    payload: {},
    note: null,
    clientResponseNote: null,
    parentDeliverableId: null,
    sentAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    decidedAt: null,
    dueAt: null,
    appliedAt: null,
    generatedAt: null,
    source: null,
    sourceRef: null,
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    statusAxis: 'awaiting_client',
    ageDays: 2,
    stale: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseWorkspaceDeliverables.mockReturnValue({
    unifiedInbox: true,
    deliverables: [],
    isLoading: false,
  });
});

describe('ClientDeliverablesPane', () => {
  it('renders the status-axis group headers for the populated buckets', () => {
    mockUseWorkspaceDeliverables.mockReturnValue({
      unifiedInbox: true,
      isLoading: false,
      deliverables: [
        makeView({ id: 'cd_await', statusAxis: 'awaiting_client', status: 'awaiting_client' }),
        makeView({
          id: 'cd_changes',
          statusAxis: 'changes_requested',
          status: 'changes_requested',
          title: 'AEO changes',
          ageDays: 5,
        }),
        makeView({
          id: 'cd_approved',
          statusAxis: 'approved',
          status: 'approved',
          title: 'Schema approved',
          ageDays: 1,
        }),
      ],
    });

    render(<ClientDeliverablesPane workspaceId="ws-1" />);

    expect(screen.getByText('Awaiting client')).toBeInTheDocument();
    expect(screen.getByText('Changes requested')).toBeInTheDocument();
    expect(screen.getByText('Approved (to apply)')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Awaiting client' })).toBeInTheDocument();
  });

  it('shows a Remind button on awaiting_client items and calls the remind mutation', () => {
    mockUseWorkspaceDeliverables.mockReturnValue({
      unifiedInbox: true,
      isLoading: false,
      deliverables: [makeView({ id: 'cd_await' })],
    });

    render(<ClientDeliverablesPane workspaceId="ws-1" />);
    const remind = screen.getByRole('button', { name: /Remind/ });
    expect(remind).toBeInTheDocument();

    fireEvent.click(remind);
    expect(mockRemindMutate).toHaveBeenCalledWith('cd_await');
  });

  it('does NOT show a Remind button on non-awaiting items (approved / changes_requested)', () => {
    mockUseWorkspaceDeliverables.mockReturnValue({
      unifiedInbox: true,
      isLoading: false,
      deliverables: [
        makeView({
          id: 'cd_approved',
          statusAxis: 'approved',
          status: 'approved',
          title: 'Schema approved',
        }),
      ],
    });

    render(<ClientDeliverablesPane workspaceId="ws-1" />);
    expect(screen.queryByRole('button', { name: /Remind/ })).not.toBeInTheDocument();
  });

  it('surfaces a stale badge for stale awaiting items', () => {
    mockUseWorkspaceDeliverables.mockReturnValue({
      unifiedInbox: true,
      isLoading: false,
      deliverables: [makeView({ id: 'cd_stale', stale: true, ageDays: 12 })],
    });

    render(<ClientDeliverablesPane workspaceId="ws-1" />);
    // Stale count badge in the header + the per-row stale badge.
    expect(screen.getByText('1 stale')).toBeInTheDocument();
    expect(screen.getByText('Pending 12 days')).toBeInTheDocument();
  });

  it('renders an action-oriented empty state when nothing has been sent', () => {
    render(<ClientDeliverablesPane workspaceId="ws-1" />);
    expect(screen.getByText('Nothing sent to this client yet')).toBeInTheDocument();
  });
});
