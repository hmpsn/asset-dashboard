/**
 * Component tests for the PR-2a unified client inbox (DARK behind `unified-inbox`).
 *
 * Asserts:
 *  1. Flag OFF → the unified view does NOT render (the existing layout shows); the unified
 *     inbox fetch hook is not the active path.
 *  2. Flag ON  → the unified PriorityStrip + DecisionCards render with the three uniform verbs
 *     (Approve / Request changes / Decline), and the verbs call the respond mutation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ClientDeliverable } from '../../shared/types/client-deliverable';

// ── Mocks ──
const mockUseFeatureFlag = vi.fn<(flag: string) => boolean>();
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (flag: string) => mockUseFeatureFlag(flag),
}));

vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: () => {},
}));

const mockMutateAsync = vi.fn().mockResolvedValue({});
const mockUseUnifiedInbox = vi.fn();
vi.mock('../../src/hooks/client/useUnifiedInbox', () => ({
  useUnifiedInbox: (...args: unknown[]) => mockUseUnifiedInbox(...args),
  useRespondToDeliverable: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

// react-query (UnifiedInbox uses useQueryClient)
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useQuery: () => ({ data: undefined, isLoading: false }),
  };
});

vi.mock('react-router-dom', async () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock('../../src/components/client/BetaContext', () => ({
  useBetaMode: () => false,
}));

import { InboxTab } from '../../src/components/client/InboxTab';

function makeDeliverable(overrides: Partial<ClientDeliverable> = {}): ClientDeliverable {
  return {
    id: 'cd_abc',
    workspaceId: 'ws-1',
    externalRef: null,
    type: 'redirect',
    kind: 'decision',
    status: 'awaiting_client',
    title: 'Redirect plan for /old',
    summary: 'We propose 3 redirects',
    payload: {},
    note: null,
    clientResponseNote: null,
    parentDeliverableId: null,
    sentAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    decidedAt: null,
    dueAt: null,
    appliedAt: null,
    generatedAt: null,
    source: null,
    sourceRef: null,
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    ...overrides,
  };
}

const baseProps = {
  workspaceId: 'ws-1',
  effectiveTier: 'growth' as const,
  approvalBatches: [],
  approvalsLoading: false,
  pendingApprovals: 0,
  setApprovalBatches: vi.fn(),
  loadApprovals: vi.fn(),
  requests: [],
  requestsLoading: false,
  clientUser: null,
  loadRequests: vi.fn(),
  contentRequests: [],
  setContentRequests: vi.fn(),
  briefPrice: null,
  fullPostPrice: null,
  fmtPrice: (n: number) => `$${n}`,
  setPricingModal: vi.fn(),
  pricingConfirming: false,
  setToast: vi.fn(),
  clientActions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUnifiedInbox.mockReturnValue({ unifiedInbox: false, deliverables: [], isLoading: false });
});

describe('InboxTab unified-inbox flag gating', () => {
  it('flag OFF → does NOT render the unified "Needs your attention" strip', () => {
    mockUseFeatureFlag.mockImplementation(() => false);
    render(<InboxTab {...baseProps} />);
    expect(screen.queryByText('Needs your attention')).not.toBeInTheDocument();
  });

  it('flag ON → renders the unified PriorityStrip + DecisionCards with the three verbs', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    // PriorityStrip header is shown (it's finally mounted).
    expect(screen.getByText('Needs your attention')).toBeInTheDocument();

    // The title appears in both the PriorityStrip item and the DecisionCard.
    expect(screen.getAllByText('Redirect plan for /old').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();

    // Send age (sentAt) is surfaced.
    expect(screen.getByText('Sent 3 days ago')).toBeInTheDocument();
  });

  it('flag ON → Approve calls the respond mutation with decision=approved', async () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ deliverableId: 'cd_abc', decision: 'approved' }),
    );
  });

  it('flag ON → empty list shows the all-caught-up state', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({ unifiedInbox: true, deliverables: [], isLoading: false });

    render(<InboxTab {...baseProps} />);
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });
});
