import { useState } from 'react';
import { Button, FormInput } from '../ui';
import { approveCtaLabel } from '../../lib/decision-adapters';
import type { NormalizedDecision } from '../../../shared/types/decision';

interface DecisionCardProps {
  decision: NormalizedDecision;
  /** Called when the user clicks the bulk "Review N changes →" CTA. */
  onOpen: () => void;
  /** Single-action / uniform mode: called when the user clicks "Approve". */
  onApprove?: () => void;
  /** Single-action / uniform mode: called with the note when user submits "Request changes". */
  onFlagWithNote?: (note: string) => void;
  /**
   * Uniform mode (PR-2a unified inbox): called when the user declines, with an optional note.
   * When present, a third "Decline" verb is rendered alongside Approve / Request changes.
   */
  onDecline?: (note: string) => void;
  /**
   * Uniform mode (PR-2a unified inbox): render Approve / Request changes / Decline inline for
   * EVERY card (not just single-action), and show the send age. Defaults to false so the legacy
   * single-action vs bulk-modal behavior is unchanged when this prop is absent.
   */
  uniformVerbs?: boolean;
  /** Human send-age label (e.g. "Sent 3 days ago"), shown in uniform mode when provided. */
  ageLabel?: string | null;
  /**
   * Uniform mode: a respond mutation for THIS card is in flight. Disables the verb
   * buttons and swaps the approve CTA to the in-flight label (approveCtaLabel), so the
   * card never shows enabled-looking buttons that silently do nothing while the caller
   * has nulled the handlers.
   */
  submitting?: boolean;
  /**
   * Uniform mode (PR-2a unified inbox): for PROJECTED deliverables (copy_section /
   * content_request) the write verbs would 404 (they have no physical row and are responded to via
   * bespoke routes). When provided, render a single read-only "Review →" deep-link to the surface
   * where the client actually acts on the item, INSTEAD of Approve / Request changes / Decline.
   */
  onReview?: () => void;
}

/**
 * DecisionCard — Inbox entry-point card for the Decisions section.
 *
 * Modes:
 *  - bulk (isSingleAction=false, default): badge/title/summary/item count + a
 *    "Review N changes →" button that opens DecisionDetailModal.
 *  - single-action (isSingleAction=true, i.e. content_decay): full action inline with
 *    Approve / Request-changes buttons. No modal.
 *  - uniform (uniformVerbs=true, PR-2a unified inbox): Approve / Request changes (+note) /
 *    Decline rendered inline for EVERY card, with the send age. Calls the real respond endpoint.
 */
export function DecisionCard({
  decision, onOpen, onApprove, onFlagWithNote, onDecline, uniformVerbs = false, ageLabel, onReview,
  submitting = false,
}: DecisionCardProps) {
  const [flagging, setFlagging] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [flagNote, setFlagNote] = useState('');

  const handleSubmitFlag = () => {
    const note = flagNote.trim();
    onFlagWithNote?.(note);
    setFlagging(false);
    setFlagNote('');
  };
  const handleSubmitDecline = () => {
    const note = flagNote.trim();
    onDecline?.(note);
    setDeclining(false);
    setFlagNote('');
  };

  // Uniform mode: Approve / Request changes (+note) / Decline for every card.
  const uniformActions = (
    <>
      {!flagging && !declining ? (
        <>
          {/* Item 5 — canonical approve CTA, consistent across the unified inbox (uniform mode only;
              the legacy single-action + bulk paths below are unchanged). */}
          <Button size="sm" variant="primary" onClick={onApprove} disabled={submitting}>
            {approveCtaLabel(decision.itemCount, 0, submitting)}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setFlagging(true)} disabled={submitting}>
            Request changes
          </Button>
          {/* Keep Decline visible (disabled) while submitting even though the caller nulls
              onDecline in flight — otherwise the button vanishes mid-submit (layout jump). */}
          {(onDecline || submitting) && (
            <Button size="sm" variant="ghost" onClick={() => setDeclining(true)} disabled={submitting}>
              Decline
            </Button>
          )}
          {/* A1a — uniform-mode "View" gate: `>= 1` (was `> 1`) so single-item modal-routed types
              (schema_plan + single-item client_action redirects/links/AEO) get a View affordance and
              are no longer reviewed blind. Label drops the count when itemCount===1 ("View →"). This
              gate is inside the uniformActions block (uniform mode = unified inbox only) and does NOT
              touch the legacy bulk-mode "Review N changes →" path below. */}
          {decision.itemCount >= 1 && (
            <Button size="sm" variant="ghost" onClick={onOpen} className="ml-auto">
              {decision.itemCount === 1 ? 'View →' : `View ${decision.itemCount} →`}
            </Button>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 flex-1">
          <FormInput
            type="text"
            value={flagNote}
            onChange={setFlagNote}
            placeholder={declining ? 'Why are you declining? (optional)' : 'Add a note for your team…'}
            className="flex-1 t-caption placeholder:text-[var(--brand-text-muted)] outline-none"
          />
          <Button
            size="sm"
            variant="primary"
            onClick={declining ? handleSubmitDecline : handleSubmitFlag}
          >
            Send
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setFlagging(false); setDeclining(false); setFlagNote(''); }}
          >
            Cancel
          </Button>
        </div>
      )}
    </>
  );

  return (
    // pr-check-disable-next-line -- brand signature radius intentional; mirrors SectionCard visual identity for decision cards
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden p-4" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
      {/* Header row: badge + priority + age */}
      <div className="flex items-center gap-2 mb-1">
        <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)]">
          {decision.badge}
        </span>
        {decision.priority === 'high' && (
          <span className="t-caption-sm font-medium text-accent-warning">High priority</span>
        )}
        {uniformVerbs && ageLabel && (
          <span className="t-caption-sm text-[var(--brand-text-muted)] ml-auto">{ageLabel}</span>
        )}
      </div>

      {/* Title + summary */}
      <h4 className="t-body font-semibold text-[var(--brand-text-bright)]">{decision.title}</h4>
      <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{decision.summary}</p>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {uniformVerbs && onReview ? (
          /* Projected deliverable (copy / content_request): read-only deep-link, NOT the write
             verbs — those /respond on a PK lookup and 404 for a projected id (design §13-D1). */
          <Button size="sm" variant="primary" onClick={onReview}>
            Review →
          </Button>
        ) : uniformVerbs ? (
          uniformActions
        ) : decision.isSingleAction ? (
          /* Single-action mode (content_decay) — inline approve / flag */
          <>
            <Button size="sm" variant="primary" onClick={onApprove}>
              Approve
            </Button>
            {!flagging ? (
              <Button size="sm" variant="ghost" onClick={() => setFlagging(true)}>
                Request changes
              </Button>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <FormInput
                  type="text"
                  value={flagNote}
                  onChange={setFlagNote}
                  placeholder="Add a note for your team…"
                  className="flex-1 t-caption placeholder:text-[var(--brand-text-muted)] outline-none"
                />
                <Button size="sm" variant="primary" onClick={handleSubmitFlag}>
                  Send
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setFlagging(false); setFlagNote(''); }}>
                  Cancel
                </Button>
              </div>
            )}
          </>
        ) : (
          /* Bulk mode — entry-point CTA opens DecisionDetailModal */
          <Button size="sm" variant="ghost" onClick={onOpen}>
            Review {decision.itemCount} change{decision.itemCount !== 1 ? 's' : ''} →
          </Button>
        )}
      </div>
    </div>
  );
}
