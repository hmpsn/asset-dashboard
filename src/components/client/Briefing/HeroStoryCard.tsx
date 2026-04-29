// CLIENT-FACING
import { useNavigate } from 'react-router-dom';
import { SectionCard } from '../../ui/SectionCard';
import { clientPath, type ClientTab } from '../../../routes';
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

  // Build the deep-link URL using clientPath + ?tab= + queryParams.
  // story.drillIn.page is typed as ExplorePage (constrained subset), but
  // clientPath/ClientTab accept the broader string set — cast through ClientTab
  // to satisfy the typed signature.
  const baseUrl = clientPath(workspaceId, story.drillIn.page as ClientTab, betaMode);
  const tabSuffix = story.drillIn.tab ? `?tab=${story.drillIn.tab}` : '';
  const hasQueryParams =
    story.drillIn.queryParams && Object.keys(story.drillIn.queryParams).length > 0;
  const querySuffix = hasQueryParams
    ? (story.drillIn.tab ? '&' : '?') +
      new URLSearchParams(story.drillIn.queryParams).toString()
    : '';
  const url = baseUrl + tabSuffix + querySuffix;

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
