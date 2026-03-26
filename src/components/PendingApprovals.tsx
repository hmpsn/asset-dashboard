/**
 * PendingApprovals — Shows pending approval batches sent to clients with retract capability.
 * Reusable across SeoEditor, SchemaSuggester, CmsEditor, and any tool that creates approval batches.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Trash2, ChevronDown, Bell, Check } from 'lucide-react';
import { approvals } from '../api/misc';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
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

  // Live-update when client approves/rejects/applies items
  useWorkspaceEvents(workspaceId, {
    'approval:update': () => queryClient.invalidateQueries({ queryKey: ['admin-approvals', workspaceId] }),
    'approval:applied': () => queryClient.invalidateQueries({ queryKey: ['admin-approvals', workspaceId] }),
  });

  const { data: rawBatches = [], isLoading: loading } = useQuery({
    queryKey: ['admin-approvals', workspaceId, refreshKey],
    queryFn: async () => {
      const all = await approvals.list(workspaceId) as ApprovalBatch[];
      return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
  });

  const batches = nameFilter
    ? rawBatches.filter(b => b.name.toLowerCase().includes(nameFilter!.toLowerCase()))
    : rawBatches;

  const retractMutation = useMutation({
    mutationFn: (batchId: string) => approvals.remove(workspaceId, batchId) as Promise<void>,
    onSuccess: (_data, batchId) => {
      queryClient.invalidateQueries({ queryKey: ['admin-approvals', workspaceId] });
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
    if (status === 'applied') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20 font-medium">Applied</span>;
    if (status === 'approved') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-medium">Approved</span>;
    if (status === 'partial') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium">Partially Reviewed</span>;
    if (status === 'rejected') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20 font-medium">Rejected</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-400 border border-teal-500/20 font-medium">Awaiting Review</span>;
  };

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
        <Send className="w-3.5 h-3.5 text-teal-400" />
        <span className="text-xs font-medium text-zinc-300">Sent to Client{!loading && ` (${batches.length})`}</span>
      </div>
      {loading ? (
        <div className="px-3 py-3 text-[11px] text-zinc-500">Loading...</div>
      ) : batches.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-zinc-500">No pending approval batches</div>
      ) : (
      <div className="divide-y divide-zinc-800/50">
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
                  <button onClick={() => toggleExpand(batch.id)} className="p-0.5 hover:bg-zinc-800 rounded transition-colors">
                    <ChevronDown className={`w-3 h-3 text-zinc-500 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-zinc-300 truncate">{batch.name}</span>
                    {statusBadge(batch.status)}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    {new Date(batch.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' · '}{batch.items.length} item{batch.items.length !== 1 ? 's' : ''}
                    {approvedCount > 0 && <span className="text-emerald-400"> · {approvedCount} approved</span>}
                    {rejectedCount > 0 && <span className="text-red-400"> · {rejectedCount} rejected</span>}
                    {pendingCount > 0 && pendingCount < batch.items.length && <span className="text-zinc-400"> · {pendingCount} pending</span>}
                  </div>
                </div>
                {isConfirming ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-[10px] text-red-400">Remove from client view?</span>
                    <button
                      onClick={() => retract(batch.id)}
                      disabled={retractMutation.isPending && retractMutation.variables === batch.id}
                      className="px-2 py-1 rounded text-[10px] font-medium bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
                    >
                      {retractMutation.isPending && retractMutation.variables === batch.id ? '...' : 'Yes'}
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="px-2 py-1 rounded text-[10px] font-medium text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {pendingCount > 0 && (
                      reminderSent.has(batch.id) ? (
                        <span className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-green-400">
                          <Check className="w-3 h-3" /> Sent
                        </span>
                      ) : (
                        <button
                          onClick={() => sendReminder(batch.id)}
                          disabled={reminding === batch.id}
                          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                          title="Send reminder email to client"
                        >
                          <Bell className="w-3 h-3" /> {reminding === batch.id ? 'Sending...' : 'Remind'}
                        </button>
                      )
                    )}
                    <button
                      onClick={() => setConfirmId(batch.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Retract — remove this from the client's view"
                    >
                      <Trash2 className="w-3 h-3" /> Retract
                    </button>
                  </div>
                )}
              </div>
              {isExpanded && (
                <div className="px-3 pb-2 pl-8 space-y-1">
                  {batch.items.map(item => {
                    const itemStatus = item.status === 'approved' ? 'text-emerald-400' : item.status === 'rejected' ? 'text-red-400' : 'text-zinc-400';
                    return (
                      <div key={item.id} className="flex items-center gap-2 text-[10px]">
                        <span className={`uppercase font-medium ${itemStatus}`}>{item.status}</span>
                        <span className="text-zinc-500 truncate">{item.pageTitle} — {item.field}</span>
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
