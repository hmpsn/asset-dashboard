import { ArrowRight } from 'lucide-react';

import { Badge } from './Badge';
import type { OutcomeReadback } from '../../../shared/types/outcome-tracking';

/**
 * W5.1: the SINGLE outcome read-back chip shared by every admin surface that closes
 * the outcome loop — Strategy tab keyword rows, Keyword Hub drawer, Posts list. One
 * component so the baseline→current rendering and the verdict→color mapping never
 * drift between surfaces.
 *
 * Honesty contract: position is LOWER-is-better, so we DO NOT infer improvement from
 * the raw numbers — we trust `outcome.direction` (server-computed, position-aware).
 * Color follows that direction (emerald=improved, red=declined, zinc=stable). The
 * verdict label comes from the score so "strong win" / "win" read as wins.
 */

const VERDICT_LABEL: Record<OutcomeReadback['score'], string> = {
  strong_win: 'Strong win',
  win: 'Win',
  neutral: 'No change',
  loss: 'Loss',
  insufficient_data: 'No data',
  inconclusive: 'Inconclusive',
};

function toneForDirection(direction: OutcomeReadback['direction']): 'emerald' | 'red' | 'zinc' {
  if (direction === 'improved') return 'emerald';
  if (direction === 'declined') return 'red';
  return 'zinc';
}

/** Build the "#14 → #6" (position) or "3 → 25 clicks" (clicks) movement string. */
function movementText(outcome: OutcomeReadback): string {
  if (outcome.baselinePosition != null && outcome.currentPosition != null) {
    return `#${Math.round(outcome.baselinePosition)} → #${Math.round(outcome.currentPosition)}`;
  }
  if (outcome.baselineClicks != null && outcome.currentClicks != null) {
    return `${Math.round(outcome.baselineClicks)} → ${Math.round(outcome.currentClicks)} clicks`;
  }
  // Generic numeric fallback (e.g. score-based metrics) using the resolved values.
  return `${Math.round(outcome.baselineValue)} → ${Math.round(outcome.currentValue)}`;
}

const CHECKPOINT_LABEL: Record<OutcomeReadback['checkpointDays'], string> = {
  7: '7d', 30: '30d', 60: '60d', 90: '90d',
};

export interface OutcomeReadbackChipProps {
  outcome: OutcomeReadback;
  /** When true, append the checkpoint timeframe (e.g. "· 90d"). Default true. */
  showTimeframe?: boolean;
  className?: string;
}

export function OutcomeReadbackChip({ outcome, showTimeframe = true, className }: OutcomeReadbackChipProps) {
  const verdict = VERDICT_LABEL[outcome.score];
  const movement = movementText(outcome);
  const timeframe = showTimeframe ? ` · ${CHECKPOINT_LABEL[outcome.checkpointDays] ?? `${outcome.checkpointDays}d`}` : '';
  const label = `${movement} · ${verdict}${timeframe}`;
  return (
    <Badge
      tone={toneForDirection(outcome.direction)}
      size="sm"
      icon={ArrowRight}
      label={label}
      className={className}
      ariaLabel={`Outcome: ${movement}, ${verdict}, measured at ${outcome.checkpointDays} days`}
    />
  );
}
