/**
 * Stance derivation for "The Issue" cockpit (Phase 1 Lane A).
 *
 * `deriveStance` computes the per-archetype active count + cut/parked
 * summary from a raw recommendation list. It mirrors the throttle-expiry clause
 * of the server's `isActiveRec` (see server/recommendations.ts) for the FE context:
 *
 *   - lifecycle === 'struck'              → cut (permanently suppressed)
 *   - throttled AND throttledUntil future → parked (hidden until the window passes)
 *   - throttled BUT throttledUntil past   → active (the throttle expired and the rec
 *                                            auto-resurfaces on read) — counted per archetype
 *   - anything else                       → active, counted per archetype
 *
 * Throttle-expiry is the one rule shared with `cockpitRowModel.isThrottledOpen`, reused here so the
 * stance bar and the cockpit never diverge. NOTE: clientStatus is NOT filtered here (unlike full
 * isActiveRec, which also drops sent/approved/declined) — this counts the operator-facing stance
 * over the FULL rec list. Callers that want the active admin-queue slice filter upstream.
 */
import type { Recommendation } from '../../shared/types/recommendations';
import type { Archetype } from '../../shared/types/strategy-archetype';
import {
  ARCHETYPE_ORDER,
  ARCHETYPE_HEADLINE_VERB,
  recArchetype,
} from '../../shared/types/strategy-archetype';
import { isThrottledOpen } from '../components/strategy/cockpitRowModel';

export interface StanceResult {
  /** Active rec count per archetype (excludes struck and throttled). */
  byArchetype: Record<Archetype, number>;
  /** Count of permanently suppressed recs (lifecycle === 'struck'). */
  cut: number;
  /** Count of temporarily hidden recs (throttled with throttledUntil still in the future).
   *  An EXPIRED throttle is NOT parked — it counts in its archetype active bucket. */
  parked: number;
  /**
   * MarketMuse-style "create / refresh / defend" headline totals.
   * Derived from `ARCHETYPE_HEADLINE_VERB`; `other` (technical/local) is
   * excluded from these three counts.
   */
  createRefreshDefend: { create: number; refresh: number; defend: number };
}

/** Initialize a zero-count archetype record covering all 6 buckets. */
function zeroByArchetype(): Record<Archetype, number> {
  return ARCHETYPE_ORDER.reduce((acc, a) => {
    acc[a] = 0;
    return acc;
  }, {} as Record<Archetype, number>);
}

export function deriveStance(recs: Recommendation[]): StanceResult {
  const byArchetype = zeroByArchetype();
  let cut = 0;
  let parked = 0;
  const crd = { create: 0, refresh: 0, defend: 0 };

  for (const rec of recs) {
    if (rec.lifecycle === 'struck') {
      cut++;
      continue;
    }
    // Parked only while the throttle window is still OPEN — an expired throttle auto-resurfaces and
    // is counted as active below (mirrors isActiveRec / cockpitRowModel.isThrottledOpen).
    if (isThrottledOpen(rec)) {
      parked++;
      continue;
    }
    // Active (or no lifecycle field — legacy recs default to 'active'; expired throttle resurfaces)
    const archetype = recArchetype(rec.type);
    byArchetype[archetype]++;

    const verb = ARCHETYPE_HEADLINE_VERB[archetype];
    if (verb === 'create') crd.create++;
    else if (verb === 'refresh') crd.refresh++;
    else if (verb === 'defend') crd.defend++;
    // 'other' (technical/local) intentionally not counted in crd
  }

  return { byArchetype, cut, parked, createRefreshDefend: crd };
}
