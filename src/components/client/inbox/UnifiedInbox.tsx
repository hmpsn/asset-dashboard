import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Inbox, FileText, ListChecks, MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LoadingState } from '../../ui';
import { PriorityStrip, type PriorityItem } from '../PriorityStrip';
import { DecisionCard } from '../DecisionCard';
import { DeliverableDetailModal } from '../DeliverableDetailModal';
import { useBetaMode } from '../BetaContext';
import { normalizeDeliverable, isProjectedDeliverable } from '../../../lib/decision-adapters';
import { useUnifiedInbox, useRespondToDeliverable } from '../../../hooks/client/useUnifiedInbox';
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
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  // R3: the deliverable open in the detail modal (substance + per-item review). null = closed.
  const [detailId, setDetailId] = useState<string | null>(null);

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
        />
      )}
    </div>
  );
}
