import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Inbox, FileText, ListChecks, MessageSquare, UploadCloud, Clock, Loader2, CheckCircle2, Send, Plus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LoadingState, Button, ConfirmDialog, ErrorState, StatusBadge, Badge } from '../../ui';
import { FormTextarea } from '../../ui/forms/FormTextarea';
import { PriorityStrip, type PriorityItem } from '../PriorityStrip';
import { DecisionCard } from '../DecisionCard';
import { DeliverableDetailModal } from '../DeliverableDetailModal';
import { InlineApprovalCard } from './InlineApprovalCard';
import { ProjectedReviewModal } from './ProjectedReviewModal';
import { RequestsTab } from '../RequestsTab';
import { SubmitRequestChooserModal } from './SubmitRequestChooserModal';
import { normalizeDeliverable, isProjectedDeliverable } from '../../../lib/decision-adapters';
import { useUnifiedInbox, useRespondToDeliverable, useApplyDeliverable } from '../../../hooks/client/useUnifiedInbox';
import { useClientWorkOrderComments, usePostClientWorkOrderComment } from '../../../hooks/client/useWorkOrderConversation';
import { isClientApplyableDeliverableBatch } from '../../../../shared/applyability';
import type { InboxFilter } from './inbox-filter';
import { useWorkspaceEvents } from '../../../hooks/useWorkspaceEvents';
import { WS_EVENTS } from '../../../lib/wsEvents';
import { invalidateWorkspaceEventQueries } from '../../../lib/wsInvalidation';
import type { ContentTabProps } from '../ContentTab';
import type { ClientRequest } from '../types';
import type { ClientDeliverable, DeliverableKind, DeliverableType } from '../../../../shared/types/client-deliverable';
import type { NormalizedDecision, FlaggedItem } from '../../../../shared/types/decision';

/**
 * The ContentTab pass-through props the unified inbox forwards to the in-shell ProjectedReviewModal
 * (R4). `workspaceId`, `setToast`, the auto-expand seed, AND the solo id are supplied locally, so they
 * are omitted from the bag. Threaded from ClientDashboard → InboxTab → here (flag-ON-only).
 * `soloRequestId` (ISSUE 2d) is supplied by the modal locally — it must NOT be a forwarded
 * pass-through prop.
 */
export type UnifiedInboxContentTabProps = Omit<
  ContentTabProps,
  'workspaceId' | 'setToast' | 'initialExpandedRequestId' | 'soloRequestId'
>;

type UnifiedInboxProps = UnifiedInboxContentTabProps & {
  workspaceId: string;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  initialFilter?: InboxFilter;
  /**
   * Item 1 — the logged-in client user (or null for password-only portals). Threaded so the
   * "Submit a request" chooser can pre-fill the submitter on the free-form request form (matching
   * the legacy RequestsTab behavior). Optional → password-only portals show the "Your Name" field.
   */
  clientUser?: { id: string; name: string; email: string; role: string } | null;
  requests: ClientRequest[];
  requestsLoading: boolean;
  loadRequests: (wsId: string) => void;
};

/**
 * Statuses the client is actively being asked to act on (drive the PriorityStrip).
 *
 * C1 — `changes_requested` is INTENTIONALLY excluded (owner decision: "items just leave"). After the
 * client requests changes, the mirror flips to `changes_requested` — the ball is now in the team's
 * court. That status matches no render bucket here (not actionable, not approved/ready-to-publish,
 * not an order), so the item LEAVES the inbox until the team re-sends it (which returns it to
 * `awaiting_client`). The success toast already confirms the action at the time it's taken.
 * `declined` and approved-non-applyable items already render in no bucket → they already leave.
 */
const ACTIONABLE_STATUSES = new Set(['awaiting_client', 'partial']);

/** PriorityStrip section + icon per deliverable kind (design §5 taxonomy). */
function sectionForKind(kind: DeliverableKind): { section: PriorityItem['section']; icon: LucideIcon } {
  switch (kind) {
    case 'decision':
    case 'batch':
    case 'order':
      return { section: 'decisions', icon: ListChecks };
    case 'review':
      return { section: 'reviews', icon: FileText };
    case 'notification':
      return { section: 'conversations', icon: MessageSquare };
    default:
      return { section: 'decisions', icon: ListChecks };
  }
}

function hasConversationNote(note: string | null | undefined): boolean {
  return typeof note === 'string' && note.trim().length > 0;
}

function sectionForDeliverable(d: ClientDeliverable): PriorityItem['section'] {
  if (d.kind === 'review') return 'reviews';
  if (d.kind === 'notification') return 'conversations';
  if (hasConversationNote(d.note)) return 'conversations';
  return 'decisions';
}

