import type { LearningsSlice, PlatformPriorEntry } from '../shared/types/intelligence.js';
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

/**
 * A6 (audit #22): the platform-prior multiplier. Deliberately a SMALLER nudge than
 * `actionTypeMultiplier` — a cross-workspace benchmark is weaker evidence for THIS
 * workspace than its own measured history, so it pulls the score toward 1 less hard
 * and is clamped to a tighter band.
 */
function platformPriorMultiplier(winRate: number): number {
  if (winRate >= 0.65) return 1.07;
  if (winRate >= 0.5) return 1.035;
  if (winRate <= 0.25) return 0.93;
  if (winRate <= 0.4) return 0.965;
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

export interface PlatformPriorAdjustmentInput {
  actionType: ActionType;
  /**
   * The workspace's OWN learnings availability. This helper is the FALLBACK tier and
   * only acts when this is `no_data` or `degraded`. `ready` (own learnings win) and
   * `disabled` (kill-switch) both yield a no-op — the availability switch stays
   * authoritative (CLAUDE.md). `not_requested` is also a no-op.
   */
  availability: LearningsPromptAvailability | undefined;
  /** Published cross-workspace priors (from getPlatformPriors()). */
  platformPriors?: PlatformPriorEntry[] | null;
}

export interface PlatformPriorAdjustmentResult {
  /** Whether a platform prior was applied (true only on the no_data/degraded path). */
  applied: boolean;
  multiplier: number;
  /** The prior that was applied, for labeled prompt rendering. Null when none applied. */
  prior: PlatformPriorEntry | null;
  reasons: string[];
}

/**
 * A6 (audit #22): the cross-workspace platform-prior FALLBACK seam. When a workspace's
 * own learnings are `no_data` or `degraded`, this layers a small, clearly-labeled
 * nudge from the platform-wide win rate for the action type — instead of nothing.
 *
 * AUTHORITY: the workspace's own `availability` stays the source of truth. A `ready`
 * workspace must run `buildOutcomeAdjustment` (own history) and NOT this helper; a
 * `disabled`/`not_requested` workspace gets a no-op. Callers do NOT re-check feature
 * flags — they switch on the availability the builders already returned.
 *
 * HONESTY: reasons label the rate as cross-workspace ("across all clients on the
 * platform"), never as the workspace's own result. Absence of a prior for the action
 * type is a no-op (FM-2), never a fabricated baseline.
 */
export function buildPlatformPriorAdjustment(
  input: PlatformPriorAdjustmentInput,
): PlatformPriorAdjustmentResult {
  const noop: PlatformPriorAdjustmentResult = { applied: false, multiplier: 1, prior: null, reasons: [] };
  if (input.availability !== 'no_data' && input.availability !== 'degraded') return noop;

  const prior = input.platformPriors?.find(p => p.actionType === input.actionType);
  if (!prior || !Number.isFinite(prior.winRate) || prior.winRate < 0) return noop;

  const rawMultiplier = platformPriorMultiplier(prior.winRate);
  if (rawMultiplier === 1) {
    // Mid-band prior: no score nudge, but still surface the labeled benchmark.
    return {
      applied: true,
      multiplier: 1,
      prior,
      reasons: [`Across all clients on the platform, ${input.actionType} wins about ${Math.round(prior.winRate * 100)}% of the time (this workspace has no measured outcomes of its own yet)`],
    };
  }

  const multiplier = Math.max(0.9, Math.min(1.1, Number(rawMultiplier.toFixed(3))));
  const direction = multiplier > 1 ? 'tends to perform well' : 'tends to underperform';
  return {
    applied: true,
    multiplier,
    prior,
    reasons: [`Across all clients on the platform, ${input.actionType} ${direction} (${Math.round(prior.winRate * 100)}% win rate; this workspace has no measured outcomes of its own yet)`],
  };
}

/**
 * A6 (audit #22): render the labeled cross-workspace fallback line for a no_data /
 * degraded workspace. Returns '' when there are no priors to surface. The label is
 * always explicit that this is platform-wide data, never the workspace's own — a
 * client must never see platform stats presented as their stats.
 */
export function buildPlatformPriorPromptNote(
  availability: LearningsPromptAvailability | undefined,
  platformPriors: PlatformPriorEntry[] | null | undefined,
): string {
  if (availability !== 'no_data' && availability !== 'degraded') return '';
  if (!platformPriors || platformPriors.length === 0) return '';
  const sorted = [...platformPriors].sort((a, b) => b.winRate - a.winRate).slice(0, 5);
  const items = sorted
    .map(p => `${p.actionType} ~${Math.round(p.winRate * 100)}%`)
    .join(', ');
  return `As a cross-workspace benchmark only (NOT this workspace's own results), action types win at roughly these rates across all clients on the platform: ${items}. Treat these as general priors, not measured wins for this client.`;
}

export function buildOutcomeLearningStatusNote(
  availability: LearningsPromptAvailability | undefined,
  domain: LearningsDomain,
  platformPriors?: PlatformPriorEntry[] | null,
): string {
  let base: string;
  switch (availability) {
    case 'disabled':
      base = `Outcome learnings are disabled for this workspace, so rely on general ${domain === 'all' ? 'platform' : domain} best practices instead of prior measured wins.`;
      break;
    case 'no_data':
      base = `Outcome learnings are enabled, but this workspace does not yet have enough measured ${domain === 'all' ? '' : `${domain} `}outcomes to influence this decision. Use general best practices until more results are recorded.`.replace('  ', ' ');
      break;
    case 'degraded':
      base = `Outcome learnings could not be loaded for this run, so avoid assuming prior measured wins or losses in this recommendation.`;
      break;
    default:
      return '';
  }
  // A6: append the labeled cross-workspace benchmark only on the fallback tiers. The
  // `disabled` kill-switch deliberately suppresses platform priors too — when an admin
  // turns learnings OFF for a workspace, that intent extends to platform priors.
  const priorNote = buildPlatformPriorPromptNote(availability, platformPriors);
  return priorNote ? `${base} ${priorNote}` : base;
}
