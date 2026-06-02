// src/components/client/DeliverableDetailModal.tsx
//
// R3a — the unified deliverable detail + per-item review surface (DARK, only reachable behind the
// `unified-inbox` flag). Renders the SUBSTANCE of a batch-kind deliverable (the current→proposed
// diffs, the redirect/internal-link/AEO sub-items) by REUSING the proven renderers in
// decision-renderers.tsx, fed from the unified deliverable's carried data:
//
//   - APPROVAL FAMILY (seo_edit / audit_issue / schema_item / content_plan_*) → typed `items[]`
//     rows, each rendered as an ItemDiffRow with PER-ITEM Flag/Unflag. The approve CTA carries the
//     flagged ClientDeliverableItem.id`s ("implement N of M") to the /respond endpoint.
//   - CLIENT_ACTION FAMILY (redirect / internal_link / aeo_change) → sub-items in `payload.items`,
//     rendered read-only by the corresponding renderer wrapper (whole-action approve only — these
//     have NO typed items, matching the legacy: only the approval family had per-item flag).
//
// Visual template: the legacy DecisionDetailModal full-screen chrome (header/badge/body/footer,
// Escape-to-close, "Looks good — implement N of M"). One respond path: the parent wires the approve
// to useRespondToDeliverable → PATCH /respond, forwarding the flagged item ids.
import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { Button, FormTextarea, IconButton } from '../ui';
import type { NormalizedDecision, FlaggedItem } from '../../../shared/types/decision';
import type { ClientDeliverableItem } from '../../../shared/types/client-deliverable';
import type {
  AeoChangePayload,
  InternalLinkPayload,
  RedirectProposalPayload,
} from '../../../shared/types/client-actions';
import { ItemDiffRow, AeoRenderer, InternalLinkRenderer, RedirectRenderer } from './decision-renderers';

interface DeliverableDetailModalProps {
  decision: NormalizedDecision;
  /**
   * Approve handler. For the approval family, `flaggedItems` carries the per-item flags (the
   * unflagged items are approved, the flagged ones held). For the client_action family it is always
   * empty (whole-action approve — no typed items). The parent forwards the ids to /respond.
   */
  onApprove: (flaggedItems: FlaggedItem[]) => Promise<void> | void;
  /** Request changes on the WHOLE deliverable (with an optional note). */
  onRequestChanges: (note: string) => Promise<void> | void;
  /** Decline the WHOLE deliverable (with an optional note). */
  onDecline: (note: string) => Promise<void> | void;
  onDismiss: () => void;
  submitting?: boolean;
  /**
   * R3b — Apply to Website (DARK). When `canApply` is true and `onApply` is provided (an already-
   * approved, client-applyable deliverable), the footer renders a SINGLE full-width "Apply to
   * Website" primary button INSTEAD of the approve/request/decline row (apply is a separate step
   * after approve, not alongside it). When `canApply` is false the normal footer renders unchanged.
   */
  onApply?: () => Promise<void> | void;
  applying?: boolean;
  canApply?: boolean;
}

/** The approval_batch-family deliverable types whose typed items[] drive the per-item flag UX. */
const APPROVAL_FAMILY_TYPES = new Set([
  'seo_edit',
  'audit_issue',
  'schema_item',
  'schema_plan',
  'content_plan_sample',
  'content_plan_template',
]);

/** Pull the human page label off a deliverable item's itemPayload (pageTitle ?? pageSlug). */
function itemLabel(item: ClientDeliverableItem): string {
  const payload = item.itemPayload as { pageTitle?: unknown; pageSlug?: unknown } | null;
  const title = typeof payload?.pageTitle === 'string' ? payload.pageTitle : '';
  const slug = typeof payload?.pageSlug === 'string' ? payload.pageSlug : '';
  return title || slug || item.targetRef || 'Item';
}

/**
 * Map a NormalizedDecision badge/type back to which renderer family to use. R3 keys on the
 * deliverable's carried `items` (approval family → typed rows) vs `payload.items` (client_action
 * family → sub-items). We detect the client_action family by the presence of `payload.subType`
 * (set by buildClientActionPayload) OR `payload.items` array; everything with typed items[] is the
 * approval family.
 */
function payloadSubType(decision: NormalizedDecision): string | null {
  const sub = (decision.payload as { subType?: unknown } | undefined)?.subType;
  return typeof sub === 'string' ? sub : null;
}

