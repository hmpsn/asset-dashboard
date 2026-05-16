import { ThumbsDown } from 'lucide-react';
import { Button } from '../../ui';
import { Modal } from '../../ui/overlay/Modal';

interface StrategyDeclineKeywordModalProps {
  keyword: string;
  declineReasonText: string;
  setDeclineReasonText: (reason: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function StrategyDeclineKeywordModal({
  keyword,
  declineReasonText,
  setDeclineReasonText,
  onClose,
  onConfirm,
}: StrategyDeclineKeywordModalProps) {
  return (
    <Modal open onClose={onClose} size="sm">
      <Modal.Header title="Decline keyword" onClose={onClose} />
      <Modal.Body>
        <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">
          <span className="text-accent-danger font-medium">&ldquo;{keyword}&rdquo;</span> will be excluded from future strategy recommendations.
        </p>
        <label className="block t-caption-sm text-[var(--brand-text-muted)] mb-1">Why isn't this keyword relevant? <span className="text-[var(--brand-text-muted)]">(optional)</span></label>
        <textarea
          value={declineReasonText}
          onChange={e => setDeclineReasonText(e.target.value)}
          placeholder="e.g., We don't offer this service, too competitive, not our target audience..."
          className="w-full bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] px-3 py-2 t-body text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 resize-none h-20"
          autoFocus
        />
      </Modal.Body>
      <Modal.Footer>
        <div className="flex items-center justify-end gap-2 w-full">
          <Button
            onClick={onClose}
            variant="ghost"
            size="sm"
            className="px-3 py-1.5 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            variant="secondary"
            size="sm"
            icon={ThumbsDown}
            className="px-4 py-1.5 rounded-[var(--radius-lg)] bg-red-600/20 border border-red-500/30 text-accent-danger font-medium hover:bg-red-600/30 transition-colors"
          >
            Decline Keyword
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
