import { useState } from 'react';
import {
  ClipboardCheck, Check, CheckCircle2, Edit3, X, ChevronDown, ChevronRight, Loader2,
} from 'lucide-react';
import { TierGate, EmptyState, LoadingState, type Tier } from '../ui';
import { StatusBadge } from '../ui/StatusBadge';
import { usePageEditStates } from '../../hooks/usePageEditStates';
import type { ApprovalBatch, ApprovalItem } from './types';
import { patch, post } from '../../api/client';

interface ApprovalsTabProps {
  workspaceId: string;
  approvalBatches: ApprovalBatch[];
  approvalsLoading: boolean;
  pendingApprovals: number;
  effectiveTier: Tier;
  setApprovalBatches: React.Dispatch<React.SetStateAction<ApprovalBatch[]>>;
  loadApprovals: (wsId: string) => void;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
}

export function ApprovalsTab({
  workspaceId, approvalBatches, approvalsLoading, pendingApprovals,
  effectiveTier, setApprovalBatches, loadApprovals, setToast,
}: ApprovalsTabProps) {
  const [applyingBatch, setApplyingBatch] = useState<string | null>(null);
  const [editingApproval, setEditingApproval] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [rejectingItem, setRejectingItem] = useState<string | null>(null);
  const [rejectDraft, setRejectDraft] = useState('');
  const [collapsedPages, setCollapsedPages] = useState<Set<string>>(new Set());
  const { getState } = usePageEditStates(workspaceId, true);

  const togglePage = (key: string) => setCollapsedPages(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const approveAllInBatch = async (batch: ApprovalBatch) => {
    const pending = batch.items.filter(i => i.status === 'pending');
    if (!window.confirm(`Approve all ${pending.length} pending change${pending.length !== 1 ? 's' : ''} in "${batch.name}"?`)) return;
    for (const item of pending) {
      await updateApprovalItem(batch.id, item.id, { status: 'approved' });
    }
    setToast({ message: `Approved ${pending.length} change${pending.length !== 1 ? 's' : ''}`, type: 'success' });
  };

  const approveAllForPage = async (batchId: string, items: ApprovalItem[]) => {
    const pending = items.filter(i => i.status === 'pending');
    if (!window.confirm(`Approve all ${pending.length} pending change${pending.length !== 1 ? 's' : ''} for this page?`)) return;
    for (const item of pending) {
      await updateApprovalItem(batchId, item.id, { status: 'approved' });
    }
  };

  const updateApprovalItem = async (batchId: string, itemId: string, update: { status?: string; clientValue?: string; clientNote?: string }) => {
    try {
      const updated = await patch<ApprovalBatch>(`/api/public/approvals/${workspaceId}/${batchId}/${itemId}`, update);
      if (updated.id) {
        setApprovalBatches(prev => prev.map(b => b.id === batchId ? updated : b));
      }
    } catch { setToast({ message: 'Failed to update approval. Please try again.', type: 'error' }); }
    setEditingApproval(null);
    setEditDraft('');
  };

  const applyApprovedBatch = async (batchId: string) => {
    if (!window.confirm('This will update your live website with the approved changes. Continue?')) return;
    setApplyingBatch(batchId);
    try {
      const data = await post<{ applied: number }>(`/api/public/approvals/${workspaceId}/${batchId}/apply`);
      if (data.applied > 0) {
        loadApprovals(workspaceId);
      }
    } catch { setToast({ message: 'Failed to apply changes. Please try again.', type: 'error' }); }
    setApplyingBatch(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="w-5 h-5 text-teal-400" />
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">SEO Change Approvals</h2>
          <p className="text-sm text-zinc-500 mt-1">Review proposed SEO changes, make edits if needed, then approve to push live.</p>
        </div>
        {pendingApprovals > 0 && (
          <span className="ml-auto px-2 py-0.5 text-[11px] font-medium rounded-full bg-teal-500/20 border border-teal-500/30 text-teal-300">
            {pendingApprovals} pending
          </span>
        )}
      </div>

      {approvalsLoading && (
        <LoadingState message="Loading approvals..." size="md" />
      )}

      {!approvalsLoading && approvalBatches.length === 0 && (
        <EmptyState icon={ClipboardCheck} title="No pending approvals" description="Your agency will send SEO changes here for your review." />
      )}

      {approvalBatches.map(batch => {
        const batchPending = batch.items.filter(i => i.status === 'pending').length;
        const batchApproved = batch.items.filter(i => i.status === 'approved').length;
        const batchApplied = batch.items.filter(i => i.status === 'applied').length;
        const batchRejected = batch.items.filter(i => i.status === 'rejected').length;
        const isApplying = applyingBatch === batch.id;

        return (
          <div key={batch.id} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            {/* Batch header */}
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-zinc-200">{batch.name}</h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {new Date(batch.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {' · '}{batch.items.length} change{batch.items.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {batchPending > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">{batchPending} pending</span>}
                {batchApproved > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-400">{batchApproved} approved</span>}
                {batchApplied > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400">{batchApplied} applied</span>}
                {batchRejected > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400">{batchRejected} rejected</span>}
              </div>
            </div>

            {/* Items grouped by page */}
            <div className="divide-y divide-zinc-800/50">
              {(() => {
                // Group items by pageId
                const grouped = new Map<string, ApprovalItem[]>();
                for (const item of batch.items) {
                  const key = item.pageId;
                  if (!grouped.has(key)) grouped.set(key, []);
                  grouped.get(key)!.push(item);
                }
                return Array.from(grouped.entries()).map(([pageId, pageItems]) => {
                  const first = pageItems[0];
                  const pageKey = `${batch.id}-${pageId}`;
                  const isCollapsed = collapsedPages.has(pageKey);
                  const pagePending = pageItems.filter(i => i.status === 'pending').length;
                  const pageApprovedCount = pageItems.filter(i => i.status === 'approved').length;
                  const pageState = getState(pageId);

                  return (
                    <div key={pageKey} className="border-b border-zinc-800/50 last:border-b-0">
                      {/* Page header */}
                      <button
                        onClick={() => togglePage(pageKey)}
                        className="w-full px-5 py-3 flex items-center gap-2 hover:bg-zinc-800/30 transition-colors text-left"
                      >
                        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />}
                        <span className="text-xs font-medium text-zinc-200 truncate">{first.pageTitle}</span>
                        <span className="text-[11px] text-zinc-500">/{first.pageSlug}</span>
                        <StatusBadge status={pageState?.status} />
                        <span className="ml-auto text-[11px] text-zinc-500">{pageItems.length} change{pageItems.length !== 1 ? 's' : ''}</span>
                        {pagePending > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">{pagePending} pending</span>}
                        {pageApprovedCount > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/30 text-green-400">{pageApprovedCount} approved</span>}
                      </button>

                      {/* Page items (collapsible) */}
                      {!isCollapsed && (
                        <div className="pb-2">
                          {/* Approve all for this page */}
                          {pagePending > 1 && effectiveTier !== 'free' && (
                            <div className="px-5 pb-2">
                              <button
                                onClick={() => approveAllForPage(batch.id, pageItems)}
                                className="flex items-center gap-1 px-2.5 py-1 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 rounded text-[11px] font-medium text-green-400 transition-colors"
                              >
                                <Check className="w-3 h-3" /> Approve all {pagePending} for this page
                              </button>
                            </div>
                          )}

                          {pageItems.map(item => {
                            const isEditing = editingApproval === item.id;
                            const displayValue = item.clientValue || item.proposedValue;
                            const isSchema = item.field === 'schema';
                            const fieldLabel = isSchema ? 'Structured Data (JSON-LD)'
                              : item.field === 'seoTitle' ? 'SEO Title'
                              : item.field === 'seoDescription' ? 'Meta Description'
                              : item.field.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                            const statusColors = {
                              pending: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
                              approved: 'bg-green-500/10 border-green-500/30 text-green-400',
                              rejected: 'bg-red-500/10 border-red-500/30 text-red-400',
                              applied: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
                            };

                            // Parse schema types for preview
                            let schemaTypes: string[] = [];
                            if (isSchema) {
                              try {
                                const parsed = JSON.parse(displayValue);
                                const graph = parsed?.['@graph'] as Array<{ '@type'?: string }> | undefined;
                                schemaTypes = graph?.map(n => String(n['@type'])).filter(Boolean) || [];
                              } catch (err) { console.error('ApprovalsTab operation failed:', err); }
                            }

                            return (
                              <div key={item.id} className="px-5 py-3 ml-4 border-l-2 border-zinc-800">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-[11px] font-medium text-zinc-400">{fieldLabel}</span>
                                  <span className={`text-[11px] px-1.5 py-0.5 rounded border ${statusColors[item.status]}`}>{item.status}</span>
                                  {isSchema && schemaTypes.length > 0 && schemaTypes.map(t => (
                                    <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-300">{t}</span>
                                  ))}
                                </div>

                                {/* Reason / context from audit */}
                                {item.reason && (
                                  <div className="mt-2 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/10 text-[11px] text-blue-300/80">
                                    <span className="font-medium text-blue-400">Why: </span>{item.reason}
                                  </div>
                                )}

                                {/* Schema preview or Current vs proposed */}
                                {isSchema ? (
                                  <div className="mt-2">
                                    <div className="text-[11px] text-zinc-500 mb-1">Proposed Schema</div>
                                    <pre className="text-[11px] text-zinc-300 bg-zinc-800/50 rounded-lg px-3 py-2 overflow-x-auto max-h-[200px] overflow-y-auto border border-zinc-800 font-mono leading-relaxed">
                                      {displayValue}
                                    </pre>
                                    {item.currentValue && (
                                      <div className="mt-2">
                                        <div className="text-[11px] text-zinc-500 mb-1">Existing on page: {item.currentValue}</div>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                                    <div>
                                      <div className="text-[11px] text-zinc-500 mb-1">Current</div>
                                      <div className="text-[11px] text-zinc-400 bg-zinc-800/30 rounded-lg px-3 py-2 min-h-[2rem]">
                                        {item.currentValue || <span className="italic text-zinc-500">Empty</span>}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-[11px] text-zinc-500 mb-1 flex items-center gap-1">
                                        {item.clientValue ? 'Your Edit' : 'Proposed'}
                                        {item.clientValue && <span className="text-teal-400">✓</span>}
                                      </div>
                                      {isEditing ? (
                                        <div className="space-y-2">
                                          {item.field === 'seoTitle' ? (
                                            <input
                                              type="text"
                                              value={editDraft}
                                              onChange={e => setEditDraft(e.target.value)}
                                              className="w-full px-3 py-1.5 bg-zinc-800 border border-teal-500/50 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-400"
                                            />
                                          ) : (
                                            <textarea
                                              value={editDraft}
                                              onChange={e => setEditDraft(e.target.value)}
                                              rows={2}
                                              className="w-full px-3 py-1.5 bg-zinc-800 border border-teal-500/50 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-400 resize-none"
                                            />
                                          )}
                                          <div className="flex gap-1.5">
                                            <button
                                              onClick={() => updateApprovalItem(batch.id, item.id, { clientValue: editDraft })}
                                              className="px-2.5 py-1 bg-teal-600 hover:bg-teal-500 rounded text-[11px] font-medium transition-colors"
                                            >Save Edit</button>
                                            <button
                                              onClick={() => { setEditingApproval(null); setEditDraft(''); }}
                                              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] text-zinc-400 transition-colors"
                                            >Cancel</button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="text-[11px] text-zinc-200 bg-zinc-800/30 rounded-lg px-3 py-2 min-h-[2rem]">
                                          {displayValue}
                                        </div>
                                      )}
                                      {item.clientValue && !isEditing && (
                                        <div className="mt-1 text-[10px] text-zinc-500">
                                          Originally: <span className="line-through">{item.proposedValue}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Actions */}
                                {item.status === 'pending' && !isEditing && rejectingItem !== item.id && (
                                  effectiveTier === 'free' ? (
                                    <TierGate tier={effectiveTier} required="growth" feature="Approve & Edit Changes" compact className="mt-3"><span /></TierGate>
                                  ) : (
                                  <div className="flex items-center gap-2 mt-3">
                                    <button
                                      onClick={() => updateApprovalItem(batch.id, item.id, { status: 'approved' })}
                                      className="flex items-center gap-1 px-3 py-1.5 bg-green-600/80 hover:bg-green-500 rounded-lg text-[11px] font-medium transition-colors"
                                    >
                                      <Check className="w-3 h-3" /> Approve
                                    </button>
                                    {!isSchema && (
                                      <button
                                        onClick={() => { setEditingApproval(item.id); setEditDraft(displayValue); }}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-[11px] font-medium text-zinc-300 transition-colors"
                                      >
                                        <Edit3 className="w-3 h-3" /> Edit
                                      </button>
                                    )}
                                    <button
                                      onClick={() => { setRejectingItem(item.id); setRejectDraft(''); }}
                                      className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-[11px] font-medium text-red-400 transition-colors"
                                    >
                                      <X className="w-3 h-3" /> Reject
                                    </button>
                                  </div>
                                  )
                                )}
                                {/* Rejection note — inline two-step */}
                                {item.status === 'pending' && !isEditing && rejectingItem === item.id && effectiveTier !== 'free' && (
                                  <div className="mt-3 space-y-2">
                                    <div className="text-[11px] text-zinc-400">Add an optional note for the agency:</div>
                                    <textarea
                                      value={rejectDraft}
                                      onChange={e => setRejectDraft(e.target.value)}
                                      rows={2}
                                      placeholder="Reason for rejection (optional)"
                                      className="w-full px-3 py-1.5 bg-zinc-800 border border-red-500/30 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-red-400 resize-none placeholder:text-zinc-600"
                                    />
                                    <div className="flex gap-1.5">
                                      <button
                                        onClick={() => {
                                          updateApprovalItem(batch.id, item.id, { status: 'rejected', ...(rejectDraft ? { clientNote: rejectDraft } : {}) });
                                          setRejectingItem(null);
                                          setRejectDraft('');
                                        }}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-red-600/80 hover:bg-red-500 rounded-lg text-[11px] font-medium transition-colors"
                                      >
                                        <X className="w-3 h-3" /> Confirm Reject
                                      </button>
                                      <button
                                        onClick={() => { setRejectingItem(null); setRejectDraft(''); }}
                                        className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] text-zinc-400 transition-colors"
                                      >Cancel</button>
                                    </div>
                                  </div>
                                )}
                                {item.status === 'approved' && (
                                  <div className="flex items-center gap-2 mt-3 text-[11px] text-green-400">
                                    <Check className="w-3 h-3" /> Approved — will be applied when you push changes live
                                    <button
                                      onClick={() => updateApprovalItem(batch.id, item.id, { status: 'pending' })}
                                      className="ml-2 px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-[11px] text-zinc-400 transition-colors"
                                    >Undo</button>
                                  </div>
                                )}
                                {item.status === 'rejected' && (
                                  <div className="mt-3">
                                    <div className="flex items-center gap-2 text-[11px] text-red-400">
                                      <X className="w-3 h-3" /> Rejected
                                      <button
                                        onClick={() => updateApprovalItem(batch.id, item.id, { status: 'pending', clientNote: '' })}
                                        className="ml-2 px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-[11px] text-zinc-400 transition-colors"
                                      >Undo</button>
                                    </div>
                                    {item.clientNote && (
                                      <div className="mt-1 text-[10px] text-zinc-500">Note: {item.clientNote}</div>
                                    )}
                                  </div>
                                )}
                                {item.status === 'applied' && (
                                  <div className="flex items-center gap-2 mt-3 text-[11px] text-blue-400">
                                    <CheckCircle2 className="w-3 h-3" /> Applied to live site on {new Date(item.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>

            {/* Batch actions */}
            {/* Batch footer actions */}
            <div className="px-5 py-4 border-t border-zinc-800 bg-zinc-900/50 flex items-center justify-between gap-3">
              <span className="text-[11px] text-zinc-400">
                {batchApplied > 0 && <>{batchApplied} applied · </>}
                {batchApproved > 0 && <>{batchApproved} approved · </>}
                {batchPending > 0 && <>{batchPending} pending</>}
                {batchApplied === batch.items.length && batchApplied > 0 && (
                  <span className="text-blue-400"> All changes live as of {new Date(batch.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {batchPending > 0 && effectiveTier !== 'free' && (
                  <button
                    onClick={() => approveAllInBatch(batch)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 rounded-lg text-[11px] font-medium text-green-400 transition-colors"
                  >
                    <Check className="w-3 h-3" /> Approve All ({batchPending})
                  </button>
                )}
                {batchApproved > 0 && (
                  <button
                    onClick={() => applyApprovedBatch(batch.id)}
                    disabled={isApplying}
                    className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
                  >
                    {isApplying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    {isApplying ? 'Applying...' : 'Apply to Website'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
