/**
 * ClientActionsTab — admin view of all client_actions for a workspace.
 *
 * Approved actions (no automated playbook) show an amber "Awaiting implementation"
 * badge and a teal "Mark complete" button for one-click admin resolution.
 *
 * Color rules (Four Laws of Color):
 *   - Amber: awaiting-implementation badge (warning, not yet actionable)
 *   - Teal: "Mark complete" CTA
 *   - Emerald: completed badge
 *   - Blue: pending/info badge
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Clock, Inbox } from 'lucide-react';
import { useToast } from '../Toast.js';
import { SectionCard } from '../ui/SectionCard.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Skeleton } from '../ui/Skeleton.js';
import { Icon } from '../ui/index.js';
import { clientActions } from '../../api/clientActions.js';
import { queryKeys } from '../../lib/queryKeys.js';
import type { ClientAction, ClientActionStatus } from '../../../shared/types/client-actions.js';

interface Props {
  workspaceId: string;
}

const SOURCE_TYPE_LABELS: Record<ClientAction['sourceType'], string> = {
  aeo_change: 'AEO Change',
  internal_link: 'Internal Link',
  keyword_strategy: 'Keyword Strategy',
  redirect_proposal: 'Redirect Proposal',
  content_decay: 'Content Decay',
};

const STATUS_COLORS: Record<ClientActionStatus, string> = {
  pending: 'bg-blue-500/10 text-accent-info border-blue-500/20',
  approved: 'bg-amber-500/10 text-accent-warning border-amber-500/20',
  changes_requested: 'bg-orange-500/10 text-accent-orange border-orange-500/20',
  completed: 'bg-emerald-500/10 text-accent-success border-emerald-500/20',
  archived: 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] border-[var(--brand-border)]',
};

const STATUS_LABELS: Record<ClientActionStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  changes_requested: 'Changes Requested',
  completed: 'Completed',
  archived: 'Archived',
};

function ActionCard({ action, workspaceId }: { action: ClientAction; workspaceId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const markComplete = useMutation({
    mutationFn: () => clientActions.update(workspaceId, action.id, { status: 'completed' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.clientActions(workspaceId) });
    },
    onError: () => toast('Failed to mark action complete', 'error'),
  });

  const statusBadgeClass = STATUS_COLORS[action.status] ?? STATUS_COLORS.pending;
  const formattedDate = new Date(action.updatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-3">
      <div className="flex items-start gap-3">
        {/* Source type icon placeholder */}
        <div className="w-7 h-7 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Icon as={Clock} size="sm" className="text-accent-brand" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="t-caption font-medium text-[var(--brand-text-bright)] truncate flex-1">
              {action.title}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] t-caption font-medium border ${statusBadgeClass} shrink-0`}>
              {STATUS_LABELS[action.status]}
            </span>
          </div>

          {/* Source type + date */}
          <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
            {SOURCE_TYPE_LABELS[action.sourceType] ?? action.sourceType} · {formattedDate}
          </div>

          {/* Summary */}
          {action.summary && (
            <p className="t-caption-sm text-[var(--brand-text)] mt-1 line-clamp-2">
              {action.summary}
            </p>
          )}

          {/* Client note (if any) */}
          {action.clientNote && (
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1 italic">
              Client note: "{action.clientNote}"
            </p>
          )}

          {/* Approved-specific: "Awaiting implementation" badge + Mark complete button */}
          {action.status === 'approved' && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] t-caption font-medium bg-amber-500/10 text-accent-warning border border-amber-500/20">
                Awaiting implementation
              </span>
              <button
                onClick={() => markComplete.mutate()}
                disabled={markComplete.isPending}
                className="px-3 py-1 rounded-[var(--radius-sm)] t-caption font-medium bg-teal-600 hover:bg-teal-500 text-white transition-colors disabled:opacity-50"
              >
                {markComplete.isPending ? 'Marking...' : 'Mark complete'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ClientActionsTab({ workspaceId }: Props) {
  const { data, isLoading } = useQuery<ClientAction[]>({
    queryKey: queryKeys.admin.clientActions(workspaceId),
    queryFn: () => clientActions.list(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });

  const titleIcon = <Icon as={Inbox} size="md" className="text-[var(--brand-text-muted)]" />;

  const items = data ?? [];
  const approvedItems = items.filter(a => a.status === 'approved');

  // Badge showing how many actions are awaiting implementation
  const awaitingBadge = approvedItems.length > 0 ? (
    <span className="t-caption-sm font-bold px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-amber-500/10 text-accent-warning border border-amber-500/20">
      {approvedItems.length} awaiting
    </span>
  ) : undefined;

  if (isLoading) {
    return (
      <SectionCard title="Client Actions" titleIcon={titleIcon}>
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={`Client Actions${items.length > 0 ? ` (${items.length})` : ''}`}
      titleIcon={titleIcon}
      action={awaitingBadge}
    >
      {items.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title="No client actions"
          description="Client actions will appear here when sent from the admin tools."
        />
      ) : (
        <div className="space-y-2">
          {items.map(action => (
            <ActionCard key={action.id} action={action} workspaceId={workspaceId} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
