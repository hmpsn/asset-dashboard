/**
 * StanceBar — proportional segmented allocation bar for "The Issue" cockpit.
 *
 * Shows the operator's current stance as a horizontal bar divided into
 * per-archetype segments, each coloured with a distinct accent fill from the
 * design-system token palette. A legend below the bar names each populated
 * archetype with its count; a muted trailing note shows cut (struck) and
 * parked (throttled) totals.
 *
 * Props:
 *   recs   – raw Recommendation list (component derives stance internally)
 *   stance – pre-computed StanceResult (use when parent already has it)
 * Exactly one of `recs` or `stance` must be provided.
 *
 * Tokens: src/tokens.css only. Typography: .t-caption-sm + .t-label.
 * Color law: teal=action, blue=data, emerald=wins. Per-archetype fills use
 * accent hue tokens to distinguish buckets — NOT purple, NOT new tokens.
 */
import type { Recommendation } from '../../../../shared/types/recommendations';
import type { Archetype } from '../../../../shared/types/strategy-archetype';
import { ARCHETYPE_ORDER, ARCHETYPE_LABELS } from '../../../../shared/types/strategy-archetype';
import { ARCHETYPE_ACCENT } from '../../../lib/recArchetypeMap';
import { deriveStance, type StanceResult } from '../../../lib/recStance';

// ─── Per-archetype bar fill — the SAME hue family as the shared ARCHETYPE_ACCENT
//     dot, just at ~70% opacity so the proportional fill reads as a tint of its
//     legend dot. Kept as STATIC literals (not runtime-concatenated) so the
//     Tailwind v4 JIT scanner emits every class. Hue-for-hue identical to
//     ARCHETYPE_ACCENT (teal/blue/amber/emerald/sky/orange) — the authority_bet
//     teal/blue swap is gone. No new tokens, no purple.
const ARCHETYPE_BAR_FILL: Record<Archetype, string> = {
  authority_bet: 'bg-teal-400/70',     // action hue — new content bets (matches ARCHETYPE_ACCENT)
  refresh_reclaim: 'bg-blue-400/70',   // data hue — reclaim work
  defend: 'bg-amber-400/70',           // amber — risk / defend
  quick_win: 'bg-emerald-400/70',      // emerald — wins / quick gains
  technical: 'bg-sky-400/70',          // sky — technical / infra
  local: 'bg-orange-400/70',           // orange — local
};

interface StanceBarProps {
  recs?: Recommendation[];
  stance?: StanceResult;
}

export function StanceBar({ recs, stance: stanceProp }: StanceBarProps) {
  const stance: StanceResult = stanceProp ?? deriveStance(recs ?? []);

  const total = ARCHETYPE_ORDER.reduce((sum, a) => sum + stance.byArchetype[a], 0);
  const populated = ARCHETYPE_ORDER.filter(a => stance.byArchetype[a] > 0);

  return (
    <div className="flex flex-col gap-2">
      {/* ── Segmented bar ── */}
      <div className="flex h-2.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-[var(--surface-3)]">
        {total === 0 ? null : populated.map(archetype => {
          const count = stance.byArchetype[archetype];
          const pct = (count / total) * 100;
          return (
            <div
              key={archetype}
              data-archetype={archetype}
              className={`h-full transition-all ${ARCHETYPE_BAR_FILL[archetype]}`}
              style={{ width: `${pct}%` }}
              title={`${ARCHETYPE_LABELS[archetype]}: ${count}`}
              aria-label={`${count} ${ARCHETYPE_LABELS[archetype]} moves`}
            />
          );
        })}
      </div>

      {/* ── Legend + cut/parked note ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {populated.map(archetype => (
          <span key={archetype} className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-[var(--radius-pill)] ${ARCHETYPE_ACCENT[archetype]}`}
            />
            <span className="t-caption-sm text-[var(--brand-text-muted)]">
              {ARCHETYPE_LABELS[archetype]}
            </span>
            <span className="t-caption-sm text-[var(--brand-text)]">
              {stance.byArchetype[archetype]}
            </span>
          </span>
        ))}

        {(stance.cut > 0 || stance.parked > 0) && (
          <span // muted-tier-ok: cut/parked is tertiary metadata, intentionally dimmed
            className="t-caption-sm text-[var(--brand-text-dim)] ml-auto"
            data-testid="stance-bar-cutparked"
          >
            {stance.cut > 0 && `${stance.cut} cut`}
            {stance.cut > 0 && stance.parked > 0 && ' · '}
            {stance.parked > 0 && `${stance.parked} parked`}
          </span>
        )}
      </div>
    </div>
  );
}
