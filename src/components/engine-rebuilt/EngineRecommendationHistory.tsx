// @ds-rebuilt
import { useMemo, useRef, useState } from 'react';
import type { Recommendation } from '../../../shared/types/recommendations';
import { useAdminUndismissRecommendation } from '../../hooks/admin/useAdminRecommendations';
import { Button, EmptyState, Icon, InlineBanner, Skeleton } from '../ui';
import { RecommendationRow } from '../admin/recommendations/RecommendationRow';
import { mutationErrorMessage } from './engineMutationFeedback';

function HistoryEmptyIcon({ className }: { className?: string }) {
  return <Icon name="clock" className={className} />;
}

export type EngineHistoryCategory =
  | 'completed'
  | 'dismissed'
  | 'struck'
  | 'throttled'
  | 'sent'
  | 'approved'
  | 'declined'
  | 'other';

const HISTORY_CATEGORIES: Array<{ id: EngineHistoryCategory; label: string }> = [
  { id: 'completed', label: 'Completed' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'struck', label: 'Struck' },
  { id: 'throttled', label: 'Throttled' },
  { id: 'sent', label: 'Sent to client' },
  { id: 'approved', label: 'Approved by client' },
  { id: 'declined', label: 'Declined by client' },
  { id: 'other', label: 'Other inactive' },
];

/**
 * Mirror canonical isActiveRec exclusion precedence so an overlapping legacy
 * row receives one deterministic history label and can never render twice.
 */
export function engineHistoryCategory(rec: Recommendation): EngineHistoryCategory {
  if (rec.status === 'completed') return 'completed';
  if (rec.status === 'dismissed') return 'dismissed';
  if (rec.lifecycle === 'struck') return 'struck';
  if (rec.lifecycle === 'throttled') return 'throttled';
  if (rec.clientStatus === 'sent') return 'sent';
  if (rec.clientStatus === 'approved') return 'approved';
  if (rec.clientStatus === 'declined') return 'declined';
  return 'other';
}

export function groupEngineRecommendationHistory(
  recommendations: Recommendation[],
): Map<EngineHistoryCategory, Recommendation[]> {
  const grouped = new Map<EngineHistoryCategory, Recommendation[]>();
  for (const rec of recommendations) {
    const category = engineHistoryCategory(rec);
    const rows = grouped.get(category);
    if (rows) rows.push(rec);
    else grouped.set(category, [rec]);
  }
  for (const rows of grouped.values()) {
    rows.sort((a, b) => {
      const byUpdatedAt = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      return byUpdatedAt || a.id.localeCompare(b.id);
    });
  }
  return grouped;
}

interface EngineRecommendationHistoryProps {
  workspaceId: string;
  recommendations: Recommendation[];
  isLoading?: boolean;
  isError?: boolean;
  isStale?: boolean;
  onRetry: () => void;
}

export function EngineRecommendationHistory({
  workspaceId,
  recommendations,
  isLoading = false,
  isError = false,
  isStale = false,
  onRetry,
}: EngineRecommendationHistoryProps) {
  const undismiss = useAdminUndismissRecommendation(workspaceId);
  const statusClearInFlight = useRef(false);
  const [pendingRecId, setPendingRecId] = useState<string | null>(null);
  const [statusClearError, setStatusClearError] = useState<unknown>(null);
  const [statusClearSucceeded, setStatusClearSucceeded] = useState(false);
  const grouped = useMemo(
    () => groupEngineRecommendationHistory(recommendations),
    [recommendations],
  );

  const clearDismissedStatus = (recId: string) => {
    if (statusClearInFlight.current) return;
    statusClearInFlight.current = true;
    setPendingRecId(recId);
    setStatusClearError(null);
    setStatusClearSucceeded(false);
    undismiss.mutate(recId, {
      onSuccess: () => {
        setPendingRecId(null);
        setStatusClearSucceeded(true);
      },
      onError: (error) => {
        setStatusClearError(error);
        setPendingRecId(null);
      },
      onSettled: () => {
        statusClearInFlight.current = false;
      },
    });
  };

  const statusClearedBanner = statusClearSucceeded ? (
    <InlineBanner
      tone="success"
      title="Dismissed status cleared"
      message="Other lifecycle and client decisions remain unchanged; this action changed only the dismissed status."
      onDismiss={() => setStatusClearSucceeded(false)}
    />
  ) : null;
  const staleBanner = isStale ? (
    <InlineBanner tone="warning" title="Recommendation history may be stale">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>The last loaded history remains visible. Refresh when the recommendation source is healthy.</span>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Refresh history
        </Button>
      </div>
    </InlineBanner>
  ) : null;

  if (isLoading) {
    return (
      <div data-testid="engine-recommendation-history-loading" className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="engine-recommendation-history">
        <InlineBanner tone="warning" title="Recommendation history is unavailable">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>History will remain hidden until the canonical recommendation read succeeds.</span>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </InlineBanner>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div data-testid="engine-recommendation-history" className="space-y-4">
        {staleBanner}
        {statusClearedBanner}
        <EmptyState
          icon={HistoryEmptyIcon}
          title="No recommendation history yet"
          description="Completed, suppressed, and client-resolved recommendations will remain reviewable here."
        />
      </div>
    );
  }

  return (
    <div data-testid="engine-recommendation-history" className="space-y-4">
      {staleBanner}
      {pendingRecId && (
        <InlineBanner
          tone="info"
          title="Clearing dismissed status"
          message="This changes only the recommendation status. Struck, throttled, and client lifecycle decisions remain in place."
        />
      )}
      {statusClearedBanner}
      {statusClearError != null && (
        <InlineBanner
          tone="error"
          title="Dismissed status was not cleared"
          message={mutationErrorMessage(
            statusClearError,
            'The dismissed status remains in place. Other lifecycle decisions were not changed. Try again in a moment.',
          )}
          onDismiss={() => setStatusClearError(null)}
        />
      )}
      {HISTORY_CATEGORIES.map(({ id, label }) => {
        const rows = grouped.get(id) ?? [];
        if (rows.length === 0) return null;
        return (
          <section key={id} aria-labelledby={`engine-history-${id}`}>
            <h4
              id={`engine-history-${id}`}
              className="mb-2 t-caption font-semibold text-[var(--brand-text-muted)]"
            >
              {label} ({rows.length})
            </h4>
            <div className="space-y-2">
              {rows.map((rec) => (
                <RecommendationRow
                  key={rec.id}
                  rec={rec}
                  showUndismiss={rec.status === 'dismissed'}
                  onUndismiss={rec.status === 'dismissed' && pendingRecId === null
                    ? clearDismissedStatus
                    : undefined}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
