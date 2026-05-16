import { Button, StatusBadge } from '../ui';

interface TrackingSummary {
  total: number;
  live: number;
  inReview: number;
  approved: number;
  rejected: number;
  issueDetected: number;
  fixProposed: number;
}

interface SeoEditorTrackingSummaryProps {
  workspaceId?: string;
  summary: TrackingSummary;
  onResetAll: () => Promise<void> | void;
}

export function SeoEditorTrackingSummary({
  workspaceId,
  summary,
  onResetAll,
}: SeoEditorTrackingSummaryProps) {
  if (summary.total === 0) {
    if (!workspaceId) return null;
    return (
      <Button
        onClick={onResetAll}
        variant="link"
        size="sm"
        className="px-0 py-0 h-auto min-h-0 t-caption-sm !text-[var(--brand-text-muted)] hover:!text-accent-danger"
      >
        Reset page tracking
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-3 t-caption-sm text-[var(--brand-text-muted)]">
      <span className="text-[var(--brand-text)] font-medium">{summary.total} tracked</span>
      {summary.live > 0 && <StatusBadge status="live" />}
      {summary.live > 0 && <span className="text-accent-brand">{summary.live}</span>}
      {summary.inReview > 0 && <StatusBadge status="in-review" />}
      {summary.inReview > 0 && <span className="text-accent-warning">{summary.inReview}</span>}
      {summary.approved > 0 && <StatusBadge status="approved" />}
      {summary.approved > 0 && <span className="text-accent-success">{summary.approved}</span>}
      {summary.rejected > 0 && <StatusBadge status="rejected" />}
      {summary.rejected > 0 && <span className="text-accent-danger">{summary.rejected}</span>}
      {summary.issueDetected > 0 && <StatusBadge status="issue-detected" />}
      {summary.issueDetected > 0 && <span className="text-accent-warning">{summary.issueDetected}</span>}
      {summary.fixProposed > 0 && <StatusBadge status="fix-proposed" />}
      {summary.fixProposed > 0 && <span className="text-accent-info">{summary.fixProposed}</span>}
      {workspaceId && (
        <Button
          onClick={onResetAll}
          variant="link"
          size="sm"
          className="ml-auto px-0 py-0 h-auto min-h-0 t-caption-sm !text-[var(--brand-text-muted)] hover:!text-accent-danger"
        >
          reset all
        </Button>
      )}
    </div>
  );
}
