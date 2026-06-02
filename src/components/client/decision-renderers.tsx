// src/components/client/decision-renderers.tsx
//
// Shared, proven decision-substance renderers — extracted from DecisionDetailModal so BOTH the
// legacy modal AND the unified DeliverableDetailModal (R3) render the SAME code (DRY). These were
// proven in the legacy bulk-approval flow; R3 reuses them verbatim, fed from the unified
// deliverable's carried data (typed items[] for the approval family, payload.items for the
// client_action family).
//
//  - ItemDiffRow        — presentational Current/Proposed two-column row + per-item Flag/Unflag.
//                         Drives BOTH the legacy ApprovalItemRow (legacy ApprovalItem) and the
//                         unified per-item review (ClientDeliverableItem) via a minimal view-model.
//  - ApprovalItemRow    — legacy wrapper: maps a legacy ApprovalItem onto ItemDiffRow.
//  - AeoRenderer / InternalLinkRenderer / RedirectRenderer — read-only diff renderers.
import { useState } from 'react';
import { Flag, Pencil } from 'lucide-react';
import { Button, FormInput, FormTextarea, Icon } from '../ui';
import type { ApprovalItem } from '../../../shared/types/approvals';
import type {
  AeoChangePayload,
  InternalLinkPayload,
  RedirectProposalPayload,
} from '../../../shared/types/client-actions';
import { normalizeInternalLinkSuggestion } from '../../lib/internal-link-client-action';

// ── Presentational per-item diff row (the shared per-item flag UX) ──────────

export interface ItemDiffRowProps {
  /** Header label, e.g. "Homepage" (pageTitle ?? pageSlug). */
  label: string;
  /** The target field, e.g. "seoTitle". Appended to the header after an em-dash. */
  field: string | null;
  currentValue: string | null;
  proposedValue: string | null;
  flagged: boolean;
  onFlag: (note: string) => void;
  onUnflag: () => void;
  /**
   * R3b — when true (the publish/"Apply to Website" review), the per-item Flag/Unflag affordance is
   * hidden: this is a read-only review-before-publish view (approve is unreachable in publish mode,
   * so the flag controls would be inert). The Current/Proposed diff still renders.
   */
  readOnly?: boolean;
  /**
   * ISSUE 1b — when true, the Current/Proposed values get a "Show full ↓ / Show less ↑" toggle that
   * swaps the default `line-clamp-2` clamp for a scrollable monospace block (overflow-y-auto,
   * max-h-[200px], font-mono — mirrors the legacy ApprovalBatchCard schema preview). Used by
   * InlineApprovalCard ONLY for `field === 'schema'` items (long JSON-LD). Defaults to `false`,
   * which preserves the EXACT current `line-clamp-2` rendering for the existing modal caller — a
   * no-regression invariant.
   */
  expandable?: boolean;
  /**
   * Item 2 — EDIT-before-approve. When provided, the Proposed cell gains an "Edit" affordance that
   * turns the proposed value into an editable input seeded with the current proposed value; on
   * "Save edit" the new value is reported via `onEdit(value)` and the row shows the edited value.
   * The caller (InlineApprovalCard / DeliverableDetailModal) gates this to `seoTitle` /
   * `seoDescription` ONLY (never `schema` — legacy hid Edit for schema) and behind the non-free tier.
   * `editedValue` is the currently-edited value (undefined → not edited → shows `proposedValue`).
   * OPTIONAL: callers that pass neither prop see the EXACT prior read-only rendering (no-regression).
   */
  onEdit?: (value: string) => void;
  editedValue?: string;
}

/**
 * The single presentational per-item diff row. Renders `label — field`, the Current/Proposed
 * two-column grid, and the per-item Flag/Unflag affordance. Carries no domain types so it can be
 * driven by both a legacy ApprovalItem (via ApprovalItemRow) and a unified ClientDeliverableItem
 * (via DeliverableDetailModal).
 */
