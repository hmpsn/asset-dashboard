// src/components/client/inbox/InlineApprovalCard.tsx
//
// ISSUE 1 — Inline approval-review card, mounted from UnifiedInbox. SEO/approval-family
// deliverables (typed items[]) previously hid their
// current→proposed substance behind the full-screen DeliverableDetailModal ("View N →"). This card
// renders that substance INLINE so the client can quick-approve in place — no modal.
//
// Contract mirrors the modal's proven shape (NormalizedDecision + per-item Flag/Hold → FlaggedItem[]
// subset-approve, already end-to-end). Substance is rendered via the SAME presentational ItemDiffRow
// from decision-renderers.tsx, grouped by page like the legacy ApprovalBatchCard. The card NEVER
// opens the modal (no onOpen/View) — the substance is fully inline.
import { useState, useCallback } from 'react';
import { Button, FormInput } from '../../ui';
import { ItemDiffRow } from '../decision-renderers';
import { approveCtaLabel, humanizeFieldLabel } from '../../../lib/decision-adapters';
import type { NormalizedDecision, FlaggedItem } from '../../../../shared/types/decision';
import type { ClientDeliverableItem } from '../../../../shared/types/client-deliverable';

/** Item 2 — a per-item edited proposed value (seoTitle/seoDescription) forwarded on approve. */
export interface EditedItem {
  itemId: string;
  value: string;
}

interface InlineApprovalCardProps {
  decision: NormalizedDecision; // normalizeDeliverable(d) — carries items/payload/badge/sentAt
  ageLabel: string | null;
  submitting: boolean;
  /**
   * Approve. `flaggedItems` carries the per-item held subset; `editedItems` (item 2) carries the
   * per-item edited proposed values (seoTitle/seoDescription). A client can edit AND approve.
   */
  onApprove: (flaggedItems: FlaggedItem[], editedItems: EditedItem[]) => void;
  onRequestChanges: (note: string) => void;
  onDecline: (note: string) => void;
  /**
   * Item 2 — when true (non-free tier), seoTitle/seoDescription rows show the inline "Edit" editor.
   * Free tier never sees the editor (legacy free-tier gate parity). Defaults to false.
   */
  editable?: boolean;
}

/**
 * Item 2 — the ONLY fields that are client-editable before approve (seoTitle / seoDescription).
 * NEVER `schema` — the legacy ApprovalsTab hid Edit for schema (long JSON-LD is not hand-edited).
 */
const EDITABLE_FIELDS = new Set(['seoTitle', 'seoDescription']);

/** Pull the human page label off an item's itemPayload (pageTitle ?? pageSlug ?? targetRef). */
function itemPageLabel(item: ClientDeliverableItem): string {
  const payload = item.itemPayload as { pageTitle?: unknown; pageSlug?: unknown } | null;
  const title = typeof payload?.pageTitle === 'string' ? payload.pageTitle : '';
  const slug = typeof payload?.pageSlug === 'string' ? payload.pageSlug : '';
  return title || slug || item.targetRef || 'Item';
}

/** Group key for the per-page sub-header: pageSlug ?? targetRef ?? pageTitle. */
function itemGroupKey(item: ClientDeliverableItem): string {
  const payload = item.itemPayload as { pageSlug?: unknown; pageTitle?: unknown } | null;
  const slug = typeof payload?.pageSlug === 'string' ? payload.pageSlug : '';
  const title = typeof payload?.pageTitle === 'string' ? payload.pageTitle : '';
  return slug || item.targetRef || title || 'Item';
}

