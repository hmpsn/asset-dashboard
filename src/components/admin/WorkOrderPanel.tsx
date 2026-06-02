// ── Work Order conversation/close panel (admin, production) ──────────────────
// A focused per-workspace modal (NOT a full dashboard tab) reachable from the
// WorkspaceHome "purchased fixes awaiting fulfillment" attention item. It shows
// the workspace's work orders; selecting one opens the order detail + the
// client↔team conversation + a reply box + the two operator status actions:
// "Mark complete" (in_progress → completed) and "Close out" (completed → closed,
// one-way, no reopen).
//
// Colors: admin surface, but this is NOT an AI feature, so NO purple (Four Laws).
// Teal = actions, blue = info, emerald = done, amber = in-progress, red = cancel.
import { useEffect, useMemo, useState } from 'react';
import { X, Send, Clock, Loader2, CheckCircle2, Archive, MessageSquare, ChevronRight } from 'lucide-react';
import {
  Button,
  IconButton,
  LoadingState,
  EmptyState,
  ConfirmDialog,
  ClickableRow,
} from '../ui';
import { FormTextarea } from '../ui/forms/FormTextarea';
import {
  useAdminWorkOrders,
  useAdminWorkOrderComments,
  useUpdateWorkOrderStatus,
  usePostWorkOrderComment,
} from '../../hooks/admin/useWorkOrders';
import type { WorkOrder } from '../../../shared/types/payments';

interface WorkOrderPanelProps {
  workspaceId: string;
  onDismiss: () => void;
}

const STATUS_META: Record<WorkOrder['status'], { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] border-[var(--brand-border)]' },
  in_progress: { label: 'In progress', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  completed: { label: 'Completed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  closed: { label: 'Closed', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-500/10 text-red-400 border-red-500/30' },
};

