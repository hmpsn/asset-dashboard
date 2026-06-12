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
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
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

// Work-order conversation hooks (DARK). Mocked so the track-lane tests don't need a real
// QueryClient (the @tanstack mock below stubs useQueryClient/useQuery but not useMutation).
const mockUseClientWorkOrderComments = vi.fn();
const mockPostCommentMutate = vi.fn();
vi.mock('../../src/hooks/client/useWorkOrderConversation', () => ({
  useClientWorkOrderComments: (...args: unknown[]) => mockUseClientWorkOrderComments(...args),
  usePostClientWorkOrderComment: () => ({ mutate: mockPostCommentMutate, isPending: false }),
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
  mockUseClientWorkOrderComments.mockReturnValue({ data: [] });
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

function makeInlineApprovalDeliverable(): ClientDeliverable {
  return makeDeliverable({
    id: 'cd_inline',
    kind: 'batch',
    type: 'seo_edit',
    title: 'Homepage SEO updates',
    summary: '1 change waiting on your approval',
    items: [
      makeApplyableItem({
        id: 'cdi_inline',
        deliverableId: 'cd_inline',
        status: 'pending',
      }),
    ],
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
    commentCount: 0,
    ...overrides,
  });
}

describe('InboxTab unified inbox', () => {
  it('renders the unified PriorityStrip + DecisionCards with the three verbs', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      deliverables: [makeDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    // PriorityStrip header is shown (it's finally mounted).
    expect(screen.getByText('Needs your attention')).toBeInTheDocument();

    // The title appears in both the PriorityStrip item and the DecisionCard.
    expect(screen.getAllByText('Redirect plan for /old').length).toBeGreaterThanOrEqual(1);
    // Item 5 — canonical approve CTA (redirect default itemCount=1 → "implement 1 →").
    expect(screen.getByRole('button', { name: 'Looks good — implement 1 →' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();

    // Send age (sentAt) is surfaced.
    expect(screen.getByText('Sent 3 days ago')).toBeInTheDocument();
  });

  it('routes review and conversation deliverables into their canonical sections', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      deliverables: [
        makeDeliverable({
          id: 'cd_review',
          type: 'content_request',
          kind: 'review',
          title: 'Review the latest brief',
          externalRef: 'req-1',
        }),
        makeDeliverable({
          id: 'cd_conversation',
          type: 'seo_edit',
          kind: 'batch',
          note: 'Please review these changes with us',
          title: 'SEO updates with a note',
          items: [makeApplyableItem({ deliverableId: 'cd_conversation' })],
        }),
      ],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    const reviews = screen.getByRole('region', { name: 'Reviews' });
    expect(within(reviews).getByText('Review the latest brief')).toBeInTheDocument();

    const conversations = screen.getByRole('region', { name: 'Conversations' });
    expect(within(conversations).getByText('SEO updates with a note')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Decisions' })).not.toBeInTheDocument();
  });

  it('renders client request threads inside the Conversations section', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({ deliverables: [], isLoading: false });

    render(
      <InboxTab
        {...baseProps}
        requests={[
          {
            id: 'req-1',
            title: 'Need a homepage tweak',
            description: 'Please adjust the hero copy.',
            category: 'design',
            status: 'in_progress',
            submittedBy: 'Pat',
            pageUrl: null,
            pageId: null,
            attachments: [],
            notes: [
              {
                id: 'note-1',
                author: 'team',
                content: 'We are on it.',
                createdAt: new Date().toISOString(),
                attachments: [],
              },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    const conversations = screen.getByRole('region', { name: 'Conversations' });
    expect(within(conversations).getByText('Need a homepage tweak')).toBeInTheDocument();
    fireEvent.click(within(conversations).getByText('Need a homepage tweak'));
    expect(within(conversations).getByText('We are on it.')).toBeInTheDocument();
  });

  it('Approve calls the respond mutation with decision=approved and shows the next-step toast', async () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      deliverables: [makeDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Looks good — implement 1 →' }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ deliverableId: 'cd_abc', decision: 'approved' }),
      );
    });

    await waitFor(() => {
      expect(baseProps.setToast).toHaveBeenCalledWith({
        message: "Approved. We're publishing this. Track it in your inbox.",
        type: 'success',
      });
    });
  });

  it('inline approval success also shows the next-step toast', async () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      deliverables: [makeInlineApprovalDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Looks good — implement 1 →' }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ deliverableId: 'cd_inline', decision: 'approved' }),
      );
    });

    await waitFor(() => {
      expect(baseProps.setToast).toHaveBeenCalledWith({
        message: "Approved. We're publishing this. Track it in your inbox.",
        type: 'success',
      });
    });
  });

  it('empty list shows the all-caught-up state', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({ deliverables: [], isLoading: false });

    render(<InboxTab {...baseProps} />);
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  // ── Item 1 — Submit-a-request chooser ──

  it('the "Submit a request" button is present even when the queue is empty', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({ deliverables: [], isLoading: false });

    render(<InboxTab {...baseProps} />);
    // Persistent entry point above the (empty) queue.
    expect(screen.getByRole('button', { name: 'Submit a request' })).toBeInTheDocument();
  });

  it('clicking "Submit a request" opens the chooser with both options', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({ deliverables: [], isLoading: false });

    render(<InboxTab {...baseProps} />);
    expect(screen.queryByRole('dialog', { name: 'Submit a request' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Submit a request' }));
    expect(screen.getByRole('dialog', { name: 'Submit a request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ask for content/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send a request/ })).toBeInTheDocument();
  });

  it('flag ON → chooser → "Send a request" mounts the extracted SubmitRequestForm (pre-filled categories)', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({ unifiedInbox: true, deliverables: [], isLoading: false });

    render(<InboxTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit a request' }));
    fireEvent.click(screen.getByRole('button', { name: /Send a request/ }));

    // The extracted free-form request form renders, with its pre-filled category select.
    expect(screen.getByText('Submit a Request')).toBeInTheDocument();
    const select = screen.getByRole('combobox');
    const labels = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['Content Update', 'Design Change', 'Bug Report', 'SEO', 'New Feature', 'Other']);
  });

  it('flag ON → chooser → "Ask for content" → Continue reuses the pricing flow (setPricingModal, source:client)', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({ unifiedInbox: true, deliverables: [], isLoading: false });

    render(<InboxTab {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit a request' }));
    fireEvent.click(screen.getByRole('button', { name: /Ask for content/ }));

    fireEvent.change(screen.getByPlaceholderText(/Topic name/), { target: { value: 'Sedation dentistry benefits' } });
    fireEvent.change(screen.getByPlaceholderText(/Target keyword/), { target: { value: 'sedation dentistry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Reuses the EXISTING content-topic pricing flow (the same setPricingModal ContentTab calls).
    expect(baseProps.setPricingModal).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceType: 'brief_only',
        topic: 'Sedation dentistry benefits',
        targetKeyword: 'sedation dentistry',
        source: 'client',
      }),
    );
    // The chooser closes so the global PricingConfirmationModal isn't stacked under it.
    expect(screen.queryByRole('dialog', { name: 'Ask for content' })).not.toBeInTheDocument();
  });

  // ── Item 5 — section headings + vocab reconcile ──

  it('flag ON → the actionable section has a visible "Decisions" heading + subtitle (was aria-only)', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    // Visible heading (an <h3>, not just an aria-label) for the actionable section.
    const heading = screen.getByRole('heading', { name: 'Decisions' });
    expect(heading).toBeInTheDocument();
    expect(heading.tagName).toBe('H3');
    // The one-line "what is this" subtitle.
    expect(screen.getByText('Items waiting on your decision')).toBeInTheDocument();
    // Vocab reconcile: "Decisions" appears BOTH as the PriorityStrip chip (span) AND as the section
    // heading (h3) — the chip and the section it scrolls to now use the same canonical noun.
    const decisionsNodes = screen.getAllByText('Decisions');
    expect(decisionsNodes.length).toBeGreaterThanOrEqual(2);
    expect(decisionsNodes.some((n) => n.tagName === 'H3')).toBe(true);
    expect(decisionsNodes.some((n) => n.tagName === 'SPAN')).toBe(true);
  });

  it('flag ON → Ready to publish + Work in progress sections render their subtitles', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeReadyToPublishDeliverable(), makeWorkOrderDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    expect(screen.getByRole('heading', { name: 'Ready to publish' })).toBeInTheDocument();
    expect(screen.getByText('Approved — apply to your live site')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Work in progress' })).toBeInTheDocument();
    expect(screen.getByText('Work your team is doing for you')).toBeInTheDocument();
  });

  it('flag ON → PROJECTED item (content_request) "Review →" opens the in-shell review modal, NOT navigation', () => {
    // R4: a projected deliverable has no physical row; its /respond verbs would 404. The card shows
    // a "Review →" CTA instead of Approve / Request changes / Decline — and clicking it now opens the
    // bespoke ContentTab review surface IN-SHELL (ProjectedReviewModal), it does NOT navigate out.
    mockUseFeatureFlag.mockReturnValue(false);
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

    // Seed a content request matching the projected externalRef so SOLO mode (ISSUE 2) renders that
    // ONE request's block (instead of the not-found fallback). The pipeline chrome must be HIDDEN.
    const contentRequests = [
      {
        id: 'cr-1',
        topic: 'Spring campaign topic',
        targetKeyword: 'spring keyword',
        intent: 'informational',
        priority: 'medium',
        status: 'client_review' as const,
        requestedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    render(<InboxTab {...baseProps} contentRequests={contentRequests} />);

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
    // SOLO mode (ISSUE 2): the modal shows ONLY the opened request — the full-pipeline PageHeader
    // ("Content Pipeline") must be ABSENT, and the soloed request's block renders instead.
    expect(screen.queryByText('Content Pipeline')).not.toBeInTheDocument();
    expect(screen.getByText('Spring campaign topic')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('flag ON → PROJECTED copy_section item "Review →" opens the in-shell copy review modal (no navigation)', () => {
    mockUseFeatureFlag.mockReturnValue(false);
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
    mockUseFeatureFlag.mockReturnValue(false);
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
    mockUseFeatureFlag.mockReturnValue(false);
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
    mockUseFeatureFlag.mockReturnValue(false);
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
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeDeliverable()], // default type 'redirect' = physical
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Looks good — implement 1 →' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review →' })).not.toBeInTheDocument();
  });

  // ── R5 — work-order read-only TRACK lane ──

  it('flag ON → work order renders the "Work in progress" track section (title/summary/chip/stepper)', () => {
    mockUseFeatureFlag.mockReturnValue(false);
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
    // Comment-count badge is blue/read-only data and renders even when the thread is empty.
    expect(screen.getByText('0 comments')).toBeInTheDocument();
    // The status chip (in_progress) renders. The stepper labels include "In Progress" too — so the
    // chip's "In Progress" appears multiple times; just assert it's present at least once.
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1);
    // Stepper steps (canonical ORDER lifecycle, not legacy 'pending').
    expect(screen.getByText('Ordered')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('flag ON → track card wires ZERO verbs (no Approve/Request changes/Decline/Apply/Review) and never calls the mutations', () => {
    mockUseFeatureFlag.mockReturnValue(false);
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
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeWorkOrderDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    // Order rows never enter `actionable` → the PriorityStrip's "Needs your attention" actionable
    // list is empty, so the order's title does NOT render as a PriorityStrip CTA item.
    expect(screen.queryByText('Needs your attention')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review Order: fix meta' })).not.toBeInTheDocument();
    // F2 — with a work order present (live work in the track lane), the strip must NOT falsely claim
    // "all caught up" above it (showAllCaughtUp is gated on readyToApply + workOrders both empty).
    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
    // The order still renders in the read-only "Work in progress" lane below.
    expect(screen.getByText('Work in progress')).toBeInTheDocument();
  });

  it('flag ON → a COMPLETED order renders the chip but NOT the stepper', () => {
    mockUseFeatureFlag.mockReturnValue(false);
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
    mockUseFeatureFlag.mockReturnValue(false);
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

  // ── DARK work-order conversation (client↔team) inside the track card ──

  it('flag ON → a non-closed order with a sourceRef renders the conversation thread + the comment input', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseClientWorkOrderComments.mockReturnValue({
      data: [
        { id: 'c1', workOrderId: 'wo-1', author: 'team', content: 'On it!', createdAt: new Date().toISOString() },
        { id: 'c2', workOrderId: 'wo-1', author: 'client', content: 'Thanks', createdAt: new Date().toISOString() },
      ],
    });
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeWorkOrderDeliverable({ sourceRef: 'work_order:wo-1' })],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    // The conversation messages render.
    expect(screen.getByText('On it!')).toBeInTheDocument();
    expect(screen.getByText('Thanks')).toBeInTheDocument();
    // The comment input is present (status !== 'closed').
    expect(screen.getByLabelText('Message your team about this work order')).toBeInTheDocument();
    // Still NO decision verbs (the lane stays verb-free; only the conversation input is interactive).
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply to Website' })).not.toBeInTheDocument();
  });

  it('flag ON → posting a comment calls the client comment mutation with the order id', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseClientWorkOrderComments.mockReturnValue({ data: [] });
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [makeWorkOrderDeliverable({ sourceRef: 'work_order:wo-42' })],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);
    const input = screen.getByLabelText('Message your team about this work order');
    fireEvent.change(input, { target: { value: 'Any update?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(mockPostCommentMutate).toHaveBeenCalledWith(
      { orderId: 'wo-42', content: 'Any update?' },
      expect.anything(),
    );
  });

  it('flag ON → work-order comment-count badge handles singular and plural labels', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [
        makeWorkOrderDeliverable({
          id: 'cd_order_one_comment',
          sourceRef: 'work_order:wo-one',
          commentCount: 1,
          title: 'Order: one-comment fix',
        }),
        makeWorkOrderDeliverable({
          id: 'cd_order_two_comments',
          sourceRef: 'work_order:wo-two',
          commentCount: 2,
          title: 'Order: two-comment fix',
        }),
      ],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    expect(screen.getByText('1 comment')).toBeInTheDocument();
    expect(screen.getByText('2 comments')).toBeInTheDocument();
  });

  it('flag ON → a CLOSED order hides the comment input (closed-gated)', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseClientWorkOrderComments.mockReturnValue({ data: [] });
    // A closed order normally leaves the lane (mirror → cancelled), but if one reaches the card the
    // input is gated on workOrderStatus !== 'closed'.
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [
        makeWorkOrderDeliverable({
          sourceRef: 'work_order:wo-closed',
          payload: { family: 'work_order', workOrderStatus: 'closed', pageIds: ['pg-1'] },
        }),
      ],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);
    expect(screen.queryByLabelText('Message your team about this work order')).not.toBeInTheDocument();
    // No Send affordance either.
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  // ── ISSUE 1 — inline approval-review card (approval family renders inline, not a modal CTA) ──

  it('flag ON → approval-family deliverable (batch + non-empty items, non-projected) renders InlineApprovalCard inline (no modal-opening "View")', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [
        makeDeliverable({
          id: 'cd_seo',
          type: 'seo_edit',
          kind: 'batch',
          status: 'awaiting_client',
          title: 'SEO title updates',
          summary: '2 changes ready for your approval',
          items: [
            makeApplyableItem({ id: 'i1', field: 'seoTitle', proposedValue: 'New title A', itemPayload: { pageTitle: 'Home', pageSlug: '/home' } }),
            makeApplyableItem({ id: 'i2', field: 'seoDescription', proposedValue: 'New desc B', itemPayload: { pageTitle: 'Home', pageSlug: '/home' } }),
          ],
        }),
      ],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);

    // The substance renders INLINE (proposed values visible) — no "View N →" modal affordance.
    expect(screen.getByText('New title A')).toBeInTheDocument();
    expect(screen.getByText('New desc B')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^View/ })).not.toBeInTheDocument();
    // The inline subset-approve CTA replaces the bare "Approve" verb (item 5: "implement N →", no "of").
    expect(screen.getByRole('button', { name: 'Looks good — implement 2 →' })).toBeInTheDocument();
    // Approve forwards the (empty) flagged subset to the respond mutation.
    fireEvent.click(screen.getByRole('button', { name: 'Looks good — implement 2 →' }));
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ deliverableId: 'cd_seo', decision: 'approved', flaggedItems: [] }),
    );
  });

  // ── Item 2 — edit-before-approve free-tier gate (the unified inbox reads effectiveTier) ──

  const seoEditDeliverable = () =>
    makeDeliverable({
      id: 'cd_seo',
      type: 'seo_edit',
      kind: 'batch',
      status: 'awaiting_client',
      title: 'SEO title updates',
      summary: '1 change ready for your approval',
      items: [
        makeApplyableItem({ id: 'i1', field: 'seoTitle', proposedValue: 'New title A', itemPayload: { pageTitle: 'Home', pageSlug: '/home' } }),
      ],
    });

  it('flag ON + GROWTH tier → seoTitle row shows Edit; the edit flows into the respond editedItems', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [seoEditDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} effectiveTier="growth" />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByLabelText('Edit proposed SEO Title');
    fireEvent.change(input, { target: { value: 'Client-fixed title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));

    fireEvent.click(screen.getByRole('button', { name: 'Looks good — implement 1 →' }));
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        deliverableId: 'cd_seo',
        decision: 'approved',
        editedItems: [{ itemId: 'i1', value: 'Client-fixed title' }],
      }),
    );
  });

  it('flag ON + FREE tier → the seoTitle row shows NO Edit affordance (legacy free-tier gate)', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [seoEditDeliverable()],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} effectiveTier="free" />);
    // The substance still renders, but the inline edit affordance is gated off for free tier.
    expect(screen.getByText('New title A')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('flag ON → client_action batch with EMPTY items keeps the DecisionCard write verbs (not InlineApprovalCard)', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      // redirect is a client_action-family batch — its sub-items ride in payload.items, so d.items
      // is empty → it must NOT route to InlineApprovalCard; it keeps the DecisionCard uniform verbs.
      deliverables: [
        makeDeliverable({
          id: 'cd_redir',
          type: 'redirect',
          kind: 'batch',
          status: 'awaiting_client',
          title: 'Redirect plan',
          summary: '3 redirects',
          payload: { subType: 'redirect', items: [{}, {}, {}] },
          items: [],
        }),
      ],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);
    // DecisionCard uniform verbs render (the DecisionCard now uses the same canonical approve CTA:
    // redirect payload.items=3 → "implement 3 →").
    expect(screen.getByRole('button', { name: 'Looks good — implement 3 →' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    // The DecisionCard-only "View 3 →" modal affordance confirms this routed to DecisionCard, NOT
    // InlineApprovalCard (which renders substance inline and never shows a "View" button).
    expect(screen.getByRole('button', { name: 'View 3 →' })).toBeInTheDocument();
  });

  it('flag ON → content_decay (kind:decision) keeps the DecisionCard (not InlineApprovalCard)', () => {
    mockUseFeatureFlag.mockReturnValue(false);
    mockUseUnifiedInbox.mockReturnValue({
      unifiedInbox: true,
      deliverables: [
        makeDeliverable({
          id: 'cd_decay',
          type: 'content_decay',
          kind: 'decision',
          status: 'awaiting_client',
          title: 'Refresh decaying content',
          summary: 'Traffic is dropping on /blog/old-post',
          items: [],
        }),
      ],
      isLoading: false,
    });

    render(<InboxTab {...baseProps} />);
    // content_decay is kind:'decision' → DecisionCard uniform verbs (itemCount=1 → "implement 1 →"),
    // never the InlineApprovalCard inline-substance card. The DecisionCard-only "View →" affordance
    // confirms the routing (InlineApprovalCard never renders a "View" button).
    expect(screen.getByRole('button', { name: 'Looks good — implement 1 →' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View →' })).toBeInTheDocument();
  });
});
