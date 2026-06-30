// ── IssueNextBetsSection — the "Your next bets" $-forecast band (P1) ─────────────
//
// the-issue-client-next-bets. A compact, forward-looking forecast band above the plan:
// the top ~3 recommended moves reframed as a banded monthly $ projection (from the
// client-safe ImpactBand.monthlyRangeUsd — never raw emvPerWeek), with an optional
// outcome-unit equivalent shown ONLY when it rounds to ≥1 (framing contract).
//
// This is a FORECAST SUMMARY, not a second action surface: it answers "what are my next
// moves worth?" and hands off to the plan (the content cards below) for the actual
// greenlight — which is where the tier-gating + content-vs-other-archetype semantics live.
// (Per adversarial review C1/I1/M1: a per-bet greenlight here bypassed the TierGate, mis-
// applied the content-request greenlight to non-content recs, and duplicated the plan's CTA.)
// Renders nothing when no rec carries a $ band (below the display floor) — never a placeholder.

import { Target, ArrowRight } from 'lucide-react';
import { SectionCard, Icon, Button } from '../../ui';
import type { Recommendation } from '../../../../shared/types/recommendations';
import { computeNextBetsForecast, type NextBet } from './nextBetsForecast';

interface IssueNextBetsSectionProps {
  /** Curated client recs (the feed). Only those with impactBand.monthlyRangeUsd are forecastable. */
  recs: Recommendation[];
  /** $ per outcome from the verdict (for the optional outcome-unit line); null when no outcomeValue set. */
  valuePerOutcome: number | null;
  /** Outcome unit label (e.g. 'new patient') for the outcome-unit line; null when unavailable. */
  outcomeUnitLabel: string | null;
  /** Open the plan to act on these moves (the tier-gated greenlight lives there, on the content cards). */
  onReviewPlan: () => void;
}

/** Compact USD: "$80", "$1,200". Whole dollars — projections never carry cents. */
function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** Banded monthly $ phrase: "~$80–160/mo" (single leading $, en dash). */
function moneyRange(low: number, high: number): string {
  return low === high ? `~${usd(low)}/mo` : `~${usd(low)}–${Math.round(high).toLocaleString()}/mo`;
}

/** Outcome-unit phrase, or null. "≈ 1–2 new patients/mo"; "≈ up to 2 new patients/mo" when the low
 *  end rounds to 0 (honest — never over-states the floor as 1). Plural on the high end. */
function outcomePhrase(lo: number | null, hi: number | null, unit: string | null): string | null {
  if (lo == null || hi == null || !unit) return null;
  const label = hi === 1 ? unit : `${unit}s`;
  if (lo === 0) return `≈ up to ${hi} ${label}/mo`;
  const count = lo === hi ? `${hi}` : `${lo}–${hi}`;
  return `≈ ${count} ${label}/mo`;
}

function BetRow({ bet, unit }: { bet: NextBet; unit: string | null }) {
  const outcomes = outcomePhrase(bet.outcomeLow, bet.outcomeHigh, unit);
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-t border-[var(--brand-border)] first:border-t-0">
      <p className="t-ui text-[var(--brand-text-bright)] truncate min-w-0">{bet.title}</p>
      <p className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0 text-right">
        <span className="text-[var(--brand-text-bright)]">{moneyRange(bet.monthlyLow, bet.monthlyHigh)}</span>
        {outcomes && <span className="block">{outcomes}</span>}
      </p>
    </div>
  );
}

export function IssueNextBetsSection({
  recs,
  valuePerOutcome,
  outcomeUnitLabel,
  onReviewPlan,
}: IssueNextBetsSectionProps) {
  const forecast = computeNextBetsForecast(
    recs.map((r) => ({
      id: r.id,
      title: r.title,
      impactBand: r.impactBand,
      impactScore: r.impactScore,
      opportunity: r.opportunity ? { value: r.opportunity.value } : null,
    })),
    valuePerOutcome,
  );

  // No forecastable bet (every rec is below the $ display floor) → render nothing. The plan lists
  // below still surface the moves; the forecast band just has no $ story to tell yet.
  if (!forecast) return null;

  const { bets, combinedLow, combinedHigh, combinedOutcomeLow, combinedOutcomeHigh } = forecast;
  const combinedOutcomes = outcomePhrase(combinedOutcomeLow, combinedOutcomeHigh, outcomeUnitLabel);
  const moveWord = bets.length === 1 ? 'move' : 'moves';

  return (
    <SectionCard
      title="Your next bets"
      titleIcon={<Icon as={Target} size="md" className="text-accent-brand" />}
    >
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">
        We project <span className="text-[var(--brand-text-bright)]">{moneyRange(combinedLow, combinedHigh)}</span>
        {combinedOutcomes && <span className="text-[var(--brand-text-bright)]"> ({combinedOutcomes})</span>}
        {' '}from your next {bets.length} {moveWord}.
      </p>
      <div>
        {bets.map((bet) => (
          <BetRow key={bet.id} bet={bet} unit={outcomeUnitLabel} />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="t-micro text-[var(--brand-text-muted)]">
          Projected from your traffic and keyword data — actual results vary.
        </p>
        <Button variant="secondary" size="sm" onClick={onReviewPlan} className="flex-shrink-0">
          Review your plan <Icon as={ArrowRight} size="sm" />
        </Button>
      </div>
    </SectionCard>
  );
}
