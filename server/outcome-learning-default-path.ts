import type { LearningsSlice } from '../shared/types/intelligence.js';
import type { ActionType } from '../shared/types/outcome-tracking.js';

type LearningsAvailability = LearningsSlice['availability'];
type LearningsPromptAvailability = LearningsAvailability | 'not_requested';
type LearningsDomain = 'content' | 'strategy' | 'technical' | 'all';

export interface OutcomeAdjustmentInput {
  actionType: ActionType;
  learnings?: LearningsSlice | null;
  difficulty?: number | null;
}

export interface OutcomeAdjustmentResult {
  availability: LearningsAvailability;
  multiplier: number;
  reasons: string[];
}

function getDifficultyRangeLabel(difficulty: number): string {
  if (difficulty <= 20) return '0-20';
  if (difficulty <= 40) return '21-40';
  if (difficulty <= 60) return '41-60';
  if (difficulty <= 80) return '61-80';
  return '81-100';
}

function actionTypeMultiplier(winRate: number): number {
  if (winRate >= 0.65) return 1.14;
  if (winRate >= 0.5) return 1.07;
  if (winRate <= 0.25) return 0.86;
  if (winRate <= 0.4) return 0.93;
  return 1;
}

function difficultyMultiplier(winRate: number): number {
  if (winRate >= 0.6) return 1.12;
  if (winRate >= 0.45) return 1.05;
  if (winRate <= 0.25) return 0.88;
  if (winRate <= 0.35) return 0.94;
  return 1;
}

/**
 * A1 — difficulty-multiplier UNIT MISMATCH seam. DISABLED until rebinned.
 *
 * The difficulty multiplier matches `input.difficulty` (provider keyword
 * difficulty, KD 0–100 where LOW = easy) against `winRateByDifficultyRange` bins.
 * But those bins are populated by `computeStrategyLearnings` in
 * `server/workspace-learnings.ts:216-226`, which bins by GSC **position** (a
 * baseline position >= 51 lands in the '0-20' label). So a KD-15 (easy) keyword is
 * scored against a cohort that actually holds position->=51 (hard-to-rank)
 * keywords — the multiplier is applied to the WRONG cohort, distorting scores.
 *
 * Until the producer (position bins) and consumer (KD bins) agree on a unit, the
 * difficulty contribution returns 1.0 (no-op). The action-type multiplier is
 * unaffected. Flip to `true` only once both sides bin on the same scale.
 */
const DIFFICULTY_MULTIPLIER_ENABLED = false;

export function buildOutcomeAdjustment(input: OutcomeAdjustmentInput): OutcomeAdjustmentResult {
  const learnings = input.learnings;
  if (!learnings) return { availability: 'no_data', multiplier: 1, reasons: [] };
  if (learnings.availability !== 'ready') {
    return { availability: learnings.availability, multiplier: 1, reasons: [] };
  }

  let multiplier = 1;
  const reasons: string[] = [];

  const actionTypeRate = learnings.winRateByActionType?.[input.actionType];
  if (typeof actionTypeRate === 'number' && Number.isFinite(actionTypeRate) && actionTypeRate >= 0) {
    const actionMultiplier = actionTypeMultiplier(actionTypeRate);
    multiplier *= actionMultiplier;
    if (actionMultiplier > 1) {
      reasons.push(`${input.actionType} has performed well for this workspace (${Math.round(actionTypeRate * 100)}% win rate)`);
    } else if (actionMultiplier < 1) {
      reasons.push(`${input.actionType} has underperformed for this workspace (${Math.round(actionTypeRate * 100)}% win rate)`);
    }
  }

  const difficulty = input.difficulty;
  const difficultyRates = learnings.summary?.strategy?.winRateByDifficultyRange;
  // A1: difficulty multiplier disabled until the position-bin (producer) vs KD-bin
  // (consumer) unit mismatch is resolved — see DIFFICULTY_MULTIPLIER_ENABLED above.
  if (DIFFICULTY_MULTIPLIER_ENABLED && typeof difficulty === 'number' && Number.isFinite(difficulty) && difficultyRates) {
    const label = getDifficultyRangeLabel(difficulty);
    const difficultyRate = difficultyRates[label];
    if (typeof difficultyRate === 'number' && Number.isFinite(difficultyRate) && difficultyRate >= 0) {
      const rangeMultiplier = difficultyMultiplier(difficultyRate);
      multiplier *= rangeMultiplier;
      if (rangeMultiplier > 1) {
        reasons.push(`Difficulty range ${label} has been a strong performer (${Math.round(difficultyRate * 100)}% win rate)`);
      } else if (rangeMultiplier < 1) {
        reasons.push(`Difficulty range ${label} has underperformed (${Math.round(difficultyRate * 100)}% win rate)`);
      }
    }
  }

  return {
    availability: 'ready',
    multiplier: Math.max(0.75, Math.min(1.25, Number(multiplier.toFixed(3)))),
    reasons,
  };
}

export function applyOutcomeAdjustmentScore(
  baseScore: number,
  adjustment: OutcomeAdjustmentResult,
): number {
  return Math.max(0, Math.min(100, Math.round(baseScore * adjustment.multiplier)));
}

export function buildOutcomeLearningStatusNote(
  availability: LearningsPromptAvailability | undefined,
  domain: LearningsDomain,
): string {
  switch (availability) {
    case 'disabled':
      return `Outcome learnings are disabled for this workspace, so rely on general ${domain === 'all' ? 'platform' : domain} best practices instead of prior measured wins.`;
    case 'no_data':
      return `Outcome learnings are enabled, but this workspace does not yet have enough measured ${domain === 'all' ? '' : `${domain} `}outcomes to influence this decision. Use general best practices until more results are recorded.`.replace('  ', ' ');
    case 'degraded':
      return `Outcome learnings could not be loaded for this run, so avoid assuming prior measured wins or losses in this recommendation.`;
    default:
      return '';
  }
}
