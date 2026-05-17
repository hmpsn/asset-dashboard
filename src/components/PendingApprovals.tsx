/**
 * PendingApprovals — Shows pending approval batches sent to clients with retract capability.
 * Reusable across SeoEditor, SchemaSuggester, CmsEditor, and any tool that creates approval batches.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Trash2, ChevronDown, Bell, Check } from 'lucide-react';
import { Button, Icon, IconButton, StatusBadge, cn } from './ui';
import { approvals } from '../api/misc';
import { queryKeys } from '../lib/queryKeys';
import type { ApprovalBatch } from '../../shared/types/approvals';

interface PendingApprovalsProps {
  workspaceId: string;
  /** Optional filter — only show batches whose name matches this substring (case-insensitive) */
  nameFilter?: string;
  /** Callback after a batch is retracted */
  onRetracted?: (batchId: string) => void;
  /** External trigger to refresh (increment to force re-fetch) */
  refreshKey?: number;
  /** Compact mode — single row per batch, no expand */
  compact?: boolean;
}

export function PendingApprovals({ workspaceId, nameFilter, onRetracted, refreshKey, compact }: PendingApprovalsProps) {
  const queryClient = useQueryClient();
  const [reminding, setReminding] = useState<string | null>(null);
  const [reminderSent, setReminderSent] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data: rawBatches = [], isLoading: loading } = useQuery({
    queryKey: [...queryKeys.admin.approvals(workspaceId), refreshKey],
    queryFn: async () => {
      const all = await approvals.list(workspaceId) as ApprovalBatch[];
      return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
  });

  const batches = nameFilter
    ? rawBatches.filter(b => b.name.toLowerCase().includes(nameFilter!.toLowerCase()))
    : rawBatches;

  const retractMutation = useMutation({
    mutationFn: async (batchId: string) => {
      await approvals.remove(workspaceId, batchId);
    },
    onSuccess: (_data, batchId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.approvals(workspaceId) });
      setConfirmId(null);
      onRetracted?.(batchId);
    },
    onError: (err) => { console.error('PendingApprovals retract failed:', err); },
  });

  const retract = (batchId: string) => retractMutation.mutate(batchId);

  const sendReminder = async (batchId: string) => {
    setReminding(batchId);
    try {
      await approvals.remind(workspaceId, batchId);
      setReminderSent(prev => new Set(prev).add(batchId));
    } catch (err) { console.error('PendingApprovals reminder failed:', err); }
    finally { setReminding(null); }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const statusBadge = (status: string) => {
    return <StatusBadge status={status} domain="approval" fallback="neutral" />;
  };

  return (
    // pr-check-disable-next-line -- approval card uses brand signature radius intentionally
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
      <div className="px-3 py-2 border-b border-[var(--brand-border)] flex items-center gap-2">
        <Icon as={Send} size="sm" className="text-teal-400" />
        <span className="text-xs font-medium text-[var(--brand-text-bright)]">Sent to Client{!loading && ` (${batches.length})`}</span>
      </div>
      {loading ? (
        <div className="px-3 py-3 t-caption text-[var(--brand-text-muted)]">Loading...</div>
      ) : batches.length === 0 ? (
        <div className="px-3 py-3 t-caption text-[var(--brand-text-muted)]">No pending approval batches</div>
      ) : (
      <div className="divide-y divide-[var(--brand-border)]">
        {batches.map(batch => {
          const isExpanded = !compact && expanded.has(batch.id);
          const isConfirming = confirmId === batch.id;
          const pendingCount = batch.items.filter(i => i.status === 'pending').length;
          const approvedCount = batch.items.filter(i => i.status === 'approved').length;
          const rejectedCount = batch.items.filter(i => i.status === 'rejected').length;
          return (
            <div key={batch.id}>
              <div className="flex items-center gap-2 px-3 py-2">
                {!compact && (
                  <IconButton
                    onClick={() => toggleExpand(batch.id)}
                    icon={ChevronDown}
                    label={isExpanded ? 'Collapse batch details' : 'Expand batch details'}
                    title={isExpanded ? 'Collapse' : 'Expand'}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'p-0.5 hover:bg-[var(--surface-3)] rounded transition-colors text-[var(--brand-text-muted)]',
                      !isExpanded && '[&_svg]:-rotate-90',
                    )}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="t-caption font-medium text-[var(--brand-text-bright)] truncate">{batch.name}</span>
                    {statusBadge(batch.status)}
                  </div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                    {new Date(batch.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' · '}{batch.items.length} item{batch.items.length !== 1 ? 's' : ''}
                    {approvedCount > 0 && <span className="text-emerald-400"> · {approvedCount} approved</span>}
                    {rejectedCount > 0 && <span className="text-red-400"> · {rejectedCount} rejected</span>}
                    {pendingCount > 0 && pendingCount < batch.items.length && <span className="text-[var(--brand-text)]"> · {pendingCount} pending</span>}
                  </div>
                </div>
                {isConfirming ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="t-caption-sm text-red-400">Remove from client view?</span>
                    <Button
                      onClick={() => retract(batch.id)}
                      disabled={retractMutation.isPending && retractMutation.variables === batch.id}
                      variant="danger"
                      size="sm"
                      className="px-2 py-1 rounded t-caption-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {retractMutation.isPending && retractMutation.variables === batch.id ? '...' : 'Yes'}
                    </Button>
                    <Button
                      onClick={() => setConfirmId(null)}
                      variant="ghost"
                      size="sm"
                      className="px-2 py-1 rounded t-caption-sm font-medium text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)] transition-colors"
                    >
                      No
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {pendingCount > 0 && (
                      reminderSent.has(batch.id) ? (
                        <span className="flex items-center gap-1 px-2 py-1 t-caption-sm font-medium text-emerald-400">
                          <Icon as={Check} size="sm" /> Sent
                        </span>
                      ) : (
                        <Button
                          onClick={() => sendReminder(batch.id)}
                          disabled={reminding === batch.id}
                          variant="ghost"
                          size="sm"
                          className="px-2 py-1 rounded t-caption-sm font-medium text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                          title="Send reminder email to client"
                          icon={Bell}
                        >
                          {reminding === batch.id ? 'Sending...' : 'Remind'}
                        </Button>
                      )
                    )}
                    <Button
                      onClick={() => setConfirmId(batch.id)}
                      variant="ghost"
                      size="sm"
                      className="px-2 py-1 rounded t-caption-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Retract — remove this from the client's view"
                      icon={Trash2}
                    >
                      Retract
                    </Button>
                  </div>
                )}
              </div>
              {isExpanded && (
                <div className="px-3 pb-2 pl-8 space-y-1">
                  {batch.items.map(item => {
                    const itemStatus = item.status === 'approved' ? 'text-emerald-400' : item.status === 'rejected' ? 'text-red-400' : 'text-[var(--brand-text)]';
                    return (
                      <div key={item.id} className="flex items-center gap-2 t-caption-sm">
                        <span className={cn('uppercase font-medium', itemStatus)}>{item.status}</span>
                        <span className="text-[var(--brand-text-muted)] truncate">{item.pageTitle} — {item.field}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
