import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Inbox, FileText, ListChecks, MessageSquare, UploadCloud } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LoadingState, Button, ConfirmDialog } from '../../ui';
import { PriorityStrip, type PriorityItem } from '../PriorityStrip';
import { DecisionCard } from '../DecisionCard';
import { DeliverableDetailModal } from '../DeliverableDetailModal';
import { useBetaMode } from '../BetaContext';
import { normalizeDeliverable, isProjectedDeliverable } from '../../../lib/decision-adapters';
import { useUnifiedInbox, useRespondToDeliverable, useApplyDeliverable } from '../../../hooks/client/useUnifiedInbox';
import { isClientApplyableDeliverableBatch } from '../../../../shared/applyability';
import { useWorkspaceEvents } from '../../../hooks/useWorkspaceEvents';
import { WS_EVENTS } from '../../../lib/wsEvents';
import { queryKeys } from '../../../lib/queryKeys';
import { clientPath } from '../../../routes';
import type { ClientDeliverable, DeliverableKind } from '../../../../shared/types/client-deliverable';
import type { NormalizedDecision, FlaggedItem } from '../../../../shared/types/decision';

interface UnifiedInboxProps {
  workspaceId: string;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
}

/** Statuses the client is actively being asked to act on (drive the PriorityStrip). */
const ACTIONABLE_STATUSES = new Set(['awaiting_client', 'changes_requested', 'partial']);

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
 * UnifiedInbox — the PR-2a unified client inbox (DARK behind the `unified-inbox` flag).
 *
 * Mounts the previously-orphaned `PriorityStrip` as the single prioritized "Needs your attention"
 * list, backed by the unified deliverables read endpoint, and renders one `DecisionCard` per
 * deliverable with uniform Approve / Request changes (+note) / Decline verbs that call the REAL
 * PATCH /respond endpoint. Mobile-sane (stacked cards, no wide tables).
 *
 * This component is only rendered when the flag is ON (InboxTab branches on it); the hook is
 * additionally flag-gated so the fetch never fires with the flag off.
 */
