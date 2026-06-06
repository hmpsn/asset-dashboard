import { Modal } from '../ui/overlay/Modal';
import { Button } from '../ui/Button';
import { formatDate } from '../../utils/formatDates';

export interface RefreshOrderingPromptProps {
  open: boolean;
  reason: 'missing' | 'stale' | 'markets_changed';
  lastLocalRefreshAt: string | null;
  onFullRefresh: () => void;
  onGenerateAnyway: () => void;
  onCancel: () => void;
}

const REASON_COPY: Record<RefreshOrderingPromptProps['reason'], string> = {
  missing:
    'No local SEO data yet — refresh it first so your strategy reflects real local visibility.',
  stale:
    'Local SEO data is over 30 days old. Refreshing first will give your strategy the most accurate local signals.',
  markets_changed:
    'Your markets changed since the last local crawl. A fresh crawl will align your strategy with the updated market set.',
};

export function RefreshOrderingPrompt({
  open,
  reason,
  lastLocalRefreshAt,
  onFullRefresh,
  onGenerateAnyway,
  onCancel,
}: RefreshOrderingPromptProps) {
  return (
    <Modal open={open} onClose={onCancel} size="sm">
      <Modal.Header title="Strategy needs fresh local data" onClose={onCancel} />
      <Modal.Body>
        {/* Amber accent bar for the warning/staleness signal */}
        <div className="w-full h-1 rounded-[var(--radius-sm)] bg-amber-500/40 mb-4" />

        <p className="t-body mb-3">
          {REASON_COPY[reason]}
        </p>

        {lastLocalRefreshAt && (
          <p className="t-caption text-amber-400 mb-4">
            Last local refresh: {formatDate(lastLocalRefreshAt)}
          </p>
        )}
      </Modal.Body>
      <Modal.Footer className="flex-col gap-2 items-stretch">
        {/* Primary action: Full refresh (local → strategy chain) */}
        <Button
          onClick={onFullRefresh}
          variant="primary"
          size="md"
          className="w-full rounded-[var(--radius-lg)]"
        >
          Full refresh (local → strategy)
        </Button>

        {/* Secondary: Generate anyway — the non-blocking override */}
        <Button
          onClick={onGenerateAnyway}
          variant="secondary"
          size="md"
          className="w-full rounded-[var(--radius-lg)]"
        >
          Generate anyway
        </Button>

        {/* Ghost: Cancel */}
        <Button
          onClick={onCancel}
          variant="ghost"
          size="md"
          className="w-full rounded-[var(--radius-lg)]"
        >
          Cancel
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
