/**
 * AdminInbox — admin component with a Signals tab showing client interest signals.
 *
 * Color rules (Four Laws of Color):
 *   - Teal: action buttons, status badges for active signals
 *   - Blue: data counts
 *   - Brand accent: AI/status emphasis when needed
 *   - Status: amber=new, teal=reviewed, zinc=actioned
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp, Inbox, MessageSquare, CheckCircle } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { Button, ClickableRow, Icon, cn } from '../ui/index';
import { useClientSignals, useUpdateSignalStatus } from '../../hooks/admin/useClientSignals';
import type { ClientSignal, ClientSignalStatus } from '../../../shared/types/client-signals';

interface AdminInboxProps {
  workspaceId: string;
}

const STATUS_LABELS: Record<ClientSignalStatus, string> = {
  new: 'New',
  reviewed: 'Reviewed',
  actioned: 'Actioned',
};

const STATUS_COLORS: Record<ClientSignalStatus, string> = {
  new: 'bg-amber-500/10 text-accent-warning border-amber-500/20',
  reviewed: 'bg-teal-500/10 text-accent-brand border-teal-500/20',
  actioned: 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] border-[var(--brand-border)]',
};

const TYPE_LABELS: Record<string, string> = {
  content_interest: 'Content Interest',
  service_interest: 'Service Interest',
};

function SignalCard({ signal, workspaceId }: { signal: ClientSignal; workspaceId: string }) {
  const [expanded, setExpanded] = useState(false);
  const updateStatus = useUpdateSignalStatus(workspaceId);

  const handleStatus = (status: ClientSignalStatus) => {
    updateStatus.mutate({ id: signal.id, status });
  };

  return (
    <div className="border border-[var(--brand-border)] rounded-[var(--radius-lg)] overflow-hidden">
      {/* Header row */}
      <ClickableRow
        className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-3)] text-left"
        onClick={() => setExpanded(p => !p)}
      >
        <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Icon as={MessageSquare} size="sm" className="text-accent-brand" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="t-caption font-medium text-[var(--brand-text-bright)]">
              {TYPE_LABELS[signal.type] ?? signal.type}
            </span>
            <span className={`t-caption-sm font-semibold px-1.5 py-0.5 rounded-[var(--radius-pill)] border ${STATUS_COLORS[signal.status]}`}>
              {STATUS_LABELS[signal.status]}
            </span>
          </div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 truncate">{signal.triggerMessage}</div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
            {new Date(signal.createdAt).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </div>
        </div>
        {expanded
          ? <Icon as={ChevronUp} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0 mt-1" />
          : <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0 mt-1" />
        }
      </ClickableRow>

      {/* Expanded: chat context + actions */}
      {expanded && (
        <div className="border-t border-[var(--brand-border)] px-4 py-3 bg-[var(--surface-2)] space-y-3">
          {/* Chat context */}
          {signal.chatContext.length > 0 ? (
            <div className="space-y-2">
              <div className="t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wide">
                Conversation context
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {signal.chatContext.map((msg, i) => (
                  <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    <div className={cn(
                      'max-w-[80%] rounded-[var(--radius-lg)] px-2.5 py-1.5 t-caption-sm',
                      msg.role === 'user'
                        ? 'bg-teal-600/15 border border-teal-500/20 text-[var(--brand-text-bright)]'
                        : 'bg-[var(--surface-1)] border border-[var(--brand-border)] text-[var(--brand-text)]'
                    )}>
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="t-caption-sm text-[var(--brand-text-muted)]">No conversation context available.</div>
          )}

          {/* Status actions */}
          {/* Status workflow: new → reviewed → actioned. Backward transitions (e.g. actioned → reviewed)
              are intentionally allowed so admins can undo accidental status changes. */}
          <div className="flex items-center gap-2 pt-1">
            <span className="t-caption-sm text-[var(--brand-text-muted)]">Mark as:</span>
            {(['reviewed', 'actioned'] as ClientSignalStatus[]).map(s => (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                key={s}
                onClick={() => handleStatus(s)}
                disabled={signal.status === s || updateStatus.isPending}
                className={cn(
                  't-caption-sm px-2 py-1 rounded-[var(--radius-md)] border disabled:opacity-40',
                  signal.status === s
                    ? STATUS_COLORS[s]
                    : 'border-[var(--brand-border-hover)] text-[var(--brand-text)] hover:border-teal-500/40 hover:text-accent-brand'
                )}
              >
                {STATUS_LABELS[s]}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminInbox({ workspaceId }: AdminInboxProps) {
  const { data: signals, isLoading } = useClientSignals(workspaceId);
  const [activeTab, setActiveTab] = useState<'all' | 'new'>('new');

  const allSignals = signals ?? [];
  const newSignals = allSignals.filter(s => s.status === 'new');
  const displayedSignals = activeTab === 'new' ? newSignals : allSignals;

  const titleIcon = <Icon as={Inbox} size="md" className="text-[var(--brand-text-muted)]" />;

  const newBadge = newSignals.length > 0 ? (
    <span className="t-caption-sm font-bold px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-amber-500/10 text-accent-warning border border-amber-500/20">
      {newSignals.length} new
    </span>
  ) : undefined;

  if (isLoading) {
    return (
      <SectionCard title="Client Signals" titleIcon={titleIcon}>
        <div className="space-y-3">
          {[1, 2].map(i => <Skeleton key={i} className="h-16" />)}
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Client Signals"
      titleIcon={titleIcon}
      action={newBadge}
    >
      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        {(['new', 'all'] as const).map(tab => (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-3 py-1 rounded-[var(--radius-lg)] t-caption font-medium',
              activeTab === tab
                ? 'bg-teal-500/10 text-accent-brand border border-teal-500/20'
                : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] border border-transparent'
            )}
          >
            {tab === 'new' ? `New (${newSignals.length})` : `All (${allSignals.length})`}
          </Button>
        ))}
      </div>

      {/* Signal list */}
      {displayedSignals.length === 0 ? (
        <EmptyState
          icon={activeTab === 'new' ? CheckCircle : Inbox}
          title={activeTab === 'new' ? 'No new signals' : 'No signals yet'}
          description={
            activeTab === 'new'
              ? 'All client signals have been reviewed.'
              : 'Client interest signals will appear here when detected in chat.'
          }
        />
      ) : (
        <div className="space-y-2">
          {displayedSignals.map(signal => (
            <SignalCard key={signal.id} signal={signal} workspaceId={workspaceId} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