export function DeliverableDetailModal({
  decision,
  onApprove,
  onRequestChanges,
  onDecline,
  onDismiss,
  submitting = false,
  onApply,
  applying = false,
  canApply = false,
}: DeliverableDetailModalProps) {
  const [flaggedItems, setFlaggedItems] = useState<Map<string, string>>(new Map());
  const [noteMode, setNoteMode] = useState<'none' | 'changes' | 'decline'>('none');
  const [note, setNote] = useState('');

  const flagItem = useCallback((id: string, n: string) => {
    setFlaggedItems((prev) => new Map(prev).set(id, n));
  }, []);
  const unflagItem = useCallback((id: string) => {
    setFlaggedItems((prev) => {
      const m = new Map(prev);
      m.delete(id);
      return m;
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      )
        return;
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handler); // keydown-ok — isContentEditable guard is in the handler body above
    return () => document.removeEventListener('keydown', handler);
  }, [onDismiss]);

  const isApprovalFamily = APPROVAL_FAMILY_TYPES.has(
    payloadSubType(decision) ?? '',
  ) || (decision.items != null && decision.items.length > 0);

  const items = decision.items ?? [];
  const totalItems = decision.itemCount;
  const flaggedCount = flaggedItems.size;
  const unflaggedCount = Math.max(totalItems - flaggedCount, 0);

  const handleApprove = async () => {
    const flaggedList: FlaggedItem[] = Array.from(flaggedItems.entries()).map(
      ([itemId, n]) => ({ itemId, note: n }),
    );
    await onApprove(flaggedList);
  };

  // ── Body: per-item review (approval family) or read-only diffs (client_action family) ──
  let body: React.ReactNode;
  const subType = payloadSubType(decision);
  const payloadItems = (decision.payload as { items?: unknown } | undefined)?.items;

  if (isApprovalFamily && items.length > 0) {
    body = (
      <div>
        {items.map((item) => (
          <ItemDiffRow
            key={item.id}
            label={itemLabel(item)}
            field={item.field}
            currentValue={item.currentValue}
            proposedValue={item.proposedValue}
            flagged={flaggedItems.has(item.id)}
            onFlag={(n) => flagItem(item.id, n)}
            onUnflag={() => unflagItem(item.id)}
            // R3b — in publish mode (canApply) the per-item Flag controls are inert (approve is
            // unreachable), so render this as a read-only review-before-publish view.
            readOnly={canApply}
          />
        ))}
      </div>
    );
  } else if (subType === 'aeo_change' || decision.badge === 'AEO') {
    body = <AeoRenderer payload={{ diffs: (payloadItems as AeoChangePayload['diffs']) ?? [] }} />;
  } else if (subType === 'internal_link' || decision.badge === 'Internal Links') {
    body = (
      <InternalLinkRenderer
        payload={{ suggestions: (payloadItems as InternalLinkPayload['suggestions']) ?? [] }}
      />
    );
  } else if (subType === 'redirect' || decision.badge === 'Redirects') {
    body = (
      <RedirectRenderer
        payload={{ redirects: (payloadItems as RedirectProposalPayload['redirects']) ?? [] }}
      />
    );
  } else {
    body = (
      <p className="t-body text-[var(--brand-text-muted)]">
        {decision.summary || 'No reviewable detail for this item.'}
      </p>
    );
  }

  const ctaLabel = submitting
    ? 'Submitting…'
    : isApprovalFamily && flaggedCount > 0
      ? `Looks good — implement ${unflaggedCount} of ${totalItems} →`
      : isApprovalFamily
        ? `Looks good — implement ${totalItems} →`
        : 'Approve →';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="deliverable-modal-title"
      className="fixed inset-0 z-[var(--z-modal-fullscreen)] flex flex-col" // fixed-inset-ok — full-screen trust-first panel; escape key + backdrop click handled in component body
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onDismiss} />
      <div
        className="relative z-[var(--z-sticky)] flex flex-col h-full max-w-3xl mx-auto w-full bg-[var(--surface-1)] shadow-2xl overflow-hidden"
        style={{ borderRadius: `0 0 var(--radius-xl) var(--radius-xl)` }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--brand-border)] flex-shrink-0">
          <IconButton
            autoFocus
            onClick={onDismiss}
            icon={X}
            label="Close"
            size="sm"
            variant="ghost"
            className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--surface-3)] transition-colors"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)]">
                {decision.badge}
              </span>
              {decision.priority === 'high' && (
                <span className="t-caption-sm font-medium text-accent-warning">High priority</span>
              )}
            </div>
            <h2 id="deliverable-modal-title" className="t-h2 text-[var(--brand-text-bright)] truncate">
              {decision.title}
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">{body}</div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-[var(--brand-border)] bg-[var(--surface-2)] space-y-2">
          {canApply && onApply ? (
            /* R3b — Apply to Website: a single full-width primary button. Apply is a SEPARATE step
               after approve, so this replaces (not augments) the approve/request/decline row. */
            <Button
              variant="primary"
              className="w-full"
              disabled={applying}
              onClick={() => void onApply()}
            >
              {applying ? 'Applying…' : 'Apply to Website'}
            </Button>
          ) : noteMode === 'none' ? (
            <>
              <Button variant="primary" className="w-full" disabled={submitting} onClick={handleApprove}>
                {ctaLabel}
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => { setNoteMode('changes'); setNote(''); }}
                  className="flex-1 t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors py-1"
                >
                  Request changes
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => { setNoteMode('decline'); setNote(''); }}
                  className="flex-1 t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors py-1"
                >
                  Decline
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <FormTextarea
                value={note}
                onChange={setNote}
                placeholder={
                  noteMode === 'decline'
                    ? 'Why are you declining? (optional)'
                    : 'What would you like changed? (optional)'
                }
                rows={3}
                autoFocus
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  className="flex-1"
                  disabled={submitting}
                  onClick={async () => {
                    if (noteMode === 'decline') await onDecline(note.trim());
                    else await onRequestChanges(note.trim());
                  }}
                >
                  {noteMode === 'decline' ? 'Send decline' : 'Send feedback'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => { setNoteMode('none'); setNote(''); }}
                  className="t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors px-3"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
