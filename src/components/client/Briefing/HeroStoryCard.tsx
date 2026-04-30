// CLIENT-FACING
import { useNavigate } from 'react-router-dom';
import { SectionCard } from '../../ui/SectionCard';
import { renderDrillInUrl } from './drillIn';
import type { BriefingStory, BriefingCategory } from '../../../../shared/types/briefing';

interface HeroStoryCardProps {
  story: BriefingStory;
  workspaceId: string;
  betaMode: boolean;
}

const CATEGORY_LABELS: Record<BriefingCategory, string> = {
  win: 'WIN',
  risk: 'RISK',
  opportunity: 'OPPORTUNITY',
  competitive: 'COMPETITIVE',
  period_change: 'PERIOD CHANGE',
};

/**
 * HeroStoryCard — large editorial hero card for the magazine briefing layout.
 *
 * Renders the single highlighted "headline" story for the week (one per
 * briefing). Sits below `<ActionQueueStrip>` and above `<SecondaryStoryRow>`.
 * Visually anchored by a teal left-border accent stripe so it reads as the
 * lead article of the briefing.
 */
export function HeroStoryCard({ story, workspaceId, betaMode }: HeroStoryCardProps) {
  const navigate = useNavigate();

  const categoryLabel = CATEGORY_LABELS[story.category];
  const url = renderDrillInUrl(story, workspaceId, betaMode);

  return (
    <div className="border-l-2 border-teal-400 pl-3">
      <SectionCard>
        <div className="space-y-4">
          {/* Category label */}
          <div className="t-label text-teal-400 font-semibold tracking-wider">
            {categoryLabel}
          </div>

          {/* Headline */}
          <h2 className="t-h2 font-bold text-[var(--brand-text-bright)]">
            {story.headline}
          </h2>

          {/* Narrative */}
          <p className="t-body text-[var(--brand-text)] leading-relaxed">
            {story.narrative}
          </p>

          {/* Optional metrics row (0–2 pills) */}
          {story.metrics.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {story.metrics.map((metric, i) => (
                <span
                  key={`${metric.label}-${i}`}
                  className="bg-teal-500/10 text-teal-400 px-3 py-1.5 rounded-full t-caption font-medium inline-flex items-center gap-1.5"
                >
                  <span className="t-stat-sm text-[var(--brand-text-bright)]">
                    {metric.value}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="t-caption text-[var(--brand-text-muted)]">
                    {metric.label}
                  </span>
                </span>
              ))}
            </div>
          )}

          {/*
            Phase 2.5b — data receipt line. Citation prose populated by 2.5a's
            deterministic templates (see server/briefing-templates/*). Renders
            below the metric pills, above the drill-in. Older briefings
            generated before 2.5a have no receipt and skip this block.
          */}
          {story.dataReceipt && (
            <div className="border-t border-[var(--brand-border)]/30 pt-3">
              <p className="t-caption-sm text-[var(--brand-text-muted)] leading-relaxed">
                <span aria-hidden="true">─ </span>
                {story.dataReceipt}
              </p>
            </div>
          )}

          {/* Drill-in link */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => navigate(url)}
              className="t-caption text-teal-400 hover:text-teal-300 transition-colors font-medium"
            >
              See the data &rarr;
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
