import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Inbox, FileText, ListChecks, MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LoadingState } from '../../ui';
import { PriorityStrip, type PriorityItem } from '../PriorityStrip';
import { DecisionCard } from '../DecisionCard';
import { normalizeDeliverable } from '../../../lib/decision-adapters';
import { useUnifiedInbox, useRespondToDeliverable } from '../../../hooks/client/useUnifiedInbox';
import { useWorkspaceEvents } from '../../../hooks/useWorkspaceEvents';
import { WS_EVENTS } from '../../../lib/wsEvents';
import { queryKeys } from '../../../lib/queryKeys';
import type { ClientDeliverable, DeliverableKind } from '../../../../shared/types/client-deliverable';
import type { NormalizedDecision } from '../../../../shared/types/decision';

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
  const { deliverables, isLoading } = useUnifiedInbox(workspaceId);
  const respond = useRespondToDeliverable(workspaceId);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

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

  const handleRespond = async (
    d: ClientDeliverable,
    decision: 'approved' | 'changes_requested' | 'declined',
    note?: string,
  ) => {
    setSubmittingId(d.id);
    try {
      await respond.mutateAsync({ deliverableId: d.id, decision, note });
      setToast({
        message:
          decision === 'approved'
            ? 'Approved. Your team will handle the rest.'
            : decision === 'declined'
              ? 'Declined. Your team has been notified.'
              : 'Feedback sent to your team.',
        type: 'success',
      });
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
            return (
              <div key={d.id} id={`unified-decision-${d.id}`}>
                <DecisionCard
                  decision={decision}
                  uniformVerbs
                  ageLabel={ageLabel(d.sentAt)}
                  onOpen={() => {
                    const el = document.getElementById(`unified-decision-${d.id}`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  onApprove={
                    submittingId === d.id ? undefined : () => void handleRespond(d, 'approved')
                  }
                  onFlagWithNote={
                    submittingId === d.id
                      ? undefined
                      : (note) => void handleRespond(d, 'changes_requested', note || undefined)
                  }
                  onDecline={
                    submittingId === d.id
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
    </div>
  );
}
