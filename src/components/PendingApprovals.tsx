/**
 * PendingApprovals — Shows pending approval batches sent to clients with retract capability.
 * Reusable across SeoEditor, SchemaSuggester, CmsEditor, and any tool that creates approval batches.
 */
import { useState, useEffect, useCallback } from 'react';
import { Send, Trash2, ChevronDown } from 'lucide-react';
import { approvals } from '../api/misc';
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
  const [batches, setBatches] = useState<ApprovalBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [retracting, setRetracting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await approvals.list(workspaceId) as ApprovalBatch[];
      let pending = all.filter(b => b.status === 'pending' || b.status === 'partial');
      if (nameFilter) {
        const lower = nameFilter.toLowerCase();
        pending = pending.filter(b => b.name.toLowerCase().includes(lower));
      }
      pending.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setBatches(pending);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [workspaceId, nameFilter]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const retract = async (batchId: string) => {
    setRetracting(batchId);
    try {
      await approvals.remove(workspaceId, batchId);
      setBatches(prev => prev.filter(b => b.id !== batchId));
      setConfirmId(null);
      onRetracted?.(batchId);
    } catch { /* silent */ }
    finally { setRetracting(null); }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const statusBadge = (status: string) => {
    if (status === 'partial') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium">Partially Reviewed</span>;
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
                    {pendingCount > 0 && pendingCount < batch.items.length && <span className="text-zinc-400"> · {pendingCount} pending</span>}
                  </div>
                </div>
                {isConfirming ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-[10px] text-red-400">Remove from client view?</span>
                    <button
                      onClick={() => retract(batch.id)}
                      disabled={retracting === batch.id}
                      className="px-2 py-1 rounded text-[10px] font-medium bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
                    >
                      {retracting === batch.id ? '...' : 'Yes'}
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="px-2 py-1 rounded text-[10px] font-medium text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmId(batch.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                    title="Retract — remove this from the client's view"
                  >
                    <Trash2 className="w-3 h-3" /> Retract
                  </button>
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
