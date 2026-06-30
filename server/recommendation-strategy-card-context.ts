/**
 * Derive a StrategyCardContext from a Recommendation (Strategy "The Issue" §7).
 *
 * A Recommendation has NO native `strategyCardContext` column — the strategic card metadata is
 * reconstructed from the rec's own fields when the rec is sent to the client and again when the
 * client greenlights it ("Act on this"). Spec §7 requires the rec→deliverable stamp AND the durable
 * content request to both carry "the rec's StrategyCardContext", so both call THIS single derivation
 * (the adapter for the deliverable payload; the act-on route for the request record) — keeping the
 * two stamps identical and never drifting.
 *
 * The mapping is deliberately conservative and lossless-where-available:
 *   - rationale   ← rec.insight (the human "why this matters")
 *   - priority    ← rec.priority (the rec's priority axis, as a string)
 *   - impressions ← rec.impressionsAtRisk (when non-zero)
 *   - intent      ← the `intent` opportunity component's rawValue (string), when present
 *   - volume      ← the `demand` opportunity component's rawValue (number), when present
 * Absent signals are simply omitted (all StrategyCardContext fields are optional), never fabricated.
 */
import type { Recommendation } from '../shared/types/recommendations.js';
import type { StrategyCardContext } from '../shared/types/content.js';

/** Read a numeric opportunity-component rawValue by dimension, or undefined. */
function componentNumber(rec: Recommendation, dimension: string): number | undefined {
  const comp = rec.opportunity?.components?.find((c) => c.dimension === dimension);
  return typeof comp?.rawValue === 'number' && Number.isFinite(comp.rawValue) ? comp.rawValue : undefined;
}

/** Read a string opportunity-component rawValue by dimension, or undefined. */
function componentString(rec: Recommendation, dimension: string): string | undefined {
  const comp = rec.opportunity?.components?.find((c) => c.dimension === dimension);
  return typeof comp?.rawValue === 'string' && comp.rawValue.trim() ? comp.rawValue.trim() : undefined;
}

export function buildStrategyCardContextFromRec(rec: Recommendation): StrategyCardContext {
  const ctx: StrategyCardContext = {
    rationale: rec.insight,
    priority: rec.priority,
  };
  const volume = componentNumber(rec, 'demand');
  if (volume !== undefined) ctx.volume = volume;
  const intent = componentString(rec, 'intent');
  if (intent) ctx.intent = intent;
  if (rec.impressionsAtRisk > 0) ctx.impressions = rec.impressionsAtRisk;
  return ctx;
}
