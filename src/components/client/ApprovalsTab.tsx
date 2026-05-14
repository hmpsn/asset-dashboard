import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ClipboardCheck, Check, CheckCircle2, Edit3, X, ChevronDown, ChevronRight, Loader2,
} from 'lucide-react';
import { TierGate, EmptyState, LoadingState, ConfirmDialog, type Tier, Icon, Button, ClickableRow, SectionCard } from '../ui';
import { StatusBadge } from '../ui/StatusBadge';
import { usePageEditStates } from '../../hooks/usePageEditStates';
import type { ApprovalBatch, ApprovalItem, ApprovalPageKeyword } from './types';
import { patch, post } from '../../api/client';
import { findPageMapEntryBySlug } from '../../lib/pathUtils';
import { isClientApplyableBatch } from './approvalApplyability';

type FilterState = 'all' | 'needs-action' | 'ready' | 'applied';

interface ApprovalsTabProps {
  workspaceId: string;
  approvalBatches: ApprovalBatch[];
  approvalsLoading: boolean;
  pendingApprovals: number;
  effectiveTier: Tier;
  setApprovalBatches: React.Dispatch<React.SetStateAction<ApprovalBatch[]>>;
  loadApprovals: (wsId: string) => void;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  pageMap?: ApprovalPageKeyword[];
}