export function InlineApprovalCard({
  decision,
  ageLabel,
  submitting,
  onApprove,
  onRequestChanges,
  onDecline,
  editable = false,
}: InlineApprovalCardProps) {
  // Per-item flag/hold map (itemId → note) — mirrors DeliverableDetailModal's proven pattern. On
  // Approve we emit the held items as FlaggedItem[]; the unflagged items are implemented.
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

  const items = decision.items ?? [];
  const totalItems = decision.itemCount;
  const flaggedCount = flaggedItems.size;

  const handleApprove = () => {
    const flaggedList: FlaggedItem[] = Array.from(flaggedItems.entries()).map(([itemId, n]) => ({
      itemId,
      note: n,
    }));
    const editedList: EditedItem[] = Array.from(editedItems.entries()).map(([itemId, value]) => ({
      itemId,
      value,
    }));
    onApprove(flaggedList, editedList);
  };

  // Group items by page (single page → suppress the group sub-header, like ApprovalBatchCard).
  const grouped = new Map<string, ClientDeliverableItem[]>();
  for (const item of items) {
    const key = itemGroupKey(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }
  const isMultiPage = grouped.size > 1;

  // Item 5 — canonical approve CTA shared across the unified inbox.
  const ctaLabel = approveCtaLabel(totalItems, flaggedCount, submitting);

  return (
    // pr-check-disable-next-line -- brand signature radius intentional; mirrors DecisionCard visual identity for inline approval cards
    <div
      className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden p-4"
      style={{ borderRadius: 'var(--radius-signature-lg)' }}
    >
      {/* Header: badge + age (no "High priority" — normalizeDeliverable hardcodes priority undefined). */}
      <div className="flex items-center gap-2 mb-1">
        <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)]">
          {decision.badge}
        </span>
        {ageLabel && (
          <span className="t-caption-sm text-[var(--brand-text-muted)] ml-auto">{ageLabel}</span>
        )}
      </div>

      {/* Title + summary */}
      <h4 className="t-body font-semibold text-[var(--brand-text-bright)]">{decision.title}</h4>
      {decision.summary && (
        <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{decision.summary}</p>
      )}

      {/* Inline substance — per-item diff rows, grouped by page. */}
      <div className="mt-3">
        {Array.from(grouped.entries()).map(([key, pageItems]) => (
          <div key={key}>
            {isMultiPage && (
              <p className="t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mt-3 mb-1">
                {itemPageLabel(pageItems[0])}
              </p>
            )}
            {pageItems.map((item) => (
              <ItemDiffRow
                key={item.id}
                // FIX 4 — in multi-page grouped mode the per-page group sub-header (above) already
                // shows the page title, so showing it again here would duplicate the page name on
                // every row. Pass a field-only label (the field as the label, no `field` suffix) so
                // the row reads just "seoTitle" under its page-group header. Single-page mode keeps
                // the combined "Page — field" label (no group header to de-duplicate against).
                label={isMultiPage ? (humanizeFieldLabel(item.field) ?? 'Item') : itemPageLabel(item)}
                field={isMultiPage ? null : item.field}
                currentValue={item.currentValue}
                proposedValue={item.proposedValue}
                flagged={flaggedItems.has(item.id)}
                onFlag={(n) => flagItem(item.id, n)}
                onUnflag={() => unflagItem(item.id)}
                // Long JSON-LD schema values get a Show full/less toggle; everything else keeps the
                // existing 2-line clamp (no-regression invariant for non-schema fields).
                expandable={item.field === 'schema'}
                // Item 2 — inline edit for seoTitle/seoDescription only, behind the non-free tier.
                onEdit={
                  editable && item.field && EDITABLE_FIELDS.has(item.field)
                    ? (value) => editItem(item.id, value)
                    : undefined
                }
                editedValue={editedItems.get(item.id)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Footer actions: Approve / Request changes (+note) / Decline (+note). */}
      <div className="mt-3">
        {noteMode === 'none' ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="primary" disabled={submitting} onClick={handleApprove}>
              {ctaLabel}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={submitting}
              onClick={() => { setNoteMode('changes'); setNote(''); }}
            >
              Request changes
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={submitting}
              onClick={() => { setNoteMode('decline'); setNote(''); }}
            >
              Decline
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            <FormInput
              type="text"
              value={note}
              onChange={setNote}
              placeholder={noteMode === 'decline' ? 'Why are you declining? (optional)' : 'Add a note for your team…'}
              className="flex-1 t-caption placeholder:text-[var(--brand-text-muted)] outline-none"
            />
            <Button
              size="sm"
              variant="primary"
              disabled={submitting}
              onClick={() => {
                const trimmed = note.trim();
                if (noteMode === 'decline') onDecline(trimmed);
                else onRequestChanges(trimmed);
                setNoteMode('none');
                setNote('');
              }}
            >
              Send
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={submitting}
              onClick={() => { setNoteMode('none'); setNote(''); }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
