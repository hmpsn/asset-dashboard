import type { MeetingBriefRecommendation } from '../../../../shared/types/meeting-brief.js';

interface Props {
  items: MeetingBriefRecommendation[];
}

export function RecommendationsList({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="mb-6">
      <h3 className="t-caption-sm font-semibold uppercase tracking-wider text-[var(--brand-text-muted)] mb-3">
        Recommendations for This Period
      </h3>
      <div className="space-y-3">
        {items.map((rec, i) => (
          <div key={i} className="flex gap-3 p-3 rounded-[var(--radius-lg)] bg-[var(--surface-2)] border border-[var(--brand-border)]">
            <span className="shrink-0 mt-0.5 t-caption-sm font-bold text-[var(--brand-text-muted)] w-5 text-center">
              {i + 1}
            </span>
            <div>
              <p className="t-ui text-[var(--brand-text-bright)]">{rec.action}</p>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{rec.rationale}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
