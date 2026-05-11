import { useState } from 'react';
import { Button } from '../ui';
import type { NormalizedDecision } from '../../../shared/types/decision';

interface DecisionCardProps {
  decision: NormalizedDecision;
  /** Called when the user clicks the bulk "Review N changes →" CTA. */
  onOpen: () => void;
  /** Single-action mode: called when the user clicks "Approve". */
  onApprove?: () => void;
  /** Single-action mode: called with the note when user submits "Request changes". */
  onFlagWithNote?: (note: string) => void;
}

/**
 * DecisionCard — Inbox entry-point card for the Decisions section.
 *
 * Two modes:
 *  - bulk (isSingleAction=false): shows badge, title, summary, item count,
 *    and a "Review N changes →" button that opens DecisionDetailModal.
 *  - single-action (isSingleAction=true, i.e. content_decay): renders the
 *    full action inline with Approve / Request-changes buttons. No modal.
 */
export function DecisionCard({
  decision, onOpen, onApprove, onFlagWithNote,
}: DecisionCardProps) {
  const [flagging, setFlagging] = useState(false);
  const [flagNote, setFlagNote] = useState('');

  const handleSubmitFlag = () => {
    const note = flagNote.trim();
    onFlagWithNote?.(note);
    setFlagging(false);
    setFlagNote('');
  };

  return (
    // pr-check-disable-next-line -- brand signature radius intentional; mirrors SectionCard visual identity for decision cards
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden p-4" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
      {/* Header row: badge + priority */}
      <div className="flex items-center gap-2 mb-1">
        <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)]">
          {decision.badge}
        </span>
        {decision.priority === 'high' && (
          <span className="t-caption-sm font-medium text-accent-warning">High priority</span>
        )}
      </div>

      {/* Title + summary */}
      <h4 className="t-ui font-medium text-[var(--brand-text-bright)]">{decision.title}</h4>
      <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{decision.summary}</p>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3">
        {decision.isSingleAction ? (
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
                <input
                  type="text"
                  value={flagNote}
                  onChange={e => setFlagNote(e.target.value)}
                  placeholder="Add a note for your team…"
                  className="flex-1 px-3 py-1.5 rounded-[var(--radius-md)] t-caption bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] outline-none focus:border-teal-500/50"
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
