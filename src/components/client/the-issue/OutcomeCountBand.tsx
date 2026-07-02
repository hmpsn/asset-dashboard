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
// P1a (measured): when units carry an `outcomeType`, each StatCard gets a type-aware icon and the
// grid is sorted into a stable type order (form fills · calls · bookings · …). Untyped/estimate
// units degrade byte-identically to P0 — no icon, no [data-outcome-type] tag, original DOM order.
//
// Four Laws: emerald = the outcome counts (success), tokens only, no purple. Type icons are muted
// (--brand-text-muted), never a new hue.

import { PhoneCall, FileText, CalendarCheck, Mail, MapPin, MessageSquare, Activity } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { StatCard, EmptyState, cardToneClasses } from '../../ui';
import type { IssueOutcomeCount, OutcomeType } from '../../../../shared/types/the-issue';

interface OutcomeCountBandProps {
  /** Server-assembled outcome counts, summed over pinned eventConfig events. */
  count: IssueOutcomeCount;
}

/** Type-aware icon per website-native action. Muted tone only — never a new hue (Four Laws). */
const TYPE_ICON: Record<OutcomeType, LucideIcon> = {
  form_fill: FileText,
  call: PhoneCall,
  booking: CalendarCheck,
  email: Mail,
  directions: MapPin,
  chat: MessageSquare,
  other: Activity,
};

/** Stable display order for typed units. Untyped units sort last (rank = length). */
const TYPE_ORDER: OutcomeType[] = ['form_fill', 'call', 'booking', 'email', 'directions', 'chat', 'other'];
function typeRank(t?: OutcomeType): number {
  if (t == null) return TYPE_ORDER.length;
  const i = TYPE_ORDER.indexOf(t);
  return i === -1 ? TYPE_ORDER.length : i;
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

  // Stable sort into type order; untyped units keep their original relative order (byte-identical
  // degradation — Array.sort is stable). When no unit carries an outcomeType, every rank is equal
  // so the order is unchanged from P0.
  const orderedUnits = [...count.units].sort((a, b) => typeRank(a.outcomeType) - typeRank(b.outcomeType));

  return (
    <div data-testid="outcome-count-band" className="space-y-3">
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${orderedUnits.length >= 3 ? 'lg:grid-cols-3' : ''} gap-3`}>
        {orderedUnits.map((unit, i) => {
          const key = unit.eventName ?? unit.label ?? i;
          const card = (
            <StatCard
              key={unit.outcomeType ? undefined : key}
              size="hero"
              label={unit.label}
              value={unit.current}
              icon={unit.outcomeType ? TYPE_ICON[unit.outcomeType] : undefined}
              iconColor={unit.outcomeType ? 'var(--brand-text-muted)' : undefined}
              valueColor="text-accent-success"
              sub={trendSub(unit.current, unit.priorPeriod, unit.baseline)}
              className={cardToneClasses('emerald')}
            />
          );
          // Untyped (estimate/P0) → render the bare StatCard as the grid child so the DOM degrades
          // byte-identically to P0. Typed (measured) → wrap in a [data-outcome-type] tag (StatCard
          // does not forward data-* attrs) so the type-aware render contract is queryable.
          if (!unit.outcomeType) return card;
          return <div key={key} data-outcome-type={unit.outcomeType}>{card}</div>;
        })}
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
