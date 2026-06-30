// ── Search-visibility score (0–100) ──────────────────────────────
// How much of the available search-click opportunity a site actually captures,
// weighted by search volume and the calibrated CTR-by-position curve. This is the
// one net-new top-line metric for the Strategy v2 "command center" Orient zone.
// Reuses the OV model's CTR curve (ctrAt) so the score is grounded in the same
// CTR-decay primitive, not an ad-hoc linear formula. See
// docs/superpowers/plans/2026-06-17-strategy-v2-command-center.md (Phase 0).

import { ctrAt } from './ctr-curve.js';

export interface VisibilityInput {
  /** Latest average ranking position (1-based). null/undefined = unranked. */
  position: number | null;
  /** Monthly search volume, used as the weight. null/undefined = unknown. */
  volume: number | null;
}

/** Median of a non-empty list of positive volumes (used as the fallback weight). */
function medianPositive(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Visibility score 0–100. 100 = every page ranks #1; 0 = nothing ranks.
 *
 *   numerator   = Σ wᵢ · ctrAt(positionᵢ)   — captured clicks (unranked page → 0)
 *   denominator = Σ wᵢ · ctrAt(1)            — clicks if everything ranked #1
 *
 * Weights wᵢ:
 *  - a page's own search volume when it has one;
 *  - the MEDIAN positive volume when a page's volume is null/0 but OTHER pages have
 *    volume (so a ranked page with unknown volume still counts — never silently
 *    dropped, which would zero out a site that demonstrably ranks);
 *  - 1 per page (unweighted mean) when NO page has a usable volume.
 *
 * Unranked pages still count in the denominator — lost opportunity drags the score
 * down. Positions beyond ctr-curve's MAX_TRACKED_POSITION (20) are clamped by ctrAt
 * to the position-20 CTR (≈0), so deep rankings contribute ≈0 visibility.
 *
 * Pure function: pass a calibrated curve from buildCtrCurve() to weight by the
 * workspace's own GSC CTR, or omit it for the industry curve.
 */
export function computeVisibilityScore(
  pages: VisibilityInput[],
  curve?: Record<number, number> | null,
): number {
  if (!pages || pages.length === 0) return 0;

  const best = ctrAt(1, curve); // CTR at position 1 per the curve — always > 0
  const weightOf = (v: number | null): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;

  const positives = pages.map((p) => weightOf(p.volume)).filter((w) => w > 0);
  const weighted = positives.length > 0;
  const fallback = weighted ? medianPositive(positives) : 1;

  let captured = 0;
  let potential = 0;
  for (const p of pages) {
    // Weighted mode: own volume, or the median positive volume when unknown (never 0,
    // so a ranked-but-null-volume page still participates). Unweighted mode: 1 each.
    const w = weighted ? weightOf(p.volume) || fallback : 1;
    potential += w * best;
    const pos = p.position;
    if (typeof pos === 'number' && Number.isFinite(pos) && pos >= 1) {
      captured += w * ctrAt(pos, curve);
    }
  }

  if (potential <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((captured / potential) * 100)));
}
