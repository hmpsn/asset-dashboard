/**
 * ApprovalBatchCard — inline card for the Decisions section.
 *
 * Renders a single approval batch at the same visual level as DecisionCard —
 * no surrounding tab chrome, filter bar, or page-level headings. The Decisions
 * section header already shows the aggregate pending count, so we skip redundant
 * counters here and focus on just the actionable content.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Check, CheckCircle2, Edit3, X, ChevronDown, ChevronRight, Loader2,
} from 'lucide-react';
import { TierGate, ConfirmDialog, type Tier, Icon, Button, ClickableRow, FormInput, FormTextarea, Badge, StatusBadge } from '../ui';
import { usePageEditStates } from '../../hooks/usePageEditStates';
import type { ApprovalBatch, ApprovalItem, ApprovalPageKeyword } from './types';
import { patch, post } from '../../api/client';
import { findPageMapEntryBySlug } from '../../lib/pathUtils';
import { isClientApplyableBatch } from './approvalApplyability';

interface ApprovalBatchCardProps {
  batch: ApprovalBatch;
  workspaceId: string;
  effectiveTier: Tier;
  setApprovalBatches: React.Dispatch<React.SetStateAction<ApprovalBatch[]>>;
  loadApprovals: (wsId: string) => void;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  pageMap?: ApprovalPageKeyword[];
}

export function ApprovalBatchCard({
  batch, workspaceId, effectiveTier,
  setApprovalBatches, loadApprovals, setToast, pageMap,
}: ApprovalBatchCardProps) {
  const [editingApproval, setEditingApproval] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [rejectingItem, setRejectingItem] = useState<string | null>(null);
  const [rejectDraft, setRejectDraft] = useState('');
  const [applyingBatch, setApplyingBatch] = useState(false);
  const [collapsedPages, setCollapsedPages] = useState<Set<string>>(new Set());
  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; message: string;
  }>({ open: false, title: '', message: '' });

  const actionRef = useRef<(() => Promise<void>) | null>(null);
  const batchRef = useRef(batch);
  useEffect(() => { batchRef.current = batch; }, [batch]);
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

  const togglePage = (key: string) => setCollapsedPages(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const updateApprovalItem = async (
    itemId: string,
    update: { status?: string; clientValue?: string; clientNote?: string },
  ): Promise<boolean> => {
    try {
      const updated = await patch<ApprovalBatch>(
        `/api/public/approvals/${workspaceId}/${batch.id}/${itemId}`, update,
      );
      if (updated.id) {
        setApprovalBatches(prev => prev.map(b => b.id === batch.id ? updated : b));
        // Clear edit state only on success so the user can retry if the request fails
        setEditingApproval(null);
        setEditDraft('');
      }
      return true;
    } catch {
      setToast({ message: 'Failed to update approval. Please try again.', type: 'error' });
      return false;
    }
  };

  const approveAllInBatch = () => {
    const pendingCount = batch.items.filter(i => i.status === 'pending').length;
    openConfirm(
      'Approve all changes',
      `Approve all ${pendingCount} pending change${pendingCount !== 1 ? 's' : ''} in "${batch.name}"?`,
      async () => {
        const pending = batchRef.current.items.filter(i => i.status === 'pending');
        let succeeded = 0;
        for (const item of pending) {
          const ok = await updateApprovalItem(item.id, { status: 'approved' });
          if (ok) succeeded++;
        }
        if (succeeded === pending.length) {
          setToast({ message: `Approved ${pending.length} change${pending.length !== 1 ? 's' : ''}`, type: 'success' });
        } else if (succeeded > 0) {
          setToast({ message: `Approved ${succeeded} of ${pending.length} — ${pending.length - succeeded} failed, please retry`, type: 'error' });
        }
      },
    );
  };

  const approveAllForPage = (pageItems: ApprovalItem[]) => {
    const pageId = pageItems[0]?.pageId;
    if (!pageId) return;
    const pendingCount = pageItems.filter(i => i.status === 'pending').length;
    openConfirm(
      'Approve page changes',
      `Approve all ${pendingCount} pending change${pendingCount !== 1 ? 's' : ''} for this page?`,
      async () => {
        const pending = batchRef.current.items.filter(
          i => i.status === 'pending' && i.pageId === pageId,
        );
        let succeeded = 0;
        for (const item of pending) {
          const ok = await updateApprovalItem(item.id, { status: 'approved' });
          if (ok) succeeded++;
        }
        if (succeeded === pending.length) {
          setToast({ message: `Approved ${pending.length} change${pending.length !== 1 ? 's' : ''}`, type: 'success' });
        } else if (succeeded > 0) {
          setToast({ message: `Approved ${succeeded} of ${pending.length} — ${pending.length - succeeded} failed, please retry`, type: 'error' });
        }
      },
    );
  };

  const applyApprovedBatch = () => {
    openConfirm(
      'Apply to live site?',
      'This will update your live website with the approved changes. This cannot be undone from the dashboard.',
      async () => {
        setApplyingBatch(true);
        try {
          const data = await post<{ applied: number }>(
            `/api/public/approvals/${workspaceId}/${batch.id}/apply`,
          );
          if (data.applied > 0) {
            setToast({ message: `${data.applied} change${data.applied !== 1 ? 's' : ''} applied to your website`, type: 'success' });
          }
          loadApprovals(workspaceId);
        } catch { setToast({ message: 'Failed to apply changes. Please try again.', type: 'error' }); }
        finally { setApplyingBatch(false); }
      },
    );
  };

  const batchPending = batch.items.filter(i => i.status === 'pending').length;
  const batchApproved = batch.items.filter(i => i.status === 'approved').length;
  const batchApplied = batch.items.filter(i => i.status === 'applied').length;

  // Group items by page
  const grouped = new Map<string, ApprovalItem[]>();
  for (const item of batch.items) {
    if (!grouped.has(item.pageId)) grouped.set(item.pageId, []);
    grouped.get(item.pageId)!.push(item);
  }

  return (
    // pr-check-disable-next-line -- brand signature radius intentional; mirrors DecisionCard visual identity
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>

      {/* ── Card header ── */}
      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-[var(--brand-border)]/60">
        <div className="flex items-center gap-2 min-w-0">
          <Badge label="SEO Changes" tone="zinc" variant="outline" shape="pill" className="shrink-0" />
          <span className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{batch.name}</span>
          <span className="t-caption-sm text-[var(--brand-text-muted)] shrink-0">
            {new Date(batch.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {' · '}{batch.items.length} change{batch.items.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {batchPending > 0 && <Badge label={`${batchPending} pending`} tone="amber" variant="outline" shape="pill" />}
          {batchApproved > 0 && <Badge label={`${batchApproved} approved`} tone="emerald" variant="outline" shape="pill" />}
          {batchApplied > 0 && <Badge label={`${batchApplied} applied`} tone="blue" variant="outline" shape="pill" />}
        </div>
      </div>

      {/* ── Items grouped by page ── */}
      <div className="divide-y divide-[var(--brand-border)]/50">
        {Array.from(grouped.entries()).map(([pageId, pageItems]) => {
          const first = pageItems[0];
          const pageKey = `${batch.id}-${pageId}`;
          const isCollapsed = collapsedPages.has(pageKey);
          const pagePending = pageItems.filter(i => i.status === 'pending').length;
          const pageApprovedCount = pageItems.filter(i => i.status === 'approved').length;
          const pageState = getState(pageId);

          return (
            <div key={pageKey}>
              {/* Page header row */}
              <ClickableRow onClick={() => togglePage(pageKey)} aria-expanded={!isCollapsed} className="px-4 py-3 flex items-center gap-2">
                {isCollapsed
                  ? <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)] shrink-0" />
                  : <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)] shrink-0" />}
                <span className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{first.pageTitle}</span>
                <span className="t-caption-sm text-[var(--brand-text-muted)]">/{first.pageSlug}</span>
                <StatusBadge status={pageState?.status} />
                <span className="ml-auto t-caption-sm text-[var(--brand-text-muted)]">{pageItems.length} change{pageItems.length !== 1 ? 's' : ''}</span>
                {pagePending > 0 && <Badge label={`${pagePending} pending`} tone="amber" variant="outline" />}
                {pageApprovedCount > 0 && <Badge label={`${pageApprovedCount} approved`} tone="emerald" variant="outline" />}
              </ClickableRow>

              {/* Page items */}
              {!isCollapsed && (
                <div className="pb-2">
                  {pagePending > 1 && effectiveTier !== 'free' && (
                    <div className="px-4 pb-2">
                      <Button variant="primary" size="sm" icon={Check} onClick={() => approveAllForPage(pageItems)}>
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

                    let schemaTypes: string[] = [];
                    if (isSchema) {
                      try {
                        const parsed = JSON.parse(displayValue);
                        const graph = parsed?.['@graph'] as Array<{ '@type'?: string }> | undefined;
                        schemaTypes = graph?.map(n => String(n['@type'])).filter(Boolean) || [];
                      } catch (err) { console.error('ApprovalBatchCard: JSON parse failed', err); }
                    }

                    return (
                      <div key={item.id} className="px-4 py-3 ml-4 border-l-2 border-[var(--brand-border)]">
                        {/* Field label + status + keyword targeting */}
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="t-caption-sm font-medium text-[var(--brand-text-muted)]">{fieldLabel}</span>
                          <StatusBadge status={item.status || 'pending'} domain="approval" variant="outline" />
                          {isSchema && schemaTypes.length > 0 && schemaTypes.map(t => (
                            <Badge key={t} label={t} tone="teal" variant="outline" />
                          ))}
                          {(item.field === 'seoTitle' || item.field === 'seoDescription') && (() => {
                            const kw = findPageMapEntryBySlug(pageMap ?? [], item.pageSlug);
                            if (!kw) return null;
                            return (
                              <>
                                <span className="t-caption-sm text-[var(--brand-text-muted)] ml-auto">targeting:</span>
                                <Badge label={kw.primaryKeyword} tone="blue" variant="outline" />
                                {kw.secondaryKeywords?.slice(0, 2).map(kw2 => (
                                  <Badge key={kw2} label={kw2} tone="zinc" variant="outline" />
                                ))}
                              </>
                            );
                          })()}
                        </div>

                        {/* Why reason */}
                        {item.reason && (
                          <div className="mt-2 px-3 py-2 rounded-[var(--radius-lg)] bg-blue-500/5 border border-blue-500/10 t-caption-sm text-accent-info">
                            <span className="font-medium">Why: </span>{item.reason}
                          </div>
                        )}

                        {/* Current vs Proposed / Schema preview */}
                        {isSchema ? (
                          <div className="mt-2">
                            <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Proposed Schema</div>
                            <pre className="t-caption-sm text-[var(--brand-text)] bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)] px-3 py-2 overflow-x-auto max-h-[200px] overflow-y-auto border border-[var(--brand-border)] font-mono leading-relaxed">
                              {displayValue}
                            </pre>
                            {item.currentValue && (
                              <div className="mt-2 t-caption-sm text-[var(--brand-text-muted)]">Existing on page: {item.currentValue}</div>
                            )}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                            <div>
                              <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Current</div>
                              <div className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)]/30 rounded-[var(--radius-lg)] px-3 py-2 min-h-[2rem]">
                                {item.currentValue || <span className="italic">Empty</span>}
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
                                    <FormInput
                                      type="text"
                                      value={editDraft}
                                      onChange={setEditDraft}
                                      className="w-full t-caption"
                                    />
                                  ) : (
                                    <FormTextarea
                                      value={editDraft}
                                      onChange={setEditDraft}
                                      rows={2}
                                      className="w-full t-caption"
                                    />
                                  )}
                                  <div className="flex gap-1.5">
                                    <Button size="sm" onClick={() => updateApprovalItem(item.id, { clientValue: editDraft })}>
                                      Save Edit
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => { setEditingApproval(null); setEditDraft(''); }}>
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

                        {/* Approve / Edit / Reject — pending items */}
                        {(item.status === 'pending' || !item.status) && !isEditing && rejectingItem !== item.id && (
                          effectiveTier === 'free' ? (
                            <TierGate tier={effectiveTier} required="growth" feature="Approve & Edit Changes" compact className="mt-3"><span /></TierGate>
                          ) : (
                            <div className="flex items-center gap-2 mt-3">
                              <Button variant="primary" size="sm" icon={Check}
                                onClick={() => updateApprovalItem(item.id, { status: 'approved' })}>
                                Approve
                              </Button>
                              {!isSchema && (
                                <Button variant="secondary" size="sm" icon={Edit3}
                                  onClick={() => { setEditingApproval(item.id); setEditDraft(displayValue); }}>
                                  Edit
                                </Button>
                              )}
                              <Button variant="secondary" size="sm" icon={X} className="text-[var(--red)]"
                                onClick={() => { setRejectingItem(item.id); setRejectDraft(''); }}>
                                Reject
                              </Button>
                            </div>
                          )
                        )}

                        {/* Rejection note flow */}
                        {(item.status === 'pending' || !item.status) && !isEditing && rejectingItem === item.id && effectiveTier !== 'free' && (
                          <div className="mt-3 space-y-2">
                            <div className="t-caption-sm text-[var(--brand-text-muted)]">Add an optional note for the agency:</div>
                            <FormTextarea
                              value={rejectDraft}
                              onChange={setRejectDraft}
                              rows={2}
                              placeholder="Reason for rejection (optional)"
                              className="w-full t-caption placeholder:text-[var(--brand-text-faint)]"
                            />
                            <div className="flex gap-1.5">
                              <Button variant="danger" size="sm" icon={X} onClick={() => {
                                updateApprovalItem(item.id, { status: 'rejected', clientNote: rejectDraft });
                                setRejectingItem(null);
                                setRejectDraft('');
                              }}>
                                Confirm Reject
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => { setRejectingItem(null); setRejectDraft(''); }}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Approved state */}
                        {item.status === 'approved' && (
                          <div className="flex items-center gap-2 mt-3 t-caption-sm text-accent-success">
                            <Icon as={Check} size="sm" /> Approved — will be applied when you push changes live
                            <Button variant="secondary" size="sm" className="ml-2"
                              onClick={() => updateApprovalItem(item.id, { status: 'pending' })}>
                              Undo
                            </Button>
                          </div>
                        )}

                        {/* Rejected state */}
                        {item.status === 'rejected' && (
                          <div className="mt-3">
                            <div className="flex items-center gap-2 t-caption-sm text-accent-danger">
                              <Icon as={X} size="sm" /> Rejected
                              <Button variant="secondary" size="sm" className="ml-2"
                                onClick={() => updateApprovalItem(item.id, { status: 'pending', clientNote: '' })}>
                                Undo
                              </Button>
                            </div>
                            {item.clientNote && (
                              <div className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">Note: {item.clientNote}</div>
                            )}
                          </div>
                        )}

                        {/* Applied state */}
                        {item.status === 'applied' && (
                          <div className="flex items-center gap-2 mt-3 t-caption-sm text-accent-info">
                            <Icon as={CheckCircle2} size="sm" />
                            Applied to live site on {new Date(item.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Card footer ── */}
      {(batchPending > 0 || (batchApproved > 0 && isClientApplyableBatch(batch))) && (
        <div className="px-4 py-3 border-t border-[var(--brand-border)]/60 flex items-center justify-between gap-3 bg-[var(--surface-2)]/50">
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            {batchApplied > 0 && <>{batchApplied} applied · </>}
            {batchApproved > 0 && <>{batchApproved} approved · </>}
            {batchPending > 0 && <>{batchPending} pending</>}
          </span>
          <div className="flex items-center gap-2">
            {batchPending > 0 && effectiveTier !== 'free' && (
              <Button variant="primary" size="sm" icon={Check} onClick={approveAllInBatch}>
                Approve All ({batchPending})
              </Button>
            )}
            {batchApproved > 0 && isClientApplyableBatch(batch) && (
              <Button
                onClick={applyApprovedBatch}
                disabled={applyingBatch}
                icon={applyingBatch ? Loader2 : Check}
                className={applyingBatch ? '[&_svg]:animate-spin' : undefined}
              >
                {applyingBatch ? 'Applying...' : 'Apply to Website'}
              </Button>
            )}
          </div>
        </div>
      )}

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
