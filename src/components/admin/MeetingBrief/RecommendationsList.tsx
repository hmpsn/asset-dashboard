import type { MeetingBriefRecommendation } from '../../../../shared/types/meeting-brief.js';

interface Props {
  items: MeetingBriefRecommendation[];
}

export function RecommendationsList({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Recommendations for This Period
      </h3>
      <div className="space-y-3">
        {items.map((rec, i) => (
          <div key={i} className="flex gap-3 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <span className="shrink-0 mt-0.5 text-xs font-bold text-zinc-500 w-5 text-center">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium text-zinc-100">{rec.action}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{rec.rationale}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
