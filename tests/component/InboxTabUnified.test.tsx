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
const mockApplyMutateAsync = vi.fn().mockResolvedValue({ applied: 1, failed: 0, results: [] });
const mockUseUnifiedInbox = vi.fn();
vi.mock('../../src/hooks/client/useUnifiedInbox', () => ({
  useUnifiedInbox: (...args: unknown[]) => mockUseUnifiedInbox(...args),
  useRespondToDeliverable: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
  useApplyDeliverable: () => ({ mutateAsync: mockApplyMutateAsync, isPending: false }),
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

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => mockNavigate,
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
  mockMutateAsync.mockResolvedValue({});
  mockApplyMutateAsync.mockResolvedValue({ applied: 1, failed: 0, results: [] });
});

/** An applyable approval-family item (static seoTitle) for the "Ready to publish" surface. */
function makeApplyableItem(
  overrides: Partial<import('../../shared/types/client-deliverable').ClientDeliverableItem> = {},
): import('../../shared/types/client-deliverable').ClientDeliverableItem {
  return {
    id: 'cdi_1',
    deliverableId: 'cd_apply',
    status: 'approved',
    targetRef: 'page-static-1',
    collectionId: null,
    field: 'seoTitle',
    currentValue: 'Old title',
    proposedValue: 'New title',
    clientValue: null,
    clientNote: null,
    applyable: false, // intentionally false: R3b gates on field/targetRef, not this column (see shared/applyability.ts)
    itemPayload: { pageTitle: 'Home', pageSlug: '/home' },
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** An approved, client-applyable seo_edit deliverable (drives the "Ready to publish" section). */
function makeReadyToPublishDeliverable(): ClientDeliverable {
  return makeDeliverable({
    id: 'cd_apply',
    type: 'seo_edit',
    kind: 'batch',
    status: 'approved',
    title: 'SEO title update for /home',
    summary: '1 change ready to publish',
    payload: { legacyBatchId: 'batch-xyz' },
    decidedAt: new Date().toISOString(),
    items: [makeApplyableItem()],
  });
}

/** A work-order (kind:'order') deliverable for the R5 read-only "Work in progress" track lane. */
function makeWorkOrderDeliverable(overrides: Partial<ClientDeliverable> = {}): ClientDeliverable {
  return makeDeliverable({
    id: 'cd_order',
    type: 'work_order',
    kind: 'order',
    status: 'in_progress',
    title: 'Order: fix meta',
    summary: 'Metadata optimization for your top pages',
    payload: { family: 'work_order', workOrderStatus: 'in_progress', pageIds: ['pg-1', 'pg-2', 'pg-3'] },
    ...overrides,
  });
}

describe('InboxTab unified-inbox flag gating', () => {
  it('flag OFF → does NOT render the unified "Needs your attention" strip', () => {
    mockUseFeatureFlag.mockImplementation(() => false);
    render(<InboxTab {...baseProps} />);
    expect(screen.queryByText('Needs your attention')).not.toBeInTheDocument();
  });

  it('flag OFF → renders the legacy inbox layout (byte-for-byte guarantee)', () => {
    // Both unified-inbox AND new-inbox-ia off → the LegacyInboxLayout must render. Assert a stable
    // legacy-only element so the flag-off path is regression-proof, not just "unified is absent".
    mockUseFeatureFlag.mockImplementation(() => false);
    render(<InboxTab {...baseProps} />);
    // Legacy layout's first section heading (LegacyInboxLayout, InboxTab.tsx) — absent in both the
    // new-IA layout and the unified view.
    expect(screen.getByText('Needs Action & Requests')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Needs Action & Requests' })).toBeInTheDocument();
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

  it('flag ON → PROJECTED item (content_request) "Review →" opens the in-shell review modal, NOT navigation', () => {
    // R4: a projected deliverable has no physical row; its /respond verbs would 404. The card shows
    // a "Review →" CTA instead of Approve / Request changes / Decline — and clicking it now opens the
    // bespoke ContentTab review surface IN-SHELL (ProjectedReviewModal), it does NOT navigate out.
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [
        makeDeliverable({
          id: 'content_request:cr-1',
          externalRef: 'cr-1', // real source id → modal seeds the auto-expand with it, not the '' fallback
          type: 'content_request',
          kind: 'review',
          status: 'awaiting_client',
          title: 'Brief Review: Spring campaign',
          summary: 'spring keyword · informational',
          source: 'content_request',
          sourceRef: 'content_request:cr-1',
        }),
      ],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    // Read-only "Review →" CTA present (no uniform write verbs — they'd 404 on a projected id).
    expect(screen.getByRole('button', { name: 'Review →' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();

    // Before click: the in-shell review modal is not mounted.
    expect(screen.queryByRole('dialog', { name: 'Content Review' })).not.toBeInTheDocument();

    // Clicking "Review →" opens the in-shell ProjectedReviewModal (mounts the bespoke ContentTab
    // surface) — and must NOT navigate the client out to ?tab=reviews.
    fireEvent.click(screen.getByRole('button', { name: 'Review →' }));
    expect(screen.getByRole('dialog', { name: 'Content Review' })).toBeInTheDocument();
    // ContentTab's own PageHeader is rendered inside the modal.
    expect(screen.getByText('Content Pipeline')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('flag ON → PROJECTED copy_section item "Review →" opens the in-shell copy review modal (no navigation)', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [
        makeDeliverable({
          id: 'copy:entry-1',
          externalRef: 'entry-1', // real copy entry id → seeds ClientCopyReview's auto-expand
          type: 'copy_section',
          kind: 'review',
          status: 'awaiting_client',
          title: 'Copy Review: Homepage hero',
          summary: '3 sections, 2 in review',
          source: 'copy_pipeline',
          sourceRef: 'copy:entry-1',
        }),
      ],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Review →' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review →' }));
    // The in-shell ProjectedReviewModal mounts the bespoke ClientCopyReview surface.
    expect(screen.getByRole('dialog', { name: 'Copy Review' })).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('flag ON → approved applyable seo_edit renders the "Ready to publish" section + Apply button', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeReadyToPublishDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    // The R3b "Ready to publish" surface (the D1 fix) renders for an approved applyable deliverable.
    expect(screen.getByText('Ready to publish')).toBeInTheDocument();
    expect(screen.getByText('SEO title update for /home')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply to Website' })).toBeInTheDocument();
    // `approved` is NOT actionable → the uniform write verbs must NOT render for this item.
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('flag ON → Apply to Website → confirm → fires the apply mutation and shows the success toast', async () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeReadyToPublishDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    // Click the card's Apply button → the "Apply to live site?" ConfirmDialog opens (not yet applied).
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Website' }));
    expect(screen.getByText('Apply to live site?')).toBeInTheDocument();
    expect(mockApplyMutateAsync).not.toHaveBeenCalled();

    // Confirm — the dialog's own "Apply to Website" confirm button is the 2nd match (rendered after
    // the card button). Clicking it fires the apply mutation with the deliverable's legacyBatchId.
    const applyButtons = screen.getAllByRole('button', { name: 'Apply to Website' });
    fireEvent.click(applyButtons[applyButtons.length - 1]);

    await vi.waitFor(() => {
      expect(mockApplyMutateAsync).toHaveBeenCalledWith({ legacyBatchId: 'batch-xyz' });
    });
    // FIX 1: applied:1/failed:0 → success toast.
    await vi.waitFor(() => {
      expect(baseProps.setToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: '1 change applied to your website', type: 'success' }),
      );
    });
  });

  it('flag ON → apply returns applied:0/failed:1 → error toast (FIX 1 false-success guard)', async () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeReadyToPublishDeliverable()],
      isLoading: false,
    });
    // The legacy /apply route returns HTTP 200 with applied:0/failed:N on a total write failure — the
    // mutation RESOLVES (no throw), so the toast branching is the only thing preventing a false-success.
    mockApplyMutateAsync.mockResolvedValue({ applied: 0, failed: 1, results: [] });

    render(<InboxTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Website' }));
    const applyButtons = screen.getAllByRole('button', { name: 'Apply to Website' });
    fireEvent.click(applyButtons[applyButtons.length - 1]);

    await vi.waitFor(() => {
      expect(baseProps.setToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Failed to apply changes. Please try again.', type: 'error' }),
      );
    });
    // The success toast must NOT have been shown.
    expect(baseProps.setToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('flag ON → PHYSICAL item renders the write verbs, NOT a "Review →" link', () => {
    // A physical deliverable (redirect) has a real row; the uniform /respond verbs work.
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeDeliverable()], // default type 'redirect' = physical
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review →' })).not.toBeInTheDocument();
  });

  // ── R5 — work-order read-only TRACK lane ──

  it('flag ON → work order renders the "Work in progress" track section (title/summary/chip/stepper)', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeWorkOrderDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    // The dedicated read-only track section + its content.
    expect(screen.getByText('Work in progress')).toBeInTheDocument();
    expect(screen.getByText('Order: fix meta')).toBeInTheDocument();
    expect(screen.getByText('Metadata optimization for your top pages')).toBeInTheDocument();
    // Count-only page summary (NOT raw payload.pageIds). The raw ids must never reach the DOM.
    expect(screen.getByText('3 pages')).toBeInTheDocument();
    expect(screen.queryByText('pg-1')).not.toBeInTheDocument();
    // The status chip (in_progress) renders. The stepper labels include "In Progress" too — so the
    // chip's "In Progress" appears multiple times; just assert it's present at least once.
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1);
    // Stepper steps (canonical ORDER lifecycle, not legacy 'pending').
    expect(screen.getByText('Ordered')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('flag ON → track card wires ZERO verbs (no Approve/Request changes/Decline/Apply/Review) and never calls the mutations', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeWorkOrderDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    // Core requirement: the track card has NO decision/apply verbs (structural verb-safety).
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply to Website' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review →' })).not.toBeInTheDocument();

    // No interaction with the track card can reach the respond/apply mutations — there is no control
    // to click, so neither mutation is ever invoked.
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockApplyMutateAsync).not.toHaveBeenCalled();
  });

  it('flag ON → a work order does NOT appear in the PriorityStrip "Needs your attention" list', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeWorkOrderDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    // Order rows never enter `actionable` → the strip shows the all-caught-up state, not the order.
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
    expect(screen.queryByText('Needs your attention')).not.toBeInTheDocument();
    // The order's title does NOT render as a PriorityStrip CTA item (no "Review Order: fix meta" CTA).
    expect(screen.queryByRole('button', { name: 'Review Order: fix meta' })).not.toBeInTheDocument();
  });

  it('flag ON → a COMPLETED order renders the chip but NOT the stepper', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeWorkOrderDeliverable({ id: 'cd_order_done', status: 'completed', title: 'Order: schema (done)' })],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    expect(screen.getByText('Work in progress')).toBeInTheDocument();
    expect(screen.getByText('Order: schema (done)')).toBeInTheDocument();
    // The "Completed" chip is present...
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
    // ...but the stepper is skipped for completed, so the stepper's "Ordered" / "In Progress" step
    // labels are absent (those only render inside OrderTrackStepper).
    expect(screen.queryByText('Ordered')).not.toBeInTheDocument();
    expect(screen.queryByText('In Progress')).not.toBeInTheDocument();
  });

  it('flag ON → orders-only (no actionable) → the "Nothing needs your attention" message does NOT render', () => {
    mockUseFeatureFlag.mockImplementation((flag: string) => flag === 'unified-inbox');
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeWorkOrderDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    // The track lane is content even though it is not actionable — the empty-state line is suppressed.
    expect(
      screen.queryByText('Nothing needs your attention right now. New items will appear here.'),
    ).not.toBeInTheDocument();
    // The track section is what renders instead.
    expect(screen.getByText('Work in progress')).toBeInTheDocument();
  });

  it('flag OFF → the unified "Work in progress" track section does NOT render', () => {
    mockUseFeatureFlag.mockImplementation(() => false);
    // Even if the hook were to return an order, the flag-off path renders the legacy layout.
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: false,
      deliverables: [makeWorkOrderDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);
    expect(screen.queryByText('Work in progress')).not.toBeInTheDocument();
  });
});
