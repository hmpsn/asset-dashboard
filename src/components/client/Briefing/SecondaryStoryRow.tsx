// CLIENT-FACING
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronRight,
  Lightbulb,
  Search,
  Star,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { renderDrillInUrl } from './drillIn';
import type { BriefingStory, BriefingCategory } from '../../../../shared/types/briefing';

interface SecondaryStoryRowProps {
  story: BriefingStory;
  workspaceId: string;
  betaMode: boolean;
}

interface CategoryVisual {
  Icon: LucideIcon;
  colorClass: string;
}

const CATEGORY_VISUALS: Record<BriefingCategory, CategoryVisual> = {
  win: { Icon: Star, colorClass: 'text-emerald-400' },
  risk: { Icon: AlertTriangle, colorClass: 'text-amber-400' },
  opportunity: { Icon: Lightbulb, colorClass: 'text-blue-400' },
  competitive: { Icon: Search, colorClass: 'text-teal-400' },
  period_change: { Icon: TrendingUp, colorClass: 'text-blue-400' },
};

/**
 * SecondaryStoryRow — divider-row layout for non-headline briefing stories.
 *
 * Renders below the `<HeroStoryCard>` in the magazine briefing layout, one row
 * per non-headline story (typically 2–4). No card chrome — plain rows separated
 * by thin bottom borders, with a hover state for affordance. The whole row is
 * a `<button>` so it's keyboard-accessible and clickable end-to-end.
 */
export function SecondaryStoryRow({ story, workspaceId, betaMode }: SecondaryStoryRowProps) {
  const navigate = useNavigate();

  const { Icon, colorClass } = CATEGORY_VISUALS[story.category];
  const url = renderDrillInUrl(story, workspaceId, betaMode);

  return (
    <button
      type="button"
      onClick={() => navigate(url)}
      className="text-left w-full flex items-center gap-4 px-4 py-3 border-b border-[var(--brand-border)] last:border-b-0 hover:bg-[var(--surface-3)]/50 transition-colors cursor-pointer"
    >
      {/* Category icon */}
      <Icon className={`w-6 h-6 shrink-0 ${colorClass}`} aria-hidden="true" />

      {/* Headline + narrative */}
      <div className="flex-1 min-w-0">
        <div className="t-body font-medium text-[var(--brand-text-bright)]">
          {story.headline}
        </div>
        <p className="t-caption text-[var(--brand-text-muted)] line-clamp-2">
          {story.narrative}
        </p>
      </div>

      {/* Arrow icon */}
      <ChevronRight
        className="w-5 h-5 shrink-0 text-[var(--brand-text-muted)]"
        aria-hidden="true"
      />
    </button>
  );
}
