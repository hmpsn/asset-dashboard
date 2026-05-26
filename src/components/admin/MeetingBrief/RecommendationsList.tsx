import { ArrowUpRight } from 'lucide-react';
import { Button } from '../../ui';
import type { MeetingBriefRecommendation } from '../../../../shared/types/meeting-brief.js';
import type { Page } from '../../../routes';

interface Props {
  items: MeetingBriefRecommendation[];
  onOpenRecommendation?: (route: Page) => void;
  resolveRecommendationRoute?: (item: MeetingBriefRecommendation) => Page;
}

export function RecommendationsList({ items, onOpenRecommendation, resolveRecommendationRoute }: Props) {
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
            <div className="min-w-0">
              <p className="t-ui text-[var(--brand-text-bright)]">{rec.action}</p>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{rec.rationale}</p>
              {onOpenRecommendation && resolveRecommendationRoute && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 px-2 py-1 t-caption-sm text-accent-brand"
                  icon={ArrowUpRight}
                  onClick={() => onOpenRecommendation(resolveRecommendationRoute(rec))}
                >
                  Open source tab
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