/** Human "Sent N days ago" age from the staleness clock (sentAt). */
function ageLabel(sentAt: string | null | undefined): string | null {
  if (!sentAt) return null;
  const sent = new Date(sentAt).getTime();
  if (Number.isNaN(sent)) return null;
  const days = Math.floor((Date.now() - sent) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'Sent today';
  if (days === 1) return 'Sent 1 day ago';
  return `Sent ${days} days ago`;
}

/**
 * R5 — Work-order TRACK-lane status chip tokens (the canonical ORDER lifecycle). Mirrors the legacy
 * `OrderStatus.tsx` STATUS_BADGE colors, mapped to the Four Laws:
 *   ordered     → amber   (warning hue — a paid, not-yet-started order is waiting)
 *   in_progress → blue    (data hue — read-only progress, never an action; spinner)
 *   completed   → emerald (success hue — fulfilled)
 * NEVER teal here — teal is reserved for actions, and the track lane has NO action.
 */
const ORDER_STATUS_CHIP: Record<'ordered' | 'in_progress' | 'completed', { label: string; icon: LucideIcon; color: string; bg: string; border: string; spin?: boolean }> = {
  ordered:     { label: 'Ordered',     icon: Clock,        color: 'text-accent-warning', bg: 'bg-amber-500/10',   border: 'border-amber-500/20' },
  in_progress: { label: 'In Progress', icon: Loader2,      color: 'text-accent-info',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20', spin: true },
  completed:   { label: 'Completed',   icon: CheckCircle2, color: 'text-accent-success', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
};

/** The canonical ORDER-lifecycle steps the track stepper walks (NOT the legacy `pending`). */
const ORDER_TRACK_STEPS = ['ordered', 'in_progress', 'completed'] as const;
const ORDER_TRACK_STEP_LABELS: Record<(typeof ORDER_TRACK_STEPS)[number], string> = {
  ordered: 'Ordered',
  in_progress: 'In Progress',
  completed: 'Completed',
};

/**
 * OrderTrackStepper — read-only 3-step progress over the canonical ORDER lifecycle. Mirrors the
 * legacy `OrderStatus.tsx` StatusStepper, but over `['ordered','in_progress','completed']` (the
 * legacy uses `'pending'`). The completed-step dots/connectors use teal to mark completed PROGRESS
 * (a data affordance, consistent with OrderStatus) — this is not an action surface.
 */
function OrderTrackStepper({ status }: { status: 'ordered' | 'in_progress' | 'completed' }) {
  const currentIdx = ORDER_TRACK_STEPS.indexOf(status);
  return (
    <div className="flex items-center gap-1 mt-2">
      {ORDER_TRACK_STEPS.map((step, i) => {
        const isActive = i <= currentIdx;
        const isCurrent = i === currentIdx;
        return (
          <div key={step} className="flex items-center gap-1">
            <div className={`flex items-center gap-1 ${isCurrent ? 'opacity-100' : isActive ? 'opacity-70' : 'opacity-30'}`}>
              <div className={`w-2 h-2 rounded-[var(--radius-pill)] ${isActive ? 'bg-teal-400' : 'bg-[var(--brand-border)]'}`} />
              <span className={`t-micro ${isActive ? 'text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)]'}`}>{ORDER_TRACK_STEP_LABELS[step]}</span>
            </div>
            {i < ORDER_TRACK_STEPS.length - 1 && (
              <div className={`w-4 h-px ${i < currentIdx ? 'bg-teal-400' : 'bg-[var(--brand-border)]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Extract the work order id from a deliverable sourceRef (`work_order:<id>`), or null. */
function workOrderIdFromSourceRef(sourceRef: string | null): string | null {
  if (!sourceRef) return null;
  const prefix = 'work_order:';
  return sourceRef.startsWith(prefix) ? sourceRef.slice(prefix.length) : null;
}

/**
 * WorkOrderTrackCard — one read-only "Work in progress" track-lane card plus the client↔team
 * conversation thread + comment input.
 *
 * VERB-FREE by contract: a work order is NOT a decision. There is NO approve / decline / apply /
 * review affordance — the conversation + the status stepper are the only client affordances. The
 * comment input is the single interactive element (a question/note to the team), and it is gated on
 * `status !== 'closed'` (a closed order leaves the lane via the mirror anyway).
 */
function WorkOrderTrackCard({
  deliverable,
  workspaceId,
}: {
  deliverable: ClientDeliverable;
  workspaceId: string;
}) {
  const d = deliverable;
  const orderStatus: 'ordered' | 'in_progress' | 'completed' =
    d.status === 'in_progress' || d.status === 'completed' ? d.status : 'ordered';
  const chip = ORDER_STATUS_CHIP[orderStatus];
  const ChipIcon = chip.icon;
  const age = ageLabel(d.sentAt);
  // Count-only page summary — NEVER render raw payload.pageIds (raw Webflow ids).
  const rawPageIds = (d.payload as { pageIds?: unknown }).pageIds;
  const pageCount = Array.isArray(rawPageIds) ? rawPageIds.length : 0;
  const commentCount = typeof d.commentCount === 'number' ? d.commentCount : null;
  const commentCountLabel =
    commentCount === null
      ? null
      : `${commentCount} comment${commentCount === 1 ? '' : 's'}`;

  const orderId = workOrderIdFromSourceRef(d.sourceRef);
  // Closed orders leave the lane (mirror → cancelled), so this card never renders for `closed`;
  // the explicit gate is belt-and-suspenders so the input can never appear on a closed order.
  const isClosed = (d.payload as { workOrderStatus?: unknown }).workOrderStatus === 'closed';
  const canComment = !!orderId && !isClosed;

  const { data: comments } = useClientWorkOrderComments(workspaceId, orderId);
  const postComment = usePostClientWorkOrderComment(workspaceId);
  const [draft, setDraft] = useState('');

  const handleSend = () => {
    const content = draft.trim();
    if (!content || !orderId) return;
    postComment.mutate({ orderId, content }, { onSuccess: () => setDraft('') });
  };

  return (
    <div
      // pr-check-disable-next-line -- brand signature radius intentional; mirrors DecisionCard visual identity
      className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden p-4"
      style={{ borderRadius: 'var(--radius-signature-lg)' }}
    >
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span
          className={`inline-flex items-center gap-1.5 t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] border ${chip.bg} ${chip.border} ${chip.color}`}
        >
          <ChipIcon className={`w-3 h-3 ${chip.spin ? 'animate-spin' : ''}`} />
          {chip.label}
        </span>
        {commentCountLabel && (
          <Badge
            tone="blue"
            variant="soft"
            shape="pill"
            icon={MessageSquare}
            label={commentCountLabel}
            ariaLabel={`${commentCountLabel} on this work order`}
          />
        )}
      </div>
      {/* duplicate-heading-ok -- distinct section: the work-order TRACK-lane card title mirrors the "Ready to publish" card title intentionally (two separate sections, same card grammar) */}
      <h4 className="t-body font-semibold text-[var(--brand-text-bright)]">{d.title}</h4>
      {d.summary && (
        <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{d.summary}</p>
      )}
      {/* Skip the stepper for `completed` — there is no progress left to show. */}
      {orderStatus !== 'completed' && <OrderTrackStepper status={orderStatus} />}
      <div className="flex items-center gap-2 mt-2 flex-wrap t-caption-sm text-[var(--brand-text-muted)]">
        {pageCount > 0 && (
          <span>{pageCount} page{pageCount !== 1 ? 's' : ''}</span>
        )}
        {pageCount > 0 && age && <span aria-hidden="true">·</span>}
        {age && <span>{age}</span>}
      </div>

      {/* Conversation — verb-free: a question/note thread with the team, NOT a decision surface. */}
      {orderId && (
        <div className="mt-3 pt-3 border-t border-[var(--brand-border)]">
          {(comments ?? []).length > 0 && (
            <ul className="space-y-2 mb-2">
              {(comments ?? []).map((c) => (
                <li
                  key={c.id}
                  className={`max-w-[85%] px-3 py-2 ${
                    // SG-2 — the client's own bubble is BLUE (client context = read-only data per
                    // BRAND_DESIGN_LANGUAGE.md; teal = actions). The team bubble stays neutral.
                    c.author === 'client'
                      ? 'ml-auto bg-blue-500/10 border border-blue-500/30'
                      : 'mr-auto bg-[var(--surface-3)] border border-[var(--brand-border)]'
                  }`}
                  style={{ borderRadius: 'var(--radius-md)' }}
                >
                  <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] mb-0.5">
                    {c.author === 'client' ? 'You' : 'Your team'}
                  </div>
                  <p className="t-caption text-[var(--brand-text-bright)] whitespace-pre-wrap">{c.content}</p>
                </li>
              ))}
            </ul>
          )}
          {canComment && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <FormTextarea
                  value={draft}
                  onChange={setDraft}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend(); }
                  }}
                  placeholder="Ask your team a question…"
                  rows={2}
                  maxLength={2000}
                  aria-label="Message your team about this work order"
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                icon={Send}
                loading={postComment.isPending}
                disabled={!draft.trim() || postComment.isPending}
                onClick={handleSend}
              >
                Send
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * SectionHeading — the visible heading + one-line "what is this" subtitle shared by every inbox
 * section (item 5). Token-styled `t-label` uppercase heading (matching BRAND_DESIGN_LANGUAGE §
 * "Client Inbox IA — 3-Section Layout") plus a muted subtitle. Used by the actionable "Decisions"
 * section (which previously had NO visible heading — only an aria-label), "Ready to publish", and
 * "Work in progress" so all three read consistently and the PriorityStrip chips agree with the
 * sections they scroll to.
 */
function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      {/* duplicate-heading-ok -- distinct inbox sections deliberately share the same heading grammar */}
      <h3 className="t-label text-[var(--brand-text-muted)] uppercase tracking-wide">{title}</h3>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{subtitle}</p>
    </div>
  );
}

/**
 * UnifiedInbox — the canonical client inbox.
 *
 * Mounts the previously-orphaned `PriorityStrip` as the single prioritized "Needs your attention"
 * list, backed by the unified deliverables read endpoint, and renders one `DecisionCard` per
 * deliverable with uniform Approve / Request changes (+note) / Decline verbs that call the REAL
 * PATCH /respond endpoint. Mobile-sane (stacked cards, no wide tables).
 *
 * This component is rendered by InboxTab as the canonical client inbox; the hook is
 * additionally keyed so deep-links can bias the initial section ordering.
 */
export function UnifiedInbox({
  workspaceId,
  setToast,
  clientUser,
  initialFilter,
  requests,
  requestsLoading,
  loadRequests,
  ...contentTabProps
}: UnifiedInboxProps) {
  const queryClient = useQueryClient();
  // Item 2 — edit-before-approve is gated to the non-free tier (legacy ApprovalsTab parity:
  // edit/approve were behind `effectiveTier !== 'free'`). `effectiveTier` rides in the ContentTab
  // pass-through props the inbox already receives.
  const editable = contentTabProps.effectiveTier !== 'free';
  // Item 1 — the "Submit a request" chooser modal open state.
  const [chooserOpen, setChooserOpen] = useState(false);
  const { deliverables, isLoading, isError, refetch } = useUnifiedInbox(workspaceId);
  const respond = useRespondToDeliverable(workspaceId);
  const apply = useApplyDeliverable(workspaceId);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  // R3: the deliverable open in the detail modal (substance + per-item review). null = closed.
  const [detailId, setDetailId] = useState<string | null>(null);
  // R3b — Apply to Website: the deliverable pending the "Apply to live site?" confirmation. null = no dialog.
  const [applyConfirm, setApplyConfirm] = useState<ClientDeliverable | null>(null);
  // R4 — in-shell projected review: the projected deliverable (copy_section / content_request) open
  // in the bespoke review modal. null = closed. We carry the raw `type` + `externalRef` (the source
  // id) read off the RAW deliverable — normalizeDeliverable drops both.
  const [reviewProjected, setReviewProjected] = useState<{ type: DeliverableType; externalRef: string } | null>(null);

  // Two-halves broadcast contract (CLAUDE.md Data Flow #2): the server emits DELIVERABLE_*
  // on every send/response; this handler invalidates the unified inbox query so the list reflects
  // the change in real time.
  //
  // R4 — the PROJECTED respond paths go through the bespoke copy-pipeline / content-request / posts
  // routes, which broadcast COPY_SECTION_UPDATED / CONTENT_REQUEST_UPDATE / POST_UPDATED (NOT
  // DELIVERABLE_*). Without listening on those, an in-shell respond would leave the projected card
  // stuck in the list. We invalidate the unified-inbox query on all three so the card leaves the
  // list once the bespoke respond lands. NOTE: this does NOT auto-close the ProjectedReviewModal —
  // its mount is gated on the independent `reviewProjected` state (not derived from the list, unlike
  // `detailDeliverable`), so the modal stays open showing the self-updated bespoke surface until the
  // client dismisses it (close / Escape / backdrop). These events are already broadcast + handled
  // elsewhere (tests/integration/broadcast-handler-pairs.test.ts stays green).
  const wsHandlers = useMemo(
    () => {
      const invalidateInbox = (eventName: typeof WS_EVENTS[keyof typeof WS_EVENTS], data?: unknown) =>
        invalidateWorkspaceEventQueries(queryClient, eventName, workspaceId, data, 'client-unified-inbox');
      return {
        // ws-invalidation-ok — client unified-inbox key differs from any admin deliverable key
        [WS_EVENTS.DELIVERABLE_SENT]: () => invalidateInbox(WS_EVENTS.DELIVERABLE_SENT),
        // ws-invalidation-ok — client unified-inbox key differs from any admin deliverable key
        [WS_EVENTS.DELIVERABLE_UPDATED]: () => invalidateInbox(WS_EVENTS.DELIVERABLE_UPDATED),
        // ws-invalidation-ok — client unified-inbox key differs from any admin copy/content key
        [WS_EVENTS.COPY_SECTION_UPDATED]: () => invalidateInbox(WS_EVENTS.COPY_SECTION_UPDATED),
        // ws-invalidation-ok — client unified-inbox key differs from any admin copy/content key
        [WS_EVENTS.CONTENT_REQUEST_UPDATE]: () => invalidateInbox(WS_EVENTS.CONTENT_REQUEST_UPDATE),
        // ws-invalidation-ok — client unified-inbox key differs from any admin copy/content key
        [WS_EVENTS.POST_UPDATED]: () => invalidateInbox(WS_EVENTS.POST_UPDATED),
        // Work-order status change: on close-out the PATCH→closed broadcasts WORK_ORDER_UPDATE
        // and the mirror flips the deliverable to `cancelled` → it leaves the inbox lane. Without
        // this the client card lingers until another event. The same broadcast also covers
        // mark-complete transitions that change the card's verbs.
        // ws-invalidation-ok — client unified-inbox key differs from any admin work-order key
        [WS_EVENTS.WORK_ORDER_UPDATE]: () => invalidateInbox(WS_EVENTS.WORK_ORDER_UPDATE),
        // Work-order conversation: a team reply (or the client's own post echoed) — refresh the
        // commented order's thread so the client sees replies live. The payload carries { id: orderId }.
        // ws-invalidation-ok — client work-order-comment thread key differs from any admin key
        [WS_EVENTS.WORK_ORDER_COMMENT]: (data: unknown) => invalidateInbox(WS_EVENTS.WORK_ORDER_COMMENT, data),
      };
    },
    [queryClient, workspaceId],
  );
  useWorkspaceEvents(workspaceId, wsHandlers);

  const actionable = useMemo(
    () => deliverables.filter((d) => ACTIONABLE_STATUSES.has(d.status)),
    [deliverables],
  );

  // R3b "Ready to publish": already-approved deliverables that are client-applyable through the
  // legacy /apply route (the shared predicate mirrors that route's field/targetRef/collectionId
  // gate — see shared/applyability.ts). `approved` is intentionally NOT in ACTIONABLE_STATUSES (it
  // must not re-show approve/decline verbs), but it IS client-facing, so these rows ARE present in
  // `deliverables`. Non-applyable approved deliverables (schema, content_plan, approved
  // client_actions) are excluded by the predicate and simply do not appear here.
  const readyToApply = useMemo(
    () => deliverables.filter((d) => d.status === 'approved' && isClientApplyableDeliverableBatch(d.items ?? [])),
    [deliverables],
  );

  // R5 — work-order TRACK lane: `kind:'order'` rows the client FOLLOWS (no decision). The server read
  // (unified-inbox-read.ts) admits these in `ordered`/`in_progress`/`completed` ONLY for kind:'order'
  // (cancelled excluded). They never enter `actionable` (ACTIONABLE_STATUSES has no order status), so
  // they never reach the PriorityStrip — they render in a dedicated read-only "Work in progress"
  // section below with ZERO verbs (structural verb-safety: there is no verb to wire).
  const workOrders = useMemo(() => deliverables.filter((d) => d.kind === 'order'), [deliverables]);

  // The deliverable open in the detail modal, resolved from the full client-facing `deliverables`
  // list (so approved/ready-to-publish items render too, not just actionable ones) and kept in sync
  // by a WS-driven refetch. null when closed, or when the item leaves CLIENT_FACING_STATUSES
  // (e.g. after a successful apply → `applied`, which is filtered out of the list).
  const detailDeliverable = useMemo(
    () => (detailId ? deliverables.find((d) => d.id === detailId) ?? null : null),
    [deliverables, detailId],
  );

  const selectedFilter = initialFilter ?? 'all';
  const sectionIsVisible = (section: InboxFilter) =>
    selectedFilter === 'all' || selectedFilter === section;

  const decisionDeliverables = useMemo(
    () => actionable.filter((d) => sectionForDeliverable(d) === 'decisions'),
    [actionable],
  );
  const reviewDeliverables = useMemo(
    () => actionable.filter((d) => sectionForDeliverable(d) === 'reviews'),
    [actionable],
  );
  const conversationDeliverables = useMemo(
    () => actionable.filter((d) => sectionForDeliverable(d) === 'conversations'),
    [actionable],
  );

  const handleRespond = async (
    d: ClientDeliverable,
    decision: 'approved' | 'changes_requested' | 'declined',
    note?: string,
    flaggedItems?: FlaggedItem[],
    // Item 2 — the per-item edited proposed values (seoTitle/seoDescription) on an approve.
    editedItems?: { itemId: string; value: string }[],
  ) => {
    setSubmittingId(d.id);
    try {
      await respond.mutateAsync({ deliverableId: d.id, decision, note, flaggedItems, editedItems });
      const heldCount = decision === 'approved' ? flaggedItems?.length ?? 0 : 0;
      setToast({
        message:
          decision === 'approved'
            ? heldCount > 0
              ? `Approved. ${heldCount} item${heldCount === 1 ? '' : 's'} held for your team to review.`
              : "Approved. We're publishing this. Track it in your inbox."
            : decision === 'declined'
              ? 'Declined. Your team has been notified.'
              : 'Feedback sent to your team.',
        type: 'success',
      });
      // Close the detail modal after a successful response from inside it.
      setDetailId((cur) => (cur === d.id ? null : cur));
    } catch {
      setToast({ message: 'Could not submit your response. Please try again.', type: 'error' });
    } finally {
      setSubmittingId(null);
    }
  };

  // R3b — open the "Apply to live site?" confirmation (copy mirrors the legacy ApprovalBatchCard).
  const onApply = (d: ClientDeliverable) => setApplyConfirm(d);

  // R3b — run the apply after the client confirms. Reads the legacy batch id off the deliverable's
  // payload (typeof-guard) and calls the SAME proven legacy /apply route via the typed mutation.
  // The legacy /apply route returns HTTP 200 even on a total runtime Webflow write failure
  // (`applied:0, failed:N`), so we MUST branch on the result body — never show success
  // unconditionally (FM-2 anti-pattern). Mirrors the proven legacy ApprovalBatchCard guard.
  // Post-apply UX on full success: the deliverable flips to `applied`, which is filtered OUT
  // of the client-facing list (CLIENT_FACING_STATUSES excludes `applied`). On refetch the item LEAVES
  // the inbox (both the actionable + ready-to-publish sections) and the modal auto-unmounts
  // (detailDeliverable → null). On partial/total failure the mirror stays `approved` (server gate,
  // FIX 2) so the item remains in "Ready to publish" and the client can retry the failed items.
  const confirmApply = async () => {
    const d = applyConfirm;
    setApplyConfirm(null);
    if (!d) return;
    const legacyBatchId = (d.payload as { legacyBatchId?: unknown }).legacyBatchId;
    if (typeof legacyBatchId !== 'string' || !legacyBatchId) {
      setToast({ message: 'Could not apply: this item is missing its source reference.', type: 'error' });
      return;
    }
    try {
      const data = await apply.mutateAsync({ legacyBatchId });
      if (data.applied > 0 && data.failed === 0) {
        setToast({
          message: `${data.applied} change${data.applied !== 1 ? 's' : ''} applied to your website`,
          type: 'success',
        });
      } else if (data.applied > 0 && data.failed > 0) {
        setToast({
          message: `${data.applied} applied, ${data.failed} failed — please retry`,
          type: 'error',
        });
      } else {
        setToast({ message: 'Failed to apply changes. Please try again.', type: 'error' });
      }
    } catch {
      setToast({ message: 'Failed to apply changes. Please try again.', type: 'error' });
    }
  };

  const priorityItems: PriorityItem[] = actionable.map((d) => {
    const { icon } = sectionForKind(d.kind);
    const section = sectionForDeliverable(d);
    return {
      id: d.id,
      icon,
      title: d.title,
      section,
      ctaLabel: 'Review',
      onCta: () => {
        const el = document.getElementById(`unified-decision-${d.id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    };
  }).filter((item) => sectionIsVisible(item.section));

  const renderActionableDeliverable = (d: ClientDeliverable) => {
    const decision: NormalizedDecision = normalizeDeliverable(d);
    const projected = isProjectedDeliverable(d.type);
    const inlineApproval = !projected && d.kind === 'batch' && (d.items?.length ?? 0) > 0;

    return (
      <div key={d.id} id={`unified-decision-${d.id}`}>
        {inlineApproval ? (
          <InlineApprovalCard
            decision={decision}
            ageLabel={ageLabel(d.sentAt)}
            submitting={submittingId === d.id}
            editable={editable}
            onApprove={(f, e) => void handleRespond(d, 'approved', undefined, f, e)}
            onRequestChanges={(n) => void handleRespond(d, 'changes_requested', n || undefined)}
            onDecline={(n) => void handleRespond(d, 'declined', n || undefined)}
          />
        ) : (
          <DecisionCard
            decision={decision}
            uniformVerbs
            submitting={submittingId === d.id}
            ageLabel={ageLabel(d.sentAt)}
            onReview={projected ? () => setReviewProjected({ type: d.type, externalRef: d.externalRef ?? '' }) : undefined}
            onOpen={projected ? () => {} : () => setDetailId(d.id)}
            onApprove={
              projected || submittingId === d.id
                ? undefined
                : () => void handleRespond(d, 'approved')
            }
            onFlagWithNote={
              projected || submittingId === d.id
                ? undefined
                : (note) => void handleRespond(d, 'changes_requested', note || undefined)
            }
            onDecline={
              projected || submittingId === d.id
                ? undefined
                : (note) => void handleRespond(d, 'declined', note || undefined)
            }
          />
        )}
      </div>
    );
  };

  if (isLoading) {
    return <LoadingState message="Loading your inbox items..." size="lg" />;
  }

  // F1 — a failed fetch must NOT render the green "all caught up" empty state (that would falsely tell
  // the client there's nothing for them when we simply couldn't load the list). Show an empathetic
  // retry instead (CLAUDE.md UI/UX rule 4).
  if (isError) {
    return (
      <ErrorState
        type="network"
        title="Couldn't load your inbox"
        message="We had trouble loading your items. Please try again in a moment."
        action={{ label: 'Retry', onClick: () => void refetch() }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Item 1 — persistent "Submit a request" entry point. Lives at the TOP of the tree (above the
          PriorityStrip) so flag-on clients can always initiate a request — even when the queue is
          empty. Opens the chooser ("Ask for content" vs "Send a request"). */}
      <div className="flex items-center justify-end">
        <Button size="sm" variant="primary" icon={Plus} onClick={() => setChooserOpen(true)}>
          Submit a request
        </Button>
      </div>

      {/* The single prioritized "Needs your attention" list (PriorityStrip, finally mounted).
          F2 — only claim "all caught up" when there is NO live work below either: an empty actionable
          queue with items in Ready-to-publish or Work-in-progress must NOT show the banner above them. */}
      <PriorityStrip
        items={priorityItems}
        showAllCaughtUp={
          priorityItems.length === 0 &&
          (!sectionIsVisible('decisions') || readyToApply.length === 0) &&
          (!sectionIsVisible('decisions') || workOrders.length === 0) &&
          (!sectionIsVisible('conversations') || requests.length === 0)
        }
      />

      {sectionIsVisible('decisions') && decisionDeliverables.length > 0 && (
        <section aria-label="Decisions" className="space-y-3">
          <SectionHeading title="Decisions" subtitle="Items waiting on your decision" />
          {decisionDeliverables.map(renderActionableDeliverable)}
        </section>
      )}

      {sectionIsVisible('reviews') && reviewDeliverables.length > 0 && (
        <section aria-label="Reviews" className="space-y-3">
          <SectionHeading title="Reviews" subtitle="Items ready for your review" />
          {reviewDeliverables.map(renderActionableDeliverable)}
        </section>
      )}

      {sectionIsVisible('conversations') && (conversationDeliverables.length > 0 || requests.length > 0 || requestsLoading) && (
        <section aria-label="Conversations" className="space-y-3">
          <SectionHeading title="Conversations" subtitle="Ongoing threads with your team" />
          {conversationDeliverables.map(renderActionableDeliverable)}
          <RequestsTab
            embedded
            workspaceId={workspaceId}
            requests={requests}
            requestsLoading={requestsLoading}
            clientUser={clientUser ?? null}
            loadRequests={loadRequests}
            setToast={setToast}
          />
        </section>
      )}

      {/* Orders-only empty state (R5 fix): the "nothing needs your attention" line must NOT show when
          there are work orders to TRACK — the track lane below is content, even though it's not
          actionable. Guard on the actionable queue, the order track lane, AND the "Ready to publish"
          lane being empty — matching the F2 PriorityStrip guard, so the line never renders above a
          populated "Ready to publish" section (same false-empty class). */}
      {priorityItems.length === 0 &&
        (!sectionIsVisible('conversations') || requests.length === 0) &&
        (!sectionIsVisible('decisions') || (workOrders.length === 0 && readyToApply.length === 0)) && (
        <div className="flex items-center gap-3 px-4 py-3 t-caption text-[var(--brand-text-muted)]">
          <Inbox size={16} className="flex-shrink-0" />
          <span>Nothing needs your attention right now. New items will appear here.</span>
        </div>
      )}

      {/* R3b — "Ready to publish": already-approved, client-applyable deliverables with an explicit
          "Apply to Website" step (a separate step AFTER approve — `approved` is NOT actionable so
          this is a distinct surface). Faithfully replicates the legacy ApprovalBatchCard footer
          (keep the approved card visible with an Apply button gated on the applyability predicate). */}
      {sectionIsVisible('decisions') && readyToApply.length > 0 && (
        <section aria-label="Ready to publish" className="space-y-3">
          <SectionHeading title="Ready to publish" subtitle="Approved — apply to your live site" />
          {readyToApply.map((d) => (
            <div
              key={d.id}
              // pr-check-disable-next-line -- brand signature radius intentional; mirrors DecisionCard visual identity
              className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden p-4"
              style={{ borderRadius: 'var(--radius-signature-lg)' }}
            >
              <div className="flex items-center gap-2 mb-1">
                {/* SG-1 — the "Approved" pill reads as success (emerald), not neutral zinc. */}
                <StatusBadge domain="approval" status="approved" variant="soft" />
              </div>
              <h4 className="t-body font-semibold text-[var(--brand-text-bright)]">{d.title}</h4>
              {d.summary && (
                <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{d.summary}</p>
              )}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <Button
                  size="sm"
                  variant="primary"
                  icon={UploadCloud}
                  disabled={apply.isPending}
                  onClick={() => onApply(d)}
                >
                  {apply.isPending ? 'Applying…' : 'Apply to Website'}
                </Button>
                {(d.items?.length ?? 0) > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setDetailId(d.id)} className="ml-auto">
                    View {d.items!.length} change{d.items!.length !== 1 ? 's' : ''} →
                  </Button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* R5 — "Work in progress": the read-only work-order TRACK lane. Work the agency does FOR the
          client (paid fix/schema orders), surfaced as STATUS they FOLLOW — there is NO approve/decline/
          apply/review verb (a work order is not a decision). Each card does NOT call
          normalizeDeliverable, does NOT construct a DecisionCard, and wires ZERO decision mutations
          (structural verb-safety). The ONLY interactive element is the verb-free client↔team
          conversation input (DARK; reachable only when UnifiedInbox renders behind `unified-inbox`).
          Page targets are shown count-only — the raw payload.pageIds are raw Webflow ids and are never
          surfaced to the client (CLAUDE.md "never surface raw IDs"). Mirrors the R3b "Ready to publish"
          container (surface-2 + brand signature radius). */}
      {sectionIsVisible('decisions') && workOrders.length > 0 && (
        <section aria-label="Work in progress" className="space-y-3">
          <SectionHeading title="Work in progress" subtitle="Work your team is doing for you" />
          {workOrders.map((d) => (
            <WorkOrderTrackCard key={d.id} deliverable={d} workspaceId={workspaceId} />
          ))}
        </section>
      )}

      {/* R3: the detail modal — substance + per-item review for a batch deliverable. Reuses the
          proven renderers (decision-renderers.tsx). The approve carries the flagged item ids to the
          single /respond path; request-changes/decline are whole-deliverable. */}
      {detailDeliverable && (
        <DeliverableDetailModal
          decision={normalizeDeliverable(detailDeliverable)}
          submitting={submittingId === detailDeliverable.id}
          editable={editable}
          onApprove={(flaggedItems: FlaggedItem[], editedItems) =>
            handleRespond(detailDeliverable, 'approved', undefined, flaggedItems, editedItems)
          }
          onRequestChanges={(note) =>
            handleRespond(detailDeliverable, 'changes_requested', note || undefined)
          }
          onDecline={(note) => handleRespond(detailDeliverable, 'declined', note || undefined)}
          onDismiss={() => setDetailId(null)}
          // R3b: when the modal shows an already-approved, client-applyable deliverable, render the
          // single "Apply to Website" step instead of the approve/request/decline row.
          canApply={
            detailDeliverable.status === 'approved' &&
            isClientApplyableDeliverableBatch(detailDeliverable.items ?? [])
          }
          applying={apply.isPending}
          onApply={() => onApply(detailDeliverable)}
        />
      )}

      {/* R4 — in-shell projected review: mount the proven bespoke surface (ClientCopyReview /
          ContentTab → PostReviewCard) for a projected deliverable, branched on TYPE. The client
          reviews + responds without leaving; respond goes through the bespoke routes, and the new
          COPY_SECTION_UPDATED / CONTENT_REQUEST_UPDATE / POST_UPDATED handlers above refetch the
          list so the card leaves and the client can dismiss. */}
      {reviewProjected && (
        <ProjectedReviewModal
          type={reviewProjected.type as Extract<DeliverableType, 'copy_section' | 'content_request'>}
          externalRef={reviewProjected.externalRef}
          workspaceId={workspaceId}
          setToast={setToast}
          onDismiss={() => setReviewProjected(null)}
          {...contentTabProps}
        />
      )}

      {/* R3b — "Apply to live site?" confirmation (copy mirrors the legacy ApprovalBatchCard). */}
      <ConfirmDialog
        open={applyConfirm !== null}
        title="Apply to live site?"
        message="This will update your live website with the approved changes. This cannot be undone from the dashboard."
        confirmLabel="Apply to Website"
        onConfirm={() => void confirmApply()}
        onCancel={() => setApplyConfirm(null)}
      />

      {/* Item 1 — the "Submit a request" chooser (free-form request reuse + content-topic pricing
          reuse). Mounted on demand from the header button. */}
      {chooserOpen && (
        <SubmitRequestChooserModal
          workspaceId={workspaceId}
          clientUser={clientUser}
          setToast={setToast}
          onDismiss={() => setChooserOpen(false)}
          setPricingModal={contentTabProps.setPricingModal}
          pricingConfirming={contentTabProps.pricingConfirming}
          briefPrice={contentTabProps.briefPrice}
          fullPostPrice={contentTabProps.fullPostPrice}
          fmtPrice={contentTabProps.fmtPrice}
          hidePrices={contentTabProps.hidePrices}
        />
      )}
    </div>
  );
}
