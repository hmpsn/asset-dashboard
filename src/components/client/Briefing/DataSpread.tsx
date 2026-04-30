// CLIENT-FACING
// Two-column wins / risks data spread for the "This Week" section of the
// client briefing. Sits between the HeroStoryCard and the "Recommended for
// You" section. Each column shows up to 3 one-liner items derived from
// non-headline secondary stories.

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { SectionCard, Icon } from '../../ui';
import type { BriefingStory } from '../../../../shared/types/briefing';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SpreadItem {
  /** Source story id, used as React key + drill-in resolver */
  id: string;
  /** Short headline (5-12 words). Derived from BriefingStory.headline. */
  headline: string;
  /** Single-line detail (≤80 chars). Derived from a BriefingStory metric or a clipped narrative. */
  detail: string;
  /** Optional drill-in URL — when present, the item is clickable. */
  drillInUrl?: string;
  /** Visual hint for the icon. The component picks the icon. */
  tone: 'win' | 'risk';
}

interface DataSpreadProps {
  wins: SpreadItem[];
  risks: SpreadItem[];
}

// ---------------------------------------------------------------------------
// Helper — pure function, no hooks. Called by the T2.5b.10 composer.
// ---------------------------------------------------------------------------

/**
 * Project a BriefingStory into a SpreadItem. Caps detail at ~80 chars.
 * Returns null if the story shouldn't appear in the spread (e.g., no useful
 * detail, or a period_change with no metrics).
 *
 * Category-to-tone mapping:
 *   'win'          → tone: 'win'
 *   'opportunity'  → tone: 'win'
 *   'risk'         → tone: 'risk'
 *   'competitive'  → tone: 'risk'
 *   'period_change'→ look at first metric value. Starts with '+' → 'win', else → 'risk'.
 *                    No metrics → return null (drop from spread).
 *
 * Detail line:
 *   Prefer first metric's `${value} ${label}` (em-space separated, e.g. "+12% MoM traffic").
 *   Fallback: first sentence of narrative truncated at 80 chars + "…".
 *
 * @param story      - the story to project
 * @param drillInUrl - the resolved drill-in URL from renderDrillInUrl(), or null
 */
export function spreadItemFromStory(
  story: BriefingStory,
  drillInUrl: string | null,
): SpreadItem | null {
  // --- Determine tone ---
  let tone: 'win' | 'risk';

  switch (story.category) {
    case 'win':
    case 'opportunity':
      tone = 'win';
      break;
    case 'risk':
    case 'competitive':
      tone = 'risk';
      break;
    case 'period_change': {
      const firstMetric = story.metrics[0];
      if (!firstMetric) {
        // No metrics → drop from spread
        return null;
      }
      tone = firstMetric.value.startsWith('+') ? 'win' : 'risk';
      break;
    }
    default: {
      // Exhaustive check — TypeScript will surface any unhandled future category
      const _exhaustive: never = story.category;
      void _exhaustive;
      return null;
    }
  }

  // --- Determine detail line ---
  let detail: string;
  const firstMetric = story.metrics[0];

  if (firstMetric) {
    // em-space ( ) separator between value and label
    const full = `${firstMetric.value} ${firstMetric.label}`;
    detail = full.length > 80 ? full.slice(0, 79) + '…' : full;
  } else {
    // Fallback: first sentence of narrative, truncated at 80 chars
    const firstSentence = story.narrative.split(/[.!?]/)[0] ?? story.narrative;
    const trimmed = firstSentence.trim();
    detail = trimmed.length > 80 ? trimmed.slice(0, 79) + '…' : trimmed;
    if (!detail) {
      // Narrative is empty — nothing useful to show
      return null;
    }
  }

  return {
    id: story.id,
    headline: story.headline,
    detail,
    drillInUrl: drillInUrl ?? undefined,
    tone,
  };
}

// ---------------------------------------------------------------------------
// Internal sub-component — renders one item row
// ---------------------------------------------------------------------------

interface SpreadItemRowProps {
  item: SpreadItem;
}

function SpreadItemRow({ item }: SpreadItemRowProps): ReactNode {
  const navigate = useNavigate();

  const iconNode = (
    <Icon
      as={item.tone === 'win' ? TrendingUp : TrendingDown}
      size="sm"
      className={item.tone === 'win' ? 'text-emerald-400' : 'text-amber-400'}
      aria-hidden="true"
    />
  );

  const content = (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0">{iconNode}</span>
        <span className="t-ui font-medium text-[var(--brand-text-bright)] truncate">
          {item.headline}
        </span>
      </div>
      <p className="t-caption-sm text-[var(--brand-text-muted)] pl-5 leading-snug">
        {item.detail}
      </p>
    </>
  );

  if (item.drillInUrl) {
    return (
      <button
        type="button"
        onClick={() => navigate(item.drillInUrl as string)}
        className="w-full text-left flex flex-col gap-0.5 px-2 py-1.5 rounded-[var(--radius-lg)] hover:bg-[var(--surface-3)]/60 transition-colors cursor-pointer"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 px-2 py-1.5">
      {content}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

const MAX_ITEMS = 3;

/**
 * Two-column data spread for the "This Week" briefing section.
 *
 * Renders at most 3 wins (left column) and 3 risks (right column). If both
 * sides are empty, returns null. If one side is empty, a muted "nothing this
 * week" note is shown in that column so the two-column layout is preserved.
 *
 * The component itself slices to MAX_ITEMS — callers may pass more.
 */
export function DataSpread({ wins, risks }: DataSpreadProps): ReactNode {
  // If both sides are empty, render nothing
  if (wins.length === 0 && risks.length === 0) {
    return null;
  }

  const displayedWins = wins.slice(0, MAX_ITEMS);
  const displayedRisks = risks.slice(0, MAX_ITEMS);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Wins column */}
      <SectionCard variant="subtle" noPadding>
        <div className="px-4 pt-4 pb-3">
          <p className="t-label tracking-wider text-[var(--brand-text-muted)] uppercase mb-3">
            Wins
          </p>
          {displayedWins.length > 0 ? (
            <div className="space-y-3">
              {displayedWins.map((item) => (
                <SpreadItemRow key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <p className="t-caption-sm text-[var(--brand-text-muted)] italic px-2">
              No new wins this week
            </p>
          )}
        </div>
      </SectionCard>

      {/* Risks column */}
      <SectionCard variant="subtle" noPadding>
        <div className="px-4 pt-4 pb-3">
          <p className="t-label tracking-wider text-[var(--brand-text-muted)] uppercase mb-3">
            Risks
          </p>
          {displayedRisks.length > 0 ? (
            <div className="space-y-3">
              {displayedRisks.map((item) => (
                <SpreadItemRow key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <p className="t-caption-sm text-[var(--brand-text-muted)] italic px-2">
              No new risks this week
            </p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
