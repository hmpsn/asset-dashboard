// @ds-rebuilt
import { useMemo } from 'react';
import type { Recommendation } from '../../../shared/types/recommendations';
import { useAdminUndismissRecommendation } from '../../hooks/admin/useAdminRecommendations';
import { EmptyState, Icon } from '../ui';
import { RecommendationRow } from '../admin/recommendations/RecommendationRow';

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
}

export function EngineRecommendationHistory({
  workspaceId,
  recommendations,
}: EngineRecommendationHistoryProps) {
  const undismiss = useAdminUndismissRecommendation(workspaceId);
  const grouped = useMemo(
    () => groupEngineRecommendationHistory(recommendations),
    [recommendations],
  );

  if (recommendations.length === 0) {
    return (
      <div data-testid="engine-recommendation-history">
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
                  onUndismiss={rec.status === 'dismissed'
                    ? (recId) => undismiss.mutate(recId)
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
