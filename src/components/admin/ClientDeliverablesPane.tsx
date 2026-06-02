/**
 * ClientDeliverablesPane — the admin "Client Deliverables" inbox pane (PR-2b, DARK).
 *
 * The single operator view of everything sent to a client, across all five "send to client" types
 * (audit §E1/E2/E6/E7; design §6). Groups the workspace's deliverables by the OPERATOR STATUS AXIS
 * — Awaiting client · Changes requested · Approved (to apply) · Other — oldest-first within each
 * group, with "pending N days" / stale styling derived from `sentAt`, the type badge, and a
 * per-item Remind button on awaiting_client items wired to POST /api/deliverables/:ws/:id/remind.
 *
 * Color (Four Laws): teal for actions, amber for the awaiting nudge queue, orange for changes,
 * emerald for approved, red for stale. NO purple — this is an operator status view, not an admin-AI
 * surface. Rendered only behind the `unified-inbox` flag (App.tsx branches; the hook also gates the
 * fetch). Uses shared primitives (SectionCard / Badge / EmptyState / Button / Skeleton).
 */
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Inbox, Clock, BellRing } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { Badge } from '../ui/Badge';
import { Button, Icon, cn } from '../ui/index';
import { deliverableTypeBadge } from '../../lib/decision-adapters';
import { useWorkspaceDeliverables, useRemindDeliverable } from '../../hooks/admin/useWorkspaceDeliverables';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { WS_EVENTS } from '../../lib/wsEvents';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_AWAITING_DAYS } from '../../../shared/types/admin-deliverable-view';
import type {
  AdminDeliverableView,
  DeliverableStatusAxis,
} from '../../../shared/types/admin-deliverable-view';
import type { BadgeTone } from '../ui/Badge';

interface ClientDeliverablesPaneProps {
  workspaceId: string;
}

/** The axis groups in operator-priority order (awaiting first, terminal/other last). */
const AXIS_ORDER: DeliverableStatusAxis[] = [
  'awaiting_client',
  'changes_requested',
  'approved',
  'other',
];

const AXIS_META: Record<DeliverableStatusAxis, { label: string; tone: BadgeTone }> = {
  awaiting_client: { label: 'Awaiting client', tone: 'amber' },
  changes_requested: { label: 'Changes requested', tone: 'orange' },
  approved: { label: 'Approved (to apply)', tone: 'emerald' },
  other: { label: 'Other', tone: 'zinc' },
};

/** "Pending N days" / "Sent today" from the staleness clock (sentAt-derived ageDays). */
function pendingLabel(ageDays: number | null): string {
  if (ageDays == null) return 'Not yet sent';
  if (ageDays <= 0) return 'Sent today';
  if (ageDays === 1) return 'Pending 1 day';
  return `Pending ${ageDays} days`;
}

function DeliverableRow({
  d,
  workspaceId,
}: {
  d: AdminDeliverableView;
  workspaceId: string;
}) {
  const remind = useRemindDeliverable(workspaceId);
  const canRemind = d.statusAxis === 'awaiting_client';

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 border rounded-[var(--radius-lg)]',
        d.stale
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-[var(--brand-border)] bg-[var(--surface-2)]',
      )}
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="t-caption font-medium text-[var(--brand-text-bright)] truncate">
            {d.title}
          </span>
          <Badge label={deliverableTypeBadge(d.type)} tone="blue" size="sm" />
          {d.stale && (
            <Badge label={`Stale · ${STALE_AWAITING_DAYS}d+`} tone="red" size="sm" />
          )}
        </div>
        {d.summary && (
          <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{d.summary}</div>
        )}
        <div className="flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)]">
          <Icon as={Clock} size="sm" className="flex-shrink-0" />
          <span className={cn(d.stale && 'text-red-400 font-medium')}>{pendingLabel(d.ageDays)}</span>
        </div>
      </div>
      {canRemind && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => remind.mutate(d.id)}
          disabled={remind.isPending}
          className="flex-shrink-0 gap-1.5"
        >
          <Icon as={BellRing} size="sm" />
          Remind
        </Button>
      )}
    </div>
  );
}

export function ClientDeliverablesPane({ workspaceId }: ClientDeliverablesPaneProps) {
  const queryClient = useQueryClient();
  const { deliverables, isLoading } = useWorkspaceDeliverables(workspaceId);

  // Two-halves broadcast contract (CLAUDE.md Data Flow #2): the server emits DELIVERABLE_* on every
  // send/response/remind; invalidate the admin pane query so the operator view reflects it live.
  const wsHandlers = useMemo(
    () => ({
      // ws-invalidation-ok — admin workspace-deliverables key differs from the client unified-inbox key
      [WS_EVENTS.DELIVERABLE_SENT]: () =>
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.workspaceDeliverables(workspaceId),
        }),
      // ws-invalidation-ok — admin workspace-deliverables key differs from the client unified-inbox key
      [WS_EVENTS.DELIVERABLE_UPDATED]: () =>
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.workspaceDeliverables(workspaceId),
        }),
    }),
    [queryClient, workspaceId],
  );
  useWorkspaceEvents(workspaceId, wsHandlers);

  // Group by axis; within each group, oldest-first (largest ageDays first; never-sent last).
  const grouped = useMemo(() => {
    const byAxis = new Map<DeliverableStatusAxis, AdminDeliverableView[]>();
    for (const d of deliverables) {
      const list = byAxis.get(d.statusAxis) ?? [];
      list.push(d);
      byAxis.set(d.statusAxis, list);
    }
    for (const list of byAxis.values()) {
      list.sort((a, b) => {
        // Never-sent (null age) sorts last; otherwise oldest (largest age) first.
        const ax = a.ageDays ?? -1;
        const bx = b.ageDays ?? -1;
        if (ax !== bx) return bx - ax;
        return a.id < b.id ? -1 : 1;
      });
    }
    return byAxis;
  }, [deliverables]);

  const staleCount = useMemo(() => deliverables.filter((d) => d.stale).length, [deliverables]);

  const titleIcon = <Icon as={Inbox} size="md" className="text-[var(--brand-text-muted)]" />;
  const staleBadge =
    staleCount > 0 ? (
      <Badge label={`${staleCount} stale`} tone="red" size="sm" />
    ) : undefined;

  if (isLoading) {
    return (
      <SectionCard title="Client Deliverables" titleIcon={titleIcon}>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </SectionCard>
    );
  }

  if (deliverables.length === 0) {
    return (
      <SectionCard title="Client Deliverables" titleIcon={titleIcon}>
        <EmptyState
          icon={Inbox}
          title="Nothing sent to this client yet"
          description="Items you send to the client — decisions, reviews, work orders — will appear here grouped by status, with a nudge when something's been pending too long."
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Client Deliverables" titleIcon={titleIcon} action={staleBadge}>
      <div className="space-y-5">
        {AXIS_ORDER.map((axis) => {
          const items = grouped.get(axis);
          if (!items || items.length === 0) return null;
          const meta = AXIS_META[axis];
          return (
            <section key={axis} aria-label={meta.label} className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge label={meta.label} tone={meta.tone} size="sm" />
                <span className="t-caption-sm text-[var(--brand-text-muted)]">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((d) => (
                  <DeliverableRow key={d.id} d={d} workspaceId={workspaceId} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </SectionCard>
  );
}
