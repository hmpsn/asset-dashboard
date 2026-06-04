/**
 * ov-calibration — per-workspace realized-$ calibration for the Opportunity Value
 * scorer (PR5 · Spine C / §4 Spine E).
 *
 * computeOvCalibration(workspaceId) returns a multiplier in [0.75, 1.25] that the
 * scorer applies to roiPerEffortDay (computeOpportunityValue opts.calibration).
 *
 * ══ IDENTITY-SAFE (day-one no-op) ══
 * Returns 1.0 (identity) when there are fewer than MIN_OUTCOMES (5) qualifying
 * outcomes for the workspace. Calibration is default-on but remains inert until
 * a workspace has accrued real outcomes.
 *
 * ══ CALIBRATION BASIS (documented choice) ══
 * The design's preferred basis is median(realized attributed_value / predicted EMV)
 * per workspace. PREDICTED EMV IS NOT RECOVERABLE from action_outcomes today — the
 * table (migration 106) persists only the REALIZED `attributed_value` (clicks-delta ×
 * CPC) and a conclusive `score`, with no stored prediction to divide by. So this PR
 * ships the documented fallback: a WIN-RATE-DERIVED proxy over the workspace's
 * conclusive outcomes that carry a realized attributed_value.
 *
 *   realization = mean(scoreWeight) over N qualifying outcomes,
 *                 where strong_win/win = 1.0, neutral = 0.5 (a modest realized gain,
 *                 NOT a loss), loss = 0.0
 *   calibration = clamp(0.75, 1.25, 0.75 + 0.5 × realization)
 *
 * Interpretation: a 0.5 realization (all-neutral, or balanced win/loss) maps to 1.0
 * (the model's neutral expectation);
 * a workspace whose acted-on opportunities realize value more often than not gets a
 * gentle upward nudge (capped at 1.25), and a chronically under-delivering workspace
 * a downward one (floored at 0.75). When realized-EMV-vs-predicted-EMV becomes
 * recoverable, swap the basis here — the clamp + identity-gate contract stays the same.
 * P4 SHIPPED the `predicted_emv` snapshot (CalibrationOutcome.predictedEmv, from the
 * tracked_actions.predicted_emv column) so the realized-vs-predicted pairing now accrues,
 * but P4 deliberately does NOT change the calibration basis — it stays score-weighted
 * realization until P6 threads GA4 estimatedRevenue into attributed_value and flips this
 * to median(attributedValue / predictedEmv) per (actionType, difficultyBucket).
 *
 * Pure-ish + safe: the only side-effect-free-violating reads are the flag check and
 * the outcome read; any throw degrades to 1.0 (identity) so calibration can never
 * break or skew rec generation.
 */
import { getCalibrationOutcomes } from '../outcome-tracking.js';
import { createLogger } from '../logger.js';

const log = createLogger('ov-calibration');

/** Minimum qualifying outcomes before calibration deviates from identity. */
export const MIN_OUTCOMES = 5;

/** Calibration is clamped to this band (mirrors computeOpportunityValue's clamp). */
const CALIBRATION_FLOOR = 0.75;
const CALIBRATION_CEIL = 1.25;

// Weighted realization score per outcome. `neutral` is NOT a loss — it is a modest
// realized gain — so it weighs 0.5 (a workspace whose actions all land neutral maps
// to the identity 1.0, not the 0.75 floor). insufficient_data/inconclusive are
// already excluded by the query.
const SCORE_WEIGHT: Record<string, number> = {
  strong_win: 1.0,
  win: 1.0,
  neutral: 0.5,
  loss: 0.0,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Per-workspace OV calibration multiplier in [0.75, 1.25]. Identity (1.0) when the
 * there are fewer than MIN_OUTCOMES qualifying outcomes.
 */
export function computeOvCalibration(workspaceId: string): number {
  try {
    const outcomes = getCalibrationOutcomes(workspaceId);
    if (outcomes.length < MIN_OUTCOMES) return 1.0;

    // Weighted realization rate over qualifying outcomes (neutral counts 0.5).
    const realization = outcomes.reduce((sum, o) => sum + (SCORE_WEIGHT[o.score] ?? 0.5), 0) / outcomes.length;
    return clamp(CALIBRATION_FLOOR + 0.5 * realization, CALIBRATION_FLOOR, CALIBRATION_CEIL);
  } catch (err) { // catch-ok: calibration is non-critical — any failure degrades to identity (1.0)
    log.debug({ err, workspaceId }, 'computeOvCalibration: degrading to identity (1.0)');
    return 1.0;
  }
}