function humanizeProduct(productType: string): string {
  return productType.replace(/_/g, ' ');
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function WorkOrderPanel({ workspaceId, onDismiss }: WorkOrderPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [closeConfirm, setCloseConfirm] = useState(false);

  const { data: orders, isLoading, isError } = useAdminWorkOrders(workspaceId);
  const { data: comments, isLoading: commentsLoading } = useAdminWorkOrderComments(workspaceId, selectedId);
  const updateStatus = useUpdateWorkOrderStatus(workspaceId);
  const postComment = usePostWorkOrderComment(workspaceId);

  const selected = useMemo(
    () => (orders ?? []).find((o) => o.id === selectedId) ?? null,
    [orders, selectedId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack Escape while the operator is typing in the reply box (or any field).
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      )
        return;
      if (e.key === 'Escape') {
        if (selectedId) setSelectedId(null);
        else onDismiss();
      }
    };
    document.addEventListener('keydown', onKey); // keydown-ok — isContentEditable guard is in the handler body above
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedId, onDismiss]);

  const handleSend = () => {
    const content = reply.trim();
    if (!content || !selectedId) return;
    postComment.mutate(
      { orderId: selectedId, content },
      { onSuccess: () => setReply('') },
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="work-order-panel-title"
      className="fixed inset-0 z-[var(--z-modal-fullscreen)] flex flex-col" // fixed-inset-ok — focused admin panel; escape + backdrop close handled in body
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onDismiss} />
      <div
        className="relative z-[var(--z-sticky)] flex flex-col h-full max-w-3xl mx-auto w-full bg-[var(--surface-1)] shadow-2xl overflow-hidden"
        style={{ borderRadius: '0 0 var(--radius-xl) var(--radius-xl)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--brand-border)] flex-shrink-0">
          <IconButton
            autoFocus
            onClick={selected ? () => setSelectedId(null) : onDismiss}
            icon={X}
            label={selected ? 'Back to list' : 'Close'}
            size="sm"
            variant="ghost"
            className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--surface-3)] transition-colors"
          />
          <div className="flex-1 min-w-0">
            <h2 id="work-order-panel-title" className="t-h2 text-[var(--brand-text-bright)] truncate">
              {selected ? humanizeProduct(selected.productType) : 'Work orders'}
            </h2>
            {selected && (
              <p className="t-caption-sm text-[var(--brand-text-muted)]">
                {selected.pageIds.length} page{selected.pageIds.length !== 1 ? 's' : ''} · Created {timeLabel(selected.createdAt)}
              </p>
            )}
          </div>
          {selected && (
            <span className={`t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] border ${STATUS_META[selected.status].cls}`}>
              {STATUS_META[selected.status].label}
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="px-6 py-5">
              {isLoading ? (
                <LoadingState message="Loading work orders..." />
              ) : isError ? (
                <EmptyState icon={Archive} title="Couldn't load work orders" description="Try reopening the panel." />
              ) : (orders ?? []).length === 0 ? (
                <EmptyState icon={Archive} title="No work orders" description="This workspace has no purchased fix or schema orders yet." />
              ) : (
                <div className="space-y-2">
                  {(orders ?? []).map((o) => (
                    <ClickableRow
                      key={o.id}
                      onClick={() => setSelectedId(o.id)}
                      className="flex items-center gap-3 px-4 py-3 bg-[var(--surface-2)] border border-[var(--brand-border)] hover:border-[var(--brand-border-hover)] rounded-[var(--radius-signature)]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="t-caption font-medium text-[var(--brand-text-bright)] truncate">{humanizeProduct(o.productType)}</div>
                        <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                          {o.pageIds.length} page{o.pageIds.length !== 1 ? 's' : ''} · {timeLabel(o.updatedAt)}
                        </div>
                      </div>
                      <span className={`t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] border ${STATUS_META[o.status].cls}`}>
                        {STATUS_META[o.status].label}
                      </span>
                      <ChevronRight className="w-4 h-4 text-[var(--brand-text-muted)] flex-shrink-0" />
                    </ClickableRow>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="px-6 py-5 space-y-5">
              {/* Order detail */}
              <div
                className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4"
                style={{ borderRadius: 'var(--radius-signature)' }}
              >
                <dl className="grid grid-cols-2 gap-y-2 gap-x-4 t-caption-sm">
                  <dt className="text-[var(--brand-text-muted)]">Product</dt>
                  <dd className="text-[var(--brand-text-bright)]">{humanizeProduct(selected.productType)}</dd>
                  <dt className="text-[var(--brand-text-muted)]">Pages</dt>
                  <dd className="text-[var(--brand-text-bright)]">{selected.pageIds.length}</dd>
                  <dt className="text-[var(--brand-text-muted)]">Quantity</dt>
                  <dd className="text-[var(--brand-text-bright)]">{selected.quantity}</dd>
                  {selected.assignedTo && (
                    <>
                      <dt className="text-[var(--brand-text-muted)]">Assigned to</dt>
                      <dd className="text-[var(--brand-text-bright)]">{selected.assignedTo}</dd>
                    </>
                  )}
                </dl>
                {selected.notes && (
                  <p className="t-caption text-[var(--brand-text-muted)] mt-3 border-t border-[var(--brand-border)] pt-3">{selected.notes}</p>
                )}
              </div>

              {/* Conversation */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="w-4 h-4 text-blue-400" />
                  <h3 className="t-label text-[var(--brand-text-muted)] uppercase tracking-wide">Conversation</h3>
                </div>
                {commentsLoading ? (
                  <LoadingState message="Loading conversation..." size="sm" />
                ) : (comments ?? []).length === 0 ? (
                  <p className="t-caption text-[var(--brand-text-muted)] py-2">No messages yet. Start the conversation below.</p>
                ) : (
                  <ul className="space-y-2">
                    {(comments ?? []).map((c) => (
                      <li
                        key={c.id}
                        className={`max-w-[85%] px-3 py-2 ${
                          c.author === 'team'
                            ? 'ml-auto bg-teal-500/10 border border-teal-500/30'
                            : 'mr-auto bg-[var(--surface-2)] border border-[var(--brand-border)]'
                        }`}
                        style={{ borderRadius: 'var(--radius-md)' }}
                      >
                        <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] mb-0.5">
                          {c.author === 'team' ? 'You (team)' : 'Client'} · {timeLabel(c.createdAt)}
                        </div>
                        <p className="t-caption text-[var(--brand-text-bright)] whitespace-pre-wrap">{c.content}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Reply box */}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <FormTextarea
                    value={reply}
                    onChange={setReply}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend(); }
                    }}
                    placeholder="Reply to the client…"
                    rows={2}
                    maxLength={2000}
                    aria-label="Reply to the client about this work order"
                  />
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  icon={Send}
                  loading={postComment.isPending}
                  disabled={!reply.trim() || postComment.isPending}
                  onClick={handleSend}
                >
                  Send
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions (only on a selected order) */}
        {selected && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--brand-border)] flex-shrink-0">
            {selected.status === 'in_progress' && (
              <Button
                variant="primary"
                size="sm"
                icon={CheckCircle2}
                loading={updateStatus.isPending}
                onClick={() => updateStatus.mutate({ orderId: selected.id, status: 'completed' })}
              >
                Mark complete
              </Button>
            )}
            {selected.status === 'pending' && (
              <Button
                variant="secondary"
                size="sm"
                icon={Clock}
                loading={updateStatus.isPending}
                onClick={() => updateStatus.mutate({ orderId: selected.id, status: 'in_progress' })}
              >
                Start work
              </Button>
            )}
            {selected.status === 'completed' && (
              <Button
                variant="secondary"
                size="sm"
                icon={Archive}
                loading={updateStatus.isPending}
                onClick={() => setCloseConfirm(true)}
              >
                Close out
              </Button>
            )}
            {(selected.status === 'closed' || selected.status === 'cancelled') && (
              <span className="t-caption-sm text-[var(--brand-text-muted)] inline-flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 hidden" />
                This order is {STATUS_META[selected.status].label.toLowerCase()} — no further actions.
              </span>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={closeConfirm}
        title="Close out this order?"
        message="Closing takes this fulfilled order out of the client conversation lane. This cannot be undone — a closed order cannot be reopened."
        confirmLabel="Close out"
        variant="destructive"
        onConfirm={() => {
          if (selected) updateStatus.mutate({ orderId: selected.id, status: 'closed' });
          setCloseConfirm(false);
        }}
        onCancel={() => setCloseConfirm(false)}
      />
    </div>
  );
}
