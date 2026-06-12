// src/components/client/DeliverableDetailModal.tsx
//
// R3a — the unified deliverable detail + per-item review surface. Renders the substance of a
// batch-kind deliverable (the current→proposed
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
import type { PageRoleAssignment, CanonicalEntity, SchemaPageRole } from '../../../shared/types/schema-plan';
import { SCHEMA_ROLE_LABELS } from '../../../shared/types/schema-plan';
import { ItemDiffRow, AeoRenderer, InternalLinkRenderer, RedirectRenderer } from './decision-renderers';
import { approveCtaLabel } from '../../lib/decision-adapters';

/** Item 2 — a per-item edited proposed value (seoTitle/seoDescription) forwarded on approve. */
export interface EditedItem {
  itemId: string;
  value: string;
}

interface DeliverableDetailModalProps {
  decision: NormalizedDecision;
  /**
   * Approve handler. For the approval family, `flaggedItems` carries the per-item flags (the
   * unflagged items are approved, the flagged ones held) and `editedItems` (item 2) carries the
   * per-item edited proposed values. For the client_action family both are always empty (whole-action
   * approve — no typed items). The parent forwards them to /respond.
   */
  onApprove: (flaggedItems: FlaggedItem[], editedItems: EditedItem[]) => Promise<void> | void;
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
  /**
   * Item 2 — when true (non-free tier), seoTitle/seoDescription rows show the inline "Edit" editor.
   * Free tier never sees the editor (legacy free-tier gate parity). Defaults to false.
   */
  editable?: boolean;
}

/**
 * Item 2 — the ONLY fields that are client-editable before approve (seoTitle / seoDescription).
 * NEVER `schema` (legacy ApprovalsTab hid Edit for schema — long JSON-LD is not hand-edited).
 */
const EDITABLE_FIELDS = new Set(['seoTitle', 'seoDescription']);

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
 * A1b — read-only schema_plan substance renderer. `schema_plan` (kind:'review') carries NO typed
 * items; its substance lives in `payload.pageRoles` (PageRoleAssignment[]) + `payload.canonicalEntities`
 * (CanonicalEntity[]). Without this branch the modal fell through to the summary-only else and the
 * client approved a whole-site schema strategy reviewed blind. This mirrors the legacy
 * SchemaReviewTab presentation (page-roles list grouped by role + canonical entity chips), rendered
 * read-only — the existing Approve/Request/Decline footer drives the response. The unified inbox is
 * the only mount for this modal (R3a), so this branch is additive and never reached by legacy.
 */