export function UnifiedInbox({ workspaceId, setToast }: UnifiedInboxProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const betaMode = useBetaMode();
  const { deliverables, isLoading } = useUnifiedInbox(workspaceId);
  const respond = useRespondToDeliverable(workspaceId);
  const apply = useApplyDeliverable(workspaceId);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  // R3: the deliverable open in the detail modal (substance + per-item review). null = closed.
  const [detailId, setDetailId] = useState<string | null>(null);
  // R3b — Apply to Website: the deliverable pending the "Apply to live site?" confirmation. null = no dialog.
  const [applyConfirm, setApplyConfirm] = useState<ClientDeliverable | null>(null);

  // PROJECTED deliverables (copy_section / content_request) have no physical row and 404 on the
  // uniform /respond verbs — copy is reviewed in Inbox > Reviews (ClientCopyReview) and briefs/posts
  // in Inbox > Reviews (ContentTab). For those we deep-link to ?tab=reviews (the ?tab= two-halves
  // contract — InboxTab reads the param) instead of rendering dead Approve/Decline buttons.
  // TODO(cutover): once projected respond routes to the bespoke copy-pipeline/content-briefs
  // handlers, the write verbs can be wired here too; for now this stays a read-only deep-link.
  const goToReviews = () =>
    navigate(`${clientPath(workspaceId, 'inbox', betaMode)}?tab=reviews`);

  // Two-halves broadcast contract (CLAUDE.md Data Flow #2): the server emits DELIVERABLE_*
  // on every send/response; this handler invalidates the unified inbox query so the list reflects
  // the change in real time.
  const wsHandlers = useMemo(
    () => ({
      // ws-invalidation-ok — client unified-inbox key differs from any admin deliverable key
      [WS_EVENTS.DELIVERABLE_SENT]: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.client.unifiedInbox(workspaceId) }),
      // ws-invalidation-ok — client unified-inbox key differs from any admin deliverable key
      [WS_EVENTS.DELIVERABLE_UPDATED]: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.client.unifiedInbox(workspaceId) }),
    }),
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

  // The deliverable open in the detail modal, resolved from the live list (so a WS-driven refetch
  // keeps the modal in sync). null when closed or once the item leaves the actionable set.
  const detailDeliverable = useMemo(
    () => (detailId ? deliverables.find((d) => d.id === detailId) ?? null : null),
    [deliverables, detailId],
  );

  const handleRespond = async (
    d: ClientDeliverable,
    decision: 'approved' | 'changes_requested' | 'declined',
    note?: string,
    flaggedItems?: FlaggedItem[],
  ) => {
    setSubmittingId(d.id);
    try {
      await respond.mutateAsync({ deliverableId: d.id, decision, note, flaggedItems });
      const heldCount = decision === 'approved' ? flaggedItems?.length ?? 0 : 0;
      setToast({
        message:
          decision === 'approved'
            ? heldCount > 0
              ? `Approved. ${heldCount} item${heldCount === 1 ? '' : 's'} held for your team to review.`
              : 'Approved. Your team will handle the rest.'
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
  // Post-apply UX (corrected-defect #4): the deliverable flips to `applied`, which is filtered OUT
  // of the client-facing list (CLIENT_FACING_STATUSES excludes `applied`). On refetch the item LEAVES
  // the inbox (both the actionable + ready-to-publish sections) and the modal auto-unmounts
  // (detailDeliverable → null). That is the intended UX; the success toast confirms.
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
      setToast({
        message: `${data.applied} change${data.applied !== 1 ? 's' : ''} applied to your website`,
        type: 'success',
      });
    } catch {
      setToast({ message: 'Failed to apply changes. Please try again.', type: 'error' });
    }
  };

  const priorityItems: PriorityItem[] = actionable.map((d) => {
    const { section, icon } = sectionForKind(d.kind);
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
  });

  if (isLoading) {
    return <LoadingState message="Loading your inbox items..." size="lg" />;
  }

  return (
    <div className="space-y-6">
      {/* The single prioritized "Needs your attention" list (PriorityStrip, finally mounted). */}
      <PriorityStrip items={priorityItems} showAllCaughtUp />

      {actionable.length > 0 && (
        <section aria-label="Needs your attention" className="space-y-3">
          {actionable.map((d) => {
            const decision: NormalizedDecision = normalizeDeliverable(d);
            // Projected (copy_section / content_request): render a read-only "Review →" deep-link
            // instead of the uniform write verbs (which /respond → PK lookup → 404 for a projected
            // id). The card still shows title/summary/age.
            const projected = isProjectedDeliverable(d.type);
            return (
              <div key={d.id} id={`unified-decision-${d.id}`}>
                <DecisionCard
                  decision={decision}
                  uniformVerbs
                  ageLabel={ageLabel(d.sentAt)}
                  onReview={projected ? goToReviews : undefined}
                  // "View N →" opens the detail modal (substance + per-item review). Projected
                  // deliverables render the read-only "Review →" deep-link instead of "View N", so
                  // this is never reached for them (no-op kept for the required prop contract).
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
              </div>
            );
          })}
        </section>
      )}

      {actionable.length === 0 && (
        <div className="flex items-center gap-3 px-4 py-3 t-caption text-[var(--brand-text-muted)]">
          <Inbox size={16} className="flex-shrink-0" />
          <span>Nothing needs your attention right now. New items will appear here.</span>
        </div>
      )}

      {/* R3b — "Ready to publish": already-approved, client-applyable deliverables with an explicit
          "Apply to Website" step (a separate step AFTER approve — `approved` is NOT actionable so
          this is a distinct surface). Faithfully replicates the legacy ApprovalBatchCard footer
          (keep the approved card visible with an Apply button gated on the applyability predicate). */}
      {readyToApply.length > 0 && (
        <section aria-label="Ready to publish" className="space-y-3">
          <h3 className="t-label text-[var(--brand-text-muted)] uppercase tracking-wide">
            Ready to publish
          </h3>
          {readyToApply.map((d) => (
            <div
              key={d.id}
              // pr-check-disable-next-line -- brand signature radius intentional; mirrors DecisionCard visual identity
              className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden p-4"
              style={{ borderRadius: 'var(--radius-signature-lg)' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)]">
                  Approved
                </span>
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

      {/* R3: the detail modal — substance + per-item review for a batch deliverable. Reuses the
          proven renderers (decision-renderers.tsx). The approve carries the flagged item ids to the
          single /respond path; request-changes/decline are whole-deliverable. */}
      {detailDeliverable && (
        <DeliverableDetailModal
          decision={normalizeDeliverable(detailDeliverable)}
          submitting={submittingId === detailDeliverable.id}
          onApprove={(flaggedItems: FlaggedItem[]) =>
            handleRespond(detailDeliverable, 'approved', undefined, flaggedItems)
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

      {/* R3b — "Apply to live site?" confirmation (copy mirrors the legacy ApprovalBatchCard). */}
      <ConfirmDialog
        open={applyConfirm !== null}
        title="Apply to live site?"
        message="This will update your live website with the approved changes. This cannot be undone from the dashboard."
        confirmLabel="Apply to Website"
        onConfirm={() => void confirmApply()}
        onCancel={() => setApplyConfirm(null)}
      />
    </div>
  );
}