export function ApprovalsTab({
  workspaceId, approvalBatches, approvalsLoading, pendingApprovals,
  effectiveTier, setApprovalBatches, loadApprovals, setToast, pageMap,
}: ApprovalsTabProps) {
  const [applyingBatch, setApplyingBatch] = useState<string | null>(null);
  const [editingApproval, setEditingApproval] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [rejectingItem, setRejectingItem] = useState<string | null>(null);
  const [rejectDraft, setRejectDraft] = useState('');
  const [collapsedPages, setCollapsedPages] = useState<Set<string>>(new Set());
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
  }>({ open: false, title: '', message: '' });
  // Action lives in a ref so handleConfirm/handleCancel can be stable useCallback references,
  // preventing ConfirmDialog's keydown useEffect from re-attaching on every parent render.
  const actionRef = useRef<(() => Promise<void>) | null>(null);
  // Fresh ref to approvalBatches so async confirm callbacks re-derive pending items at
  // confirm time rather than closing over a stale snapshot from when the dialog opened.
  const approvalBatchesRef = useRef(approvalBatches);
  useEffect(() => { approvalBatchesRef.current = approvalBatches; }, [approvalBatches]);
  const { getState } = usePageEditStates(workspaceId, true);

  const openConfirm = (title: string, message: string, action: () => Promise<void>) => {
    actionRef.current = action;
    setConfirmState({ open: true, title, message });
  };

  const handleConfirm = useCallback(async () => {
    const action = actionRef.current;
    actionRef.current = null;
    setConfirmState(s => ({ ...s, open: false }));
    if (action) {
      try { await action(); }
      catch { setToast({ message: 'Something went wrong. Please try again.', type: 'error' }); }
    }
  }, [setToast]);

  const handleCancel = useCallback(() => {
    actionRef.current = null;
    setConfirmState(s => ({ ...s, open: false }));
  }, []);

  const [batchFilter, setBatchFilter] = useState<FilterState>('all');

  const needsActionCount = approvalBatches.filter(b =>
    b.items.some(i => i.status === 'pending' || !i.status)
  ).length;

  // "ready" = all decisions made (no pending), has approvals, not yet fully applied
  const isReady = (b: ApprovalBatch) =>
    b.items.length > 0 &&
    !b.items.some(i => i.status === 'pending' || !i.status) &&
    b.items.some(i => i.status === 'approved') &&
    !b.items.every(i => i.status === 'applied');

  const readyCount = approvalBatches.filter(isReady).length;

  const appliedCount = approvalBatches.filter(b =>
    b.items.length > 0 && b.items.every(i => i.status === 'applied')
  ).length;

  const filteredBatches = approvalBatches.filter(batch => {
    if (batchFilter === 'needs-action') return batch.items.some(i => i.status === 'pending' || !i.status);
    if (batchFilter === 'ready') return isReady(batch);
    if (batchFilter === 'applied') return batch.items.length > 0 && batch.items.every(i => i.status === 'applied');
    return true;
  });

  const togglePage = (key: string) => setCollapsedPages(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const approveAllInBatch = (batch: ApprovalBatch) => {
    const batchId = batch.id;
    const batchName = batch.name;
    const pendingCount = batch.items.filter(i => i.status === 'pending').length;
    openConfirm(
      'Approve all changes',
      `Approve all ${pendingCount} pending change${pendingCount !== 1 ? 's' : ''} in "${batchName}"?`,
      async () => {
        const freshBatch = approvalBatchesRef.current.find(b => b.id === batchId);
        const pending = freshBatch?.items.filter(i => i.status === 'pending') ?? [];
        for (const item of pending) {
          await updateApprovalItem(batchId, item.id, { status: 'approved' });
        }
        setToast({ message: `Approved ${pending.length} change${pending.length !== 1 ? 's' : ''}`, type: 'success' });
      }
    );
  };

  const approveAllForPage = (batchId: string, items: ApprovalItem[]) => {
    const pageId = items[0]?.pageId;
    const pendingCount = items.filter(i => i.status === 'pending').length;
    openConfirm(
      'Approve page changes',
      `Approve all ${pendingCount} pending change${pendingCount !== 1 ? 's' : ''} for this page?`,
      async () => {
        const freshBatch = approvalBatchesRef.current.find(b => b.id === batchId);
        const pending = freshBatch?.items.filter(i => i.status === 'pending' && i.pageId === pageId) ?? [];
        for (const item of pending) {
          await updateApprovalItem(batchId, item.id, { status: 'approved' });
        }
        setToast({ message: `Approved ${pending.length} change${pending.length !== 1 ? 's' : ''}`, type: 'success' });
      }
    );
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

  const applyApprovedBatch = (batchId: string) => {
    openConfirm(
      'Apply to live site?',
      'This will update your live website with the approved changes. This cannot be undone from the dashboard.',
      async () => {
        setApplyingBatch(batchId);
        try {
          const data = await post<{ applied: number }>(`/api/public/approvals/${workspaceId}/${batchId}/apply`);
          if (data.applied > 0) {
            setToast({ message: `${data.applied} change${data.applied !== 1 ? 's' : ''} applied to your website`, type: 'success' });
          }
          loadApprovals(workspaceId);
        } catch { setToast({ message: 'Failed to apply changes. Please try again.', type: 'error' }); }
        finally { setApplyingBatch(null); }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Icon as={ClipboardCheck} size="lg" className="text-accent-brand" />
        <div>
          <h2 className="t-h2 text-[var(--brand-text-bright)]">SEO Change Approvals</h2>
          <p className="t-body text-[var(--brand-text-muted)] mt-1 leading-relaxed">Review proposed SEO changes, make edits if needed, then approve to push live.</p>
        </div>
        {pendingApprovals > 0 && (
          <span className="ml-auto px-2 py-0.5 t-caption-sm font-medium rounded-[var(--radius-pill)] bg-teal-500/20 border border-teal-500/30 text-accent-brand">
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

      {/* Filter bar */}
      {approvalBatches.length > 0 && (
        <div className="flex items-center gap-2 pb-4 border-b border-[var(--brand-border)] flex-wrap">
          {(
            [
              { id: 'all', label: 'All', count: approvalBatches.length },
              { id: 'needs-action', label: 'Needs Action', count: needsActionCount },
              { id: 'ready', label: 'Ready to Apply', count: readyCount },
              { id: 'applied', label: 'Applied', count: appliedCount },
            ] as { id: FilterState; label: string; count: number }[]
          ).map(tab => (
            <button
              type="button"
              key={tab.id}
              onClick={() => setBatchFilter(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption font-medium transition-colors ${
                batchFilter === tab.id
                  ? 'text-accent-brand bg-teal-500/10 border border-teal-500/20'
                  : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]/50 border border-transparent'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-[var(--radius-sm)] t-caption-sm font-semibold ${
                  batchFilter === tab.id ? 'bg-teal-500/20 text-accent-brand' : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)]'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {filteredBatches.map(batch => {
        const batchPending = batch.items.filter(i => i.status === 'pending').length;
        const batchApproved = batch.items.filter(i => i.status === 'approved').length;
        const batchApplied = batch.items.filter(i => i.status === 'applied').length;
        const batchRejected = batch.items.filter(i => i.status === 'rejected').length;
        const isApplying = applyingBatch === batch.id;

        return (
          <SectionCard
            key={batch.id}
            title={batch.name}
            titleExtra={
              <span className="t-caption-sm text-[var(--brand-text-muted)]">
                {new Date(batch.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {' · '}{batch.items.length} change{batch.items.length !== 1 ? 's' : ''}
              </span>
            }
            action={
              <div className="flex items-center gap-2">
                {batchPending > 0 && <span className="t-caption-sm px-2 py-0.5 rounded-[var(--radius-pill)] bg-amber-500/10 border border-amber-500/30 text-accent-warning">{batchPending} pending</span>}
                {batchApproved > 0 && <span className="t-caption-sm px-2 py-0.5 rounded-[var(--radius-pill)] bg-emerald-500/10 border border-emerald-500/30 text-accent-success">{batchApproved} approved</span>}
                {batchApplied > 0 && <span className="t-caption-sm px-2 py-0.5 rounded-[var(--radius-pill)] bg-blue-500/10 border border-blue-500/30 text-accent-info">{batchApplied} applied</span>}
                {batchRejected > 0 && <span className="t-caption-sm px-2 py-0.5 rounded-[var(--radius-pill)] bg-red-500/10 border border-red-500/30 text-accent-danger">{batchRejected} rejected</span>}
              </div>
            }
            noPadding
          >

            {/* Items grouped by page */}
            <div className="divide-y divide-[var(--brand-border)]/50">
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
                    <div key={pageKey} className="border-b border-[var(--brand-border)]/50 last:border-b-0">
                      {/* Page header */}
                      <ClickableRow
                        onClick={() => togglePage(pageKey)}
                        className="px-5 py-3 flex items-center gap-2"
                      >
                        {isCollapsed ? <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)] shrink-0" /> : <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)] shrink-0" />}
                        <span className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{first.pageTitle}</span>
                        <span className="t-caption-sm text-[var(--brand-text-muted)]">/{first.pageSlug}</span>
                        <StatusBadge status={pageState?.status} />
                        <span className="ml-auto t-caption-sm text-[var(--brand-text-muted)]">{pageItems.length} change{pageItems.length !== 1 ? 's' : ''}</span>
                        {pagePending > 0 && <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-amber-500/10 border border-amber-500/30 text-accent-warning">{pagePending} pending</span>}
                        {pageApprovedCount > 0 && <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-emerald-500/10 border border-emerald-500/30 text-accent-success">{pageApprovedCount} approved</span>}
                      </ClickableRow>

                      {/* Page items (collapsible) */}
                      {!isCollapsed && (
                        <div className="pb-2">
                          {/* Approve all for this page */}
                          {pagePending > 1 && effectiveTier !== 'free' && (
                            <div className="px-5 pb-2">
                              <Button
                                variant="primary"
                                size="sm"
                                icon={Check}
                                onClick={() => approveAllForPage(batch.id, pageItems)}
                              >
                                Approve all {pagePending} for this page
                              </Button>
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
                              pending: 'bg-amber-500/10 border-amber-500/30 text-accent-warning',
                              approved: 'bg-emerald-500/10 border-emerald-500/30 text-accent-success',
                              rejected: 'bg-red-500/10 border-red-500/30 text-accent-danger',
                              applied: 'bg-blue-500/10 border-blue-500/30 text-accent-info',
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
                              <div key={item.id} className="px-5 py-3 ml-4 border-l-2 border-[var(--brand-border)]">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                  <span className="t-caption-sm font-medium text-[var(--brand-text-muted)]">{fieldLabel}</span>
                                  <span className={`t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] border ${statusColors[item.status || 'pending']}`}>{item.status || 'pending'}</span>
                                  {isSchema && schemaTypes.length > 0 && schemaTypes.map(t => (
                                    <span key={t} className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-teal-500/10 border border-teal-500/20 text-accent-brand">{t}</span>
                                  ))}
                                  {(item.field === 'seoTitle' || item.field === 'seoDescription') && (() => {
                                    // item.pageSlug is a bare slug; use suffix fallback for nested pages
                                    const slug = item.pageSlug;
                                    const kw = findPageMapEntryBySlug(pageMap ?? [], slug);
                                    if (!kw) return null;
                                    return (
                                      <>
                                        <span className="t-caption-sm text-[var(--brand-text-muted)] ml-auto">targeting:</span>
                                        <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-blue-500/10 border border-blue-500/20 text-accent-info font-medium">
                                          {kw.primaryKeyword}
                                        </span>
                                        {kw.secondaryKeywords?.slice(0, 2).map(kw2 => (
                                          <span key={kw2} className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-3)]/60 border border-[var(--brand-border-strong)] text-[var(--brand-text-muted)]">
                                            {kw2}
                                          </span>
                                        ))}
                                      </>
                                    );
                                  })()}
                                </div>

                                {/* Reason / context from audit */}
                                {item.reason && (
                                  <div className="mt-2 px-3 py-2 rounded-[var(--radius-lg)] bg-blue-500/5 border border-blue-500/10 t-caption-sm text-accent-info">
                                    <span className="font-medium text-accent-info">Why: </span>{item.reason}
                                  </div>
                                )}

                                {/* Schema preview or Current vs proposed */}
                                {isSchema ? (
                                  <div className="mt-2">
                                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Proposed Schema</div>
                                    <pre className="t-caption-sm text-[var(--brand-text)] bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)] px-3 py-2 overflow-x-auto max-h-[200px] overflow-y-auto border border-[var(--brand-border)] font-mono leading-relaxed">
                                      {displayValue}
                                    </pre>
                                    {item.currentValue && (
                                      <div className="mt-2">
                                        <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Existing on page: {item.currentValue}</div>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                                    <div>
                                      <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Current</div>
                                      <div className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)]/30 rounded-[var(--radius-lg)] px-3 py-2 min-h-[2rem]">
                                        {item.currentValue || <span className="italic text-[var(--brand-text-muted)]">Empty</span>}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1 flex items-center gap-1">
                                        {item.clientValue ? 'Your Edit' : 'Proposed'}
                                        {item.clientValue && <span className="text-accent-brand">✓</span>}
                                      </div>
                                      {isEditing ? (
                                        <div className="space-y-2">
                                          {item.field === 'seoTitle' ? (
                                            <input
                                              type="text"
                                              value={editDraft}
                                              onChange={e => setEditDraft(e.target.value)}
                                              className="w-full px-3 py-1.5 bg-[var(--surface-3)] border border-teal-500/50 rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] focus:outline-none focus:border-teal-400"
                                            />
                                          ) : (
                                            <textarea
                                              value={editDraft}
                                              onChange={e => setEditDraft(e.target.value)}
                                              rows={2}
                                              className="w-full px-3 py-1.5 bg-[var(--surface-3)] border border-teal-500/50 rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] focus:outline-none focus:border-teal-400 resize-none"
                                            />
                                          )}
                                          <div className="flex gap-1.5">
                                            <Button
                                              size="sm"
                                              onClick={() => updateApprovalItem(batch.id, item.id, { clientValue: editDraft })}
                                            >
                                              Save Edit
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => { setEditingApproval(null); setEditDraft(''); }}
                                            >
                                              Cancel
                                            </Button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="t-caption-sm text-[var(--brand-text)] bg-[var(--surface-3)]/30 rounded-[var(--radius-lg)] px-3 py-2 min-h-[2rem]">
                                          {displayValue}
                                        </div>
                                      )}
                                      {item.clientValue && !isEditing && (
                                        <div className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">
                                          Originally: <span className="line-through">{item.proposedValue}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Actions */}
                                {(item.status === 'pending' || !item.status) && !isEditing && rejectingItem !== item.id && (
                                  effectiveTier === 'free' ? (
                                    <TierGate tier={effectiveTier} required="growth" feature="Approve & Edit Changes" compact className="mt-3"><span /></TierGate>
                                  ) : (
                                  <div className="flex items-center gap-2 mt-3">
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      icon={Check}
                                      onClick={() => updateApprovalItem(batch.id, item.id, { status: 'approved' })}
                                    >
                                      Approve
                                    </Button>
                                    {!isSchema && (
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        icon={Edit3}
                                        onClick={() => { setEditingApproval(item.id); setEditDraft(displayValue); }}
                                      >
                                        Edit
                                      </Button>
                                    )}
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      icon={X}
                                      onClick={() => { setRejectingItem(item.id); setRejectDraft(''); }}
                                      className="text-[var(--red)]"
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                  )
                                )}
                                {/* Rejection note — inline two-step */}
                                {(item.status === 'pending' || !item.status) && !isEditing && rejectingItem === item.id && effectiveTier !== 'free' && (
                                  <div className="mt-3 space-y-2">
                                    <div className="t-caption-sm text-[var(--brand-text-muted)]">Add an optional note for the agency:</div>
                                    <textarea
                                      value={rejectDraft}
                                      onChange={e => setRejectDraft(e.target.value)}
                                      rows={2}
                                      placeholder="Reason for rejection (optional)"
                                      className="w-full px-3 py-1.5 bg-[var(--surface-3)] border border-red-500/30 rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] focus:outline-none focus:border-red-400 resize-none placeholder:text-[var(--brand-text-faint)]"
                                    />
                                    <div className="flex gap-1.5">
                                      <Button
                                        variant="danger"
                                        size="sm"
                                        icon={X}
                                        onClick={() => {
                                          updateApprovalItem(batch.id, item.id, { status: 'rejected', clientNote: rejectDraft });
                                          setRejectingItem(null);
                                          setRejectDraft('');
                                        }}
                                      >
                                        Confirm Reject
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => { setRejectingItem(null); setRejectDraft(''); }}
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                )}
                                {item.status === 'approved' && (
                                  <div className="flex items-center gap-2 mt-3 t-caption-sm text-accent-success">
                                    <Icon as={Check} size="sm" /> Approved — will be applied when you push changes live
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => updateApprovalItem(batch.id, item.id, { status: 'pending' })}
                                      className="ml-2"
                                    >
                                      Undo
                                    </Button>
                                  </div>
                                )}
                                {item.status === 'rejected' && (
                                  <div className="mt-3">
                                    <div className="flex items-center gap-2 t-caption-sm text-accent-danger">
                                      <Icon as={X} size="sm" /> Rejected
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => updateApprovalItem(batch.id, item.id, { status: 'pending', clientNote: '' })}
                                        className="ml-2"
                                      >
                                        Undo
                                      </Button>
                                    </div>
                                    {item.clientNote && (
                                      <div className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">Note: {item.clientNote}</div>
                                    )}
                                  </div>
                                )}
                                {item.status === 'applied' && (
                                  <div className="flex items-center gap-2 mt-3 t-caption-sm text-accent-info">
                                    <Icon as={CheckCircle2} size="sm" /> Applied to live site on {new Date(item.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
            <div className="px-5 py-4 border-t border-[var(--brand-border)] bg-[var(--surface-2)]/50 flex items-center justify-between gap-3">
              <span className="t-caption-sm text-[var(--brand-text-muted)]">
                {batchApplied > 0 && <>{batchApplied} applied · </>}
                {batchApproved > 0 && <>{batchApproved} approved · </>}
                {batchPending > 0 && <>{batchPending} pending</>}
                {batchApplied === batch.items.length && batchApplied > 0 && (
                  <span className="text-accent-info"> All changes live as of {new Date(batch.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {batchPending > 0 && effectiveTier !== 'free' && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={Check}
                    onClick={() => approveAllInBatch(batch)}
                  >
                    Approve All ({batchPending})
                  </Button>
                )}
                {batchApproved > 0 && isClientApplyableBatch(batch) && (
                  <Button
                    onClick={() => applyApprovedBatch(batch.id)}
                    disabled={isApplying}
                    icon={isApplying ? Loader2 : Check}
                    className={isApplying ? '[&_svg]:animate-spin' : undefined}
                  >
                    {isApplying ? 'Applying...' : 'Apply to Website'}
                  </Button>
                )}
              </div>
            </div>
          </SectionCard>
        );
      })}
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel="Confirm"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}