function SchemaPlanReview({
  pageRoles,
  canonicalEntities,
}: {
  pageRoles: PageRoleAssignment[];
  canonicalEntities: CanonicalEntity[];
}) {
  if (pageRoles.length === 0 && canonicalEntities.length === 0) {
    return (
      <p className="t-body text-[var(--brand-text-muted)]">No schema strategy detail to review.</p>
    );
  }
  return (
    <div className="space-y-5">
      {pageRoles.length > 0 && (
        <div className="space-y-2">
          <p className="t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">
            Page roles ({pageRoles.length})
          </p>
          <div className="divide-y divide-[var(--brand-border)]/50">
            {pageRoles.map((pr) => (
              <div key={pr.pagePath} className="flex items-center gap-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="t-caption text-[var(--brand-text-bright)] truncate">{pr.pageTitle}</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{pr.pagePath}</div>
                </div>
                <span className="t-caption-sm text-[var(--brand-text-muted)] shrink-0">
                  {SCHEMA_ROLE_LABELS[pr.role as SchemaPageRole] ?? pr.role}
                </span>
                <span className="t-caption-sm text-accent-brand font-mono shrink-0">{pr.primaryType}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {canonicalEntities.length > 0 && (
        <div className="space-y-2">
          <p className="t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">
            Site entities ({canonicalEntities.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {canonicalEntities.map((entity, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-lg)] t-caption-sm bg-[var(--surface-3)]/50 border border-[var(--brand-border-strong)]"
              >
                <span className="text-accent-brand font-mono">{entity.type}</span>
                <span className="text-[var(--brand-text)]">{entity.name}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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
  editable = false,
}: DeliverableDetailModalProps) {
  const [flaggedItems, setFlaggedItems] = useState<Map<string, string>>(new Map());
  // Item 2 — per-item edited proposed value (itemId → edited value). Orthogonal to flags.
  const [editedItems, setEditedItems] = useState<Map<string, string>>(new Map());
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
  const editItem = useCallback((id: string, value: string) => {
    setEditedItems((prev) => new Map(prev).set(id, value));
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

  const handleApprove = async () => {
    const flaggedList: FlaggedItem[] = Array.from(flaggedItems.entries()).map(
      ([itemId, n]) => ({ itemId, note: n }),
    );
    const editedList: EditedItem[] = Array.from(editedItems.entries()).map(
      ([itemId, value]) => ({ itemId, value }),
    );
    await onApprove(flaggedList, editedList);
  };

  // ── Body: per-item review (approval family) or read-only diffs (client_action family) ──
  let body: React.ReactNode;
  const subType = payloadSubType(decision);
  const payloadItems = (decision.payload as { items?: unknown } | undefined)?.items;
  // A1b — schema_plan substance rides in payload.pageRoles + payload.canonicalEntities (no typed items).
  const schemaPlanPayload = decision.payload as
    | { pageRoles?: unknown; canonicalEntities?: unknown }
    | undefined;
  const schemaPlanPageRoles = Array.isArray(schemaPlanPayload?.pageRoles)
    ? (schemaPlanPayload!.pageRoles as PageRoleAssignment[])
    : [];
  const schemaPlanEntities = Array.isArray(schemaPlanPayload?.canonicalEntities)
    ? (schemaPlanPayload!.canonicalEntities as CanonicalEntity[])
    : [];

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
            // Item 2 — inline edit for seoTitle/seoDescription only, behind the non-free tier (and
            // never in publish mode — ItemDiffRow already suppresses the editor when readOnly).
            onEdit={
              editable && item.field && EDITABLE_FIELDS.has(item.field)
                ? (value) => editItem(item.id, value)
                : undefined
            }
            editedValue={editedItems.get(item.id)}
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
  } else if (schemaPlanPageRoles.length > 0 || schemaPlanEntities.length > 0) {
    // A1b — schema_plan (kind:'review', no typed items): render its pageRoles + canonicalEntities
    // read-only so the whole-site schema strategy is reviewable, not blind.
    body = <SchemaPlanReview pageRoles={schemaPlanPageRoles} canonicalEntities={schemaPlanEntities} />;
  } else {
    body = (
      <p className="t-body text-[var(--brand-text-muted)]">
        {decision.summary || 'No reviewable detail for this item.'}
      </p>
    );
  }

  // Item 5 — canonical approve CTA shared across the unified inbox. The approval family carries the
  // held subset (flaggedCount); the client_action family has no typed items to hold, so heldCount is 0.
  const ctaLabel = approveCtaLabel(totalItems, isApprovalFamily ? flaggedCount : 0, submitting);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="deliverable-modal-title"
      className="fixed inset-0 z-[var(--z-modal-fullscreen)] flex items-center justify-center p-4" // fixed-inset-ok — centered review dialog; escape key + backdrop click handled in component body
    >
      <div className="absolute inset-0 bg-[var(--brand-overlay)] backdrop-blur-sm" onClick={onDismiss} />
      <div
        className="relative z-[var(--z-sticky)] flex flex-col w-[90vw] sm:w-[75vw] max-w-[1200px] max-h-[90vh] bg-[var(--surface-1)] shadow-2xl overflow-hidden rounded-[var(--radius-xl)]"
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
