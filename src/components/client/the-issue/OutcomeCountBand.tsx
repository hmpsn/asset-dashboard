// ── OutcomeCountBand — slot 2 of the client spine (outcomes in human units) ──────
//
// The outcome count in the client's own words ("calls", "form fills", "demos") — one hero
// StatCard per pinned GA4 key-event. Each unit carries a DUAL trend: vs the previous
// comparable period AND vs the fixed engagement-start baseline ("since we started"). The
// counts are server-assembled (IssueOutcomeCount, Lane A) — this is a pure render.
//
// Honesty guards (P0):
//   • namedRecordsAvailable is always false at P0 → render the muted "names available with
//     call/CRM tracking" affordance, NOT a fake "view names" link.
//   • zero units → an EmptyState set-up CTA, never a "0" rendered as if it were an outcome.
//
// Four Laws: emerald = the outcome counts (success), tokens only, no purple.

import { PhoneCall } from 'lucide-react';
import { StatCard, EmptyState } from '../../ui';
import type { IssueOutcomeCount } from '../../../../shared/types/the-issue';

interface OutcomeCountBandProps {
  /** Server-assembled outcome counts, summed over pinned eventConfig events. */
  count: IssueOutcomeCount;
}

/**
 * Dual-trend sub line for one unit: "<period> vs last period · <baseline> since we started".
 * "flat vs last period" when the prior period matches; the baseline clause is omitted while
 * the baseline is still establishing (baseline == null) so we never fabricate a delta.
 */
function trendSub(current: number, priorPeriod: number | null, baseline: number | null): string {
  let periodClause: string;
  if (priorPeriod == null) {
    periodClause = 'new vs last period';
  } else if (current === priorPeriod) {
    periodClause = 'flat vs last period';
  } else {
    const delta = current - priorPeriod;
    periodClause = `${delta > 0 ? '+' : ''}${delta.toLocaleString()} vs last period`;
  }

  if (baseline == null) return `${periodClause} · establishing your baseline`;
  const baselineDelta = current - baseline;
  const baselineClause = baselineDelta >= 0
    ? `up from ${baseline.toLocaleString()} since we started`
    : `down from ${baseline.toLocaleString()} since we started`;
  return `${periodClause} · ${baselineClause}`;
}

export function OutcomeCountBand({ count }: OutcomeCountBandProps) {
  if (count.units.length === 0) {
    return (
      <div data-testid="outcome-count-band">
        <EmptyState
          icon={PhoneCall}
          title="No conversion events configured yet"
          description="Once your strategist pins the conversions that matter to your business — calls, form fills, bookings — your outcome count appears here."
        />
      </div>
    );
  }

  return (
    <div data-testid="outcome-count-band" className="space-y-3">
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${count.units.length >= 3 ? 'lg:grid-cols-3' : ''} gap-3`}>
        {count.units.map((unit, i) => (
          <StatCard
            key={unit.eventName ?? unit.label ?? i}
            size="hero"
            label={unit.label}
            value={unit.current}
            valueColor="text-accent-success"
            sub={trendSub(unit.current, unit.priorPeriod, unit.baseline)}
            className="bg-gradient-to-br from-emerald-500/10 via-[var(--surface-2)] to-[var(--surface-2)] border-emerald-500/20"
          />
        ))}
      </div>
      {/* Honest upsell — at P0 we count outcomes but cannot name the people behind them. */}
      {!count.namedRecordsAvailable && (
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          Names available with call &amp; CRM tracking — ask your strategist to connect it.
        </p>
      )}
    </div>
  );
}
