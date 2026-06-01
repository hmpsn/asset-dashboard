// ── CTR-by-position curve ────────────────────────────────────────
// The Opportunity Value scorer values a ranking change by the click uplift
// of moving from position A to position B. That requires a CTR(position) curve.
// To avoid the curve itself becoming ungrounded magic, we calibrate it from the
// workspace's OWN GSC history (per-keyword {clicks, impressions, position}) and
// only fall back to a documented industry curve when there is too little data.
// The chosen source is returned so callers can log it as evidence.
// See docs/designs/2026-05-31-opportunity-value-model.md §2.2.

export type CtrCurveSource = 'calibrated' | 'blended' | 'industry';

export interface CtrCurve {
  /** position (1..MAX_TRACKED_POSITION) → click-through rate (0..1).
   *  ALWAYS monotonic non-increasing (a better position never has a lower CTR) —
   *  the uplift math `ctr(target) - ctr(current)` depends on this guarantee. */
  curve: Record<number, number>;
  source: CtrCurveSource;
  /** total impressions observed across the workspace's GSC keywords (the calibration weight) */
  observations: number;
}

export interface GscKeywordObservation {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

export const MAX_TRACKED_POSITION = 20;

/** Minimum total impressions before we trust per-workspace calibration over the
 *  industry fallback. Below this we use the industry curve; at/above we blend. */
export const MIN_CALIBRATION_IMPRESSIONS = 500;

/** Documented industry organic CTR-by-position fallback (desktop+mobile blended,
 *  publicly reported aggregate ranges). Used only until a workspace has enough
 *  of its own GSC signal. Monotonically non-increasing by design. */
const INDUSTRY_CTR: Record<number, number> = {
  1: 0.280, 2: 0.150, 3: 0.100, 4: 0.070, 5: 0.050,
  6: 0.040, 7: 0.030, 8: 0.025, 9: 0.020, 10: 0.018,
  11: 0.014, 12: 0.012, 13: 0.011, 14: 0.010, 15: 0.009,
  16: 0.008, 17: 0.007, 18: 0.006, 19: 0.0055, 20: 0.005,
};

/** Industry CTR for a (possibly fractional / out-of-range) position. */
export function industryCtr(position: number): number {
  if (!Number.isFinite(position) || position < 1) return INDUSTRY_CTR[1];
  const p = Math.min(MAX_TRACKED_POSITION, Math.round(position));
  return INDUSTRY_CTR[p] ?? INDUSTRY_CTR[MAX_TRACKED_POSITION];
}

/**
 * Build a position→CTR curve from a workspace's own GSC keyword observations,
 * falling back to (and blending with) the industry curve when data is sparse.
 *
 * - source 'industry'   : no usable observations → pure industry curve.
 * - source 'blended'    : some data, below MIN_CALIBRATION_IMPRESSIONS → observed
 *                         buckets used where present, industry elsewhere.
 * - source 'calibrated' : enough data → impression-weighted observed CTR per bucket,
 *                         industry only for positions with no observations.
 */
export function buildCtrCurve(observations?: GscKeywordObservation[] | null): CtrCurve {
  const industry = (): Record<number, number> => ({ ...INDUSTRY_CTR });

  if (!observations || observations.length === 0) {
    return { curve: industry(), source: 'industry', observations: 0 };
  }

  // Aggregate clicks + impressions into integer position buckets.
  const clicksByPos: Record<number, number> = {};
  const imprByPos: Record<number, number> = {};
  let totalImpr = 0;
  for (const o of observations) {
    if (!o || !Number.isFinite(o.position) || o.position < 1) continue;
    const impr = Number.isFinite(o.impressions) ? Math.max(0, o.impressions) : 0;
    const clk = Number.isFinite(o.clicks) ? Math.max(0, o.clicks) : 0;
    if (impr === 0) continue;
    const p = Math.min(MAX_TRACKED_POSITION, Math.round(o.position));
    clicksByPos[p] = (clicksByPos[p] ?? 0) + clk;
    imprByPos[p] = (imprByPos[p] ?? 0) + impr;
    totalImpr += impr;
  }

  if (totalImpr === 0) {
    return { curve: industry(), source: 'industry', observations: 0 };
  }

  // Beta-binomial shrinkage toward the industry prior, weighted by observed
  // impressions, so a sparse/noisy bucket cannot swing far from the prior.
  // PRIOR_IMPRESSIONS is the prior strength (pseudo-impressions at industry CTR).
  const PRIOR_IMPRESSIONS = 200;
  const curve: Record<number, number> = {};
  for (let p = 1; p <= MAX_TRACKED_POSITION; p++) {
    const impr = imprByPos[p] ?? 0;
    if (impr > 0) {
      const shrunk = (clicksByPos[p] + PRIOR_IMPRESSIONS * INDUSTRY_CTR[p]) / (impr + PRIOR_IMPRESSIONS);
      curve[p] = Math.min(1, shrunk);
    } else {
      curve[p] = INDUSTRY_CTR[p];
    }
  }

  // Enforce monotonic non-increasing: a better position must never carry a lower
  // CTR than a worse one. Without this, a noisy observed bucket could invert the
  // curve and make `ctr(target) - ctr(current)` negative → a real striking-distance
  // keyword would be clamped to a 0 uplift and silently score 0.
  for (let p = 2; p <= MAX_TRACKED_POSITION; p++) {
    if (curve[p] > curve[p - 1]) curve[p] = curve[p - 1];
  }

  const source: CtrCurveSource = totalImpr >= MIN_CALIBRATION_IMPRESSIONS ? 'calibrated' : 'blended';
  return { curve, source, observations: totalImpr };
}

/** Look up the CTR for a position against a built curve, with industry fallback. */
export function ctrAt(position: number, curve?: Record<number, number> | null): number {
  if (!Number.isFinite(position) || position < 1) {
    return curve?.[1] ?? industryCtr(1);
  }
  const p = Math.min(MAX_TRACKED_POSITION, Math.round(position));
  return curve?.[p] ?? industryCtr(p);
}
