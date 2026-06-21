/**
 * Frontend consumer of the shared archetype contract.
 *
 * Re-exports every archetype symbol from `shared/types/strategy-archetype`
 * so frontend code imports from a single lib-level module (consistent with
 * `recCategoryMap.ts` → `src/lib/recCategoryMap.ts` precedent).
 *
 * The `recArchetype()` helper is re-exported verbatim; `REC_TYPE_ARCHETYPE`,
 * `ARCHETYPE_ORDER`, `ARCHETYPE_LABELS`, and `ARCHETYPE_HEADLINE_VERB` are
 * all available for callers that need the full maps.
 */
import type { Archetype } from '../../shared/types/strategy-archetype';

export type { Archetype } from '../../shared/types/strategy-archetype';
export {
  ARCHETYPE_ORDER,
  ARCHETYPE_LABELS,
  REC_TYPE_ARCHETYPE,
  ARCHETYPE_HEADLINE_VERB,
  recArchetype,
} from '../../shared/types/strategy-archetype';

/**
 * The SINGLE per-archetype accent (solid swatch / legend-dot / group-dot) color.
 *
 * This is the ONE source of truth imported by BOTH StanceBar (legend dot) and
 * BackingMovesQueue (group dot) so the stance allocation and the backing-moves
 * grouping agree on every archetype's color — previously they drifted (StanceBar
 * mapped authority_bet→teal while the queue mapped it→blue, the documented swap).
 *
 * Brand-law compliant (the Four Laws of Color):
 *   - authority_bet  → teal  (Law 1: action hue — new-content bets, the operator's offensive move)
 *   - refresh_reclaim→ blue  (Law 2: data hue — reclaiming earned positions)
 *   - quick_win      → emerald(Law 3: success/wins hue)
 *   - defend         → amber (risk / defend)
 *   - technical      → sky   (technical / infra)
 *   - local          → orange(local visibility)
 * No purple, no violet/indigo, no new hue families. Tailwind utility classes only
 * (no new tokens). Callers that need a lighter BAR FILL apply their own opacity.
 */
export const ARCHETYPE_ACCENT: Record<Archetype, string> = {
  authority_bet: 'bg-teal-400',
  refresh_reclaim: 'bg-blue-400',
  defend: 'bg-amber-400',
  quick_win: 'bg-emerald-400',
  technical: 'bg-sky-400',
  local: 'bg-orange-400',
};
