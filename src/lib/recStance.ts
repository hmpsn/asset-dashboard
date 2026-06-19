/**
 * Stance derivation for "The Issue" cockpit (Phase 1 Lane A).
 *
 * `deriveStance` computes the per-archetype active count + cut/parked
 * summary from a raw recommendation list. It follows `isActiveRec` semantics
 * (see server/recommendations.ts) for the FE context:
 *
 *   - lifecycle === 'struck'    → cut (permanently suppressed)
 *   - lifecycle === 'throttled' → parked (hidden until throttledUntil)
 *   - anything else             → active, counted per archetype
 *
 * NOTE: `isCuratedForClient` and `isActiveRec` overlap on `discussing`; this
 * function counts from the FULL rec list, not only the curated-for-client set.
 * Callers that want only the active admin-queue slice filter upstream.
 */
import type { Recommendation } from '../../shared/types/recommendations';
import type { Archetype } from '../../shared/types/strategy-archetype';
import {
  ARCHETYPE_ORDER,
  ARCHETYPE_HEADLINE_VERB,
  recArchetype,
} from '../../shared/types/strategy-archetype';

export interface StanceResult {
  /** Active rec count per archetype (excludes struck and throttled). */
  byArchetype: Record<Archetype, number>;
  /** Count of permanently suppressed recs (lifecycle === 'struck'). */
  cut: number;
  /** Count of temporarily hidden recs (lifecycle === 'throttled'). */
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
    if (rec.lifecycle === 'throttled') {
      parked++;
      continue;
    }
    // Active (or no lifecycle field — legacy recs default to 'active')
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