export function ItemDiffRow({
  label,
  field,
  currentValue,
  proposedValue,
  flagged,
  onFlag,
  onUnflag,
  readOnly = false,
  expandable = false,
  onEdit,
  editedValue,
}: ItemDiffRowProps) {
  const [flagging, setFlagging] = useState(false);
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState(false);
  // Item 2 — inline edit state for the Proposed value. `editing` toggles the input; `draft` holds the
  // in-progress text seeded from the current edited/proposed value.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // ISSUE 1b — when `expandable` and the value is expanded, swap the 2-line clamp for a scrollable
  // monospace block (matches legacy ApprovalBatchCard schema preview: 200px, font-mono). When not
  // expandable (the existing modal caller) this resolves to the unchanged `line-clamp-2`.
  const valueClass =
    expandable && expanded
      ? 't-caption text-[var(--brand-text)] overflow-y-auto max-h-[200px] font-mono whitespace-pre-wrap'
      : 't-caption text-[var(--brand-text)] line-clamp-2';

  // Item 2 — editing is offered only when the caller wires `onEdit` (gated to seoTitle/seoDescription
  // + non-free tier by the caller) and the row is not in read-only (publish) mode.
  const canEdit = !!onEdit && !readOnly;
  // The value shown in the Proposed cell: the client's edited value if present, else the original.
  const effectiveProposed = editedValue ?? proposedValue;
  const isEdited = editedValue != null && editedValue !== proposedValue;
  // seoDescription is multi-line; seoTitle is a single line — use a textarea for descriptions.
  const isLongField = field === 'seoDescription';

  const beginEdit = () => {
    setDraft(effectiveProposed ?? '');
    setEditing(true);
  };
  const saveEdit = () => {
    onEdit?.(draft);
    setEditing(false);
  };

  return (
    <div
      className={`py-3 border-b border-[var(--brand-border)] last:border-b-0 ${
        flagged ? 'border-l-2 border-l-amber-500/60 pl-3 -ml-3' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-0.5">
            {label}
            {field ? ` — ${field}` : ''}
          </p>
          {/* Mobile diff — stack Current/Proposed on phones (item 5 cheap polish, pairs with the
              responsive modal). grid-cols-1 sm:grid-cols-2. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
            <div>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Current</p>
              <p className={valueClass}>
                {currentValue || '—'}
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <p className="t-caption-sm text-accent-brand">Proposed</p>
                {isEdited && !editing && (
                  <span className="t-caption-sm text-accent-info">· edited</span>
                )}
                {canEdit && !editing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={beginEdit}
                    className="ml-auto flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-accent-brand transition-colors px-1 py-0"
                  >
                    <Icon as={Pencil} size="xs" />
                    Edit
                  </Button>
                )}
              </div>
              {canEdit && editing ? (
                <div className="space-y-1.5">
                  {isLongField ? (
                    <FormTextarea
                      value={draft}
                      onChange={setDraft}
                      rows={3}
                      maxLength={5000}
                      autoFocus
                      aria-label={`Edit proposed ${field}`}
                    />
                  ) : (
                    <FormInput
                      type="text"
                      value={draft}
                      onChange={setDraft}
                      maxLength={5000}
                      autoFocus
                      aria-label={`Edit proposed ${field}`}
                      className="t-caption"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={saveEdit}
                      className="t-caption-sm font-medium text-accent-brand px-2 py-1 hover:bg-teal-500/10 rounded-[var(--radius-md)] transition-colors"
                    >
                      Save edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setEditing(false); setDraft(''); }}
                      className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors px-1"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className={valueClass}>
                  {effectiveProposed || '—'}
                </p>
              )}
            </div>
          </div>
          {expandable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 t-caption-sm text-accent-brand hover:text-[var(--brand-text)] transition-colors px-0"
            >
              {expanded ? 'Show less ↑' : 'Show full ↓'}
            </Button>
          )}
        </div>
        <div className="flex-shrink-0">
          {readOnly ? null : flagged ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onUnflag}
              className="t-caption-sm text-accent-warning hover:text-[var(--brand-text)] transition-colors px-2 py-1"
            >
              Unflag
            </Button>
          ) : !flagging ? (
            <Button
              variant="ghost"
              size="sm"
              // aria-pressed conveys the flagged state to screen readers (item 5 cheap polish).
              aria-pressed={flagged}
              onClick={() => setFlagging(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] t-caption-sm text-[var(--brand-text-muted)] hover:text-accent-warning hover:bg-amber-500/10 transition-colors border border-transparent hover:border-amber-500/20"
            >
              <Icon as={Flag} size="sm" />
              Flag
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <FormInput
                type="text"
                value={note}
                onChange={setNote}
                placeholder="What's your concern? (optional)"
                className="t-caption placeholder:text-[var(--brand-text-muted)] outline-none w-48"
                autoFocus
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onFlag(note.trim());
                  setFlagging(false);
                  setNote('');
                }}
                className="t-caption-sm font-medium text-accent-warning px-2 py-1 hover:bg-amber-500/10 rounded-[var(--radius-md)] transition-colors"
              >
                Flag it
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFlagging(false);
                  setNote('');
                }}
                className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors px-1"
              >
                ✕
              </Button>
            </div>
          )}
        </div>
      </div>
      {flagged && (
        <p className="t-caption-sm text-accent-warning mt-1 flex items-center gap-1">
          <Icon as={Flag} size="sm" /> Flagged — your team will hold this change for review.
        </p>
      )}
    </div>
  );
}

// ── Legacy approval batch item row (maps ApprovalItem → ItemDiffRow) ────────

export function ApprovalItemRow({
  item,
  flagged,
  onFlag,
  onUnflag,
}: {
  item: ApprovalItem;
  flagged: boolean;
  onFlag: (note: string) => void;
  onUnflag: () => void;
}) {
  return (
    <ItemDiffRow
      label={item.pageTitle || item.pageSlug}
      field={item.field}
      currentValue={item.currentValue}
      proposedValue={item.proposedValue}
      flagged={flagged}
      onFlag={onFlag}
      onUnflag={onUnflag}
    />
  );
}

// ── Client action payload renderers (read-only diff renderers) ──────────────

export function AeoRenderer({ payload }: { payload: AeoChangePayload }) {
  const diffs = payload.diffs ?? [];
  if (diffs.length === 0) {
    return (
      <p className="t-body text-[var(--brand-text-muted)]">No changes in this batch.</p>
    );
  }
  return (
    <div className="space-y-4">
      {diffs.map((d, i) => (
        <div key={i} className="space-y-1">
          <p className="t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">
            {d.page}
            {d.section ? ` — ${d.section}` : ''}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Current</p>
              <p className="t-caption text-[var(--brand-text)] bg-[var(--surface-3)] p-2 rounded-[var(--radius-md)]">
                {d.current}
              </p>
            </div>
            <div>
              <p className="t-caption-sm text-accent-brand mb-0.5">Proposed</p>
              <p className="t-caption text-[var(--brand-text)] bg-teal-500/5 border border-teal-500/20 p-2 rounded-[var(--radius-md)]">
                {d.proposed}
              </p>
            </div>
          </div>
          {d.rationale && (
            <p className="t-caption-sm text-[var(--brand-text-muted)] italic">
              Why: {d.rationale}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function InternalLinkRenderer({ payload }: { payload: InternalLinkPayload }) {
  const suggestions = payload.suggestions ?? [];
  const normalizedSuggestions = suggestions.map(normalizeInternalLinkSuggestion);
  if (suggestions.length === 0) {
    return (
      <p className="t-body text-[var(--brand-text-muted)]">No link suggestions.</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[var(--brand-border)]">
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">
              Anchor text
            </th>
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">
              Target title
            </th>
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">
              Target URL
            </th>
            <th className="py-2 pr-4 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">
              Source title
            </th>
            <th className="py-2 t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">
              Source URL
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--brand-border)]">
          {normalizedSuggestions.map((s, i) => (
            <tr key={i}>
              <td className="py-3 pr-4 t-ui font-medium text-[var(--brand-text-bright)] align-top">
                {s.anchorText}
              </td>
              <td className="py-3 pr-4 t-caption text-[var(--brand-text-bright)] align-top">
                {s.targetTitle || '—'}
              </td>
              <td className="py-3 pr-4 align-top">
                <span className="t-caption text-accent-brand">
                  {s.targetUrl}
                </span>
              </td>
              <td className="py-3 pr-4 t-caption text-[var(--brand-text-muted)] align-top">
                {s.sourcePageTitle || '—'}
              </td>
              <td className="py-3 t-caption text-[var(--brand-text-muted)] align-top">
                {s.sourcePageUrl || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RedirectRenderer({ payload }: { payload: RedirectProposalPayload }) {
  const redirects = payload.redirects ?? [];
  if (redirects.length === 0) {
    return <p className="t-body text-[var(--brand-text-muted)]">No redirects.</p>;
  }
  return (
    <div className="space-y-3">
      {redirects.map((r, i) => (
        <div
          key={i}
          className="flex items-start gap-3 py-2 border-b border-[var(--brand-border)] last:border-b-0"
        >
          <p className="t-caption text-[var(--brand-text)] flex-1 min-w-0 break-all">
            {r.source}
          </p>
          <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">→</span>
          <p className="t-caption text-accent-brand flex-1 min-w-0 break-all">{r.target}</p>
        </div>
      ))}
    </div>
  );
}
