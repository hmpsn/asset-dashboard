/**
 * Composable score adjustment system for bridge-modified insights.
 *
 * Multiple bridges can independently adjust an insight's impactScore without
 * overwriting each other. Each bridge writes a named delta into _scoreAdjustments.
 * Final score = _originalBaseScore + sum(all deltas), clamped to [0, 100].
 *
 * Usage in bridges:
 *   const { data, adjustedScore } = applyScoreAdjustment(insight.data, insight.impactScore, 'outcome', -10);
 *   upsertInsight({ ...insight, data, impactScore: adjustedScore });
 */

interface ScoreAdjustmentResult {
  /** Updated data object with _originalBaseScore and _scoreAdjustments */
  data: Record<string, unknown>;
  /** Final clamped score: base + sum(adjustments) */
  adjustedScore: number;
}

/**
 * Apply a named score adjustment to an insight's data.
 *
 * @param currentData - The insight's current data JSON (may already contain adjustments)
 * @param currentImpactScore - The insight's current impactScore (used as base if no _originalBaseScore exists)
 * @param bridgeKey - Unique key for this bridge's adjustment (e.g., 'outcome', 'anomaly')
 * @param delta - Score delta to apply (positive = boost, negative = penalty). 0 removes the adjustment.
 */
export function applyScoreAdjustment(
  currentData: Record<string, unknown>,
  currentImpactScore: number,
  bridgeKey: string,
  delta: number,
): ScoreAdjustmentResult {
  // Preserve the original base score — only set it on first adjustment
  const originalBase = (typeof currentData._originalBaseScore === 'number')
    ? currentData._originalBaseScore
    : currentImpactScore;

  // Clone existing adjustments or start fresh
  const existingAdj = (
    currentData._scoreAdjustments != null &&
    typeof currentData._scoreAdjustments === 'object' &&
    !Array.isArray(currentData._scoreAdjustments)
  )
    ? { ...(currentData._scoreAdjustments as Record<string, number>) }
    : {};

  // Set or remove this bridge's adjustment
  if (delta === 0) {
    delete existingAdj[bridgeKey];
  } else {
    existingAdj[bridgeKey] = delta;
  }

  // Compute final score: base + sum(all adjustments)
  const totalDelta = Object.values(existingAdj).reduce((sum, d) => sum + d, 0);
  const adjustedScore = Math.max(0, Math.min(100, originalBase + totalDelta));

  return {
    data: {
      ...currentData,
      _originalBaseScore: originalBase,
      _scoreAdjustments: existingAdj,
    },
    adjustedScore,
  };
}

/**
 * Read-only: compute what the adjusted score would be from existing data.
 * Useful for display or comparison without mutating.
 */
export function computeAdjustedScore(
  data: Record<string, unknown>,
  currentImpactScore: number,
): number {
  if (typeof data._originalBaseScore !== 'number') return currentImpactScore;
  const adj = data._scoreAdjustments as Record<string, number> | undefined;
  if (!adj || typeof adj !== 'object') return currentImpactScore;
  const totalDelta = Object.values(adj).reduce((sum, d) => sum + d, 0);
  return Math.max(0, Math.min(100, data._originalBaseScore + totalDelta));
}
