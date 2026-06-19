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
export type { Archetype } from '../../shared/types/strategy-archetype';
export {
  ARCHETYPE_ORDER,
  ARCHETYPE_LABELS,
  REC_TYPE_ARCHETYPE,
  ARCHETYPE_HEADLINE_VERB,
  recArchetype,
} from '../../shared/types/strategy-archetype';
