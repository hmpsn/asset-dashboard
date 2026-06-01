// ── Unified Opportunity Value scorer ─────────────────────────────
// THE single scoring function every recommendation producer calls. Replaces the
// per-branch magic-constant scales (60/35/15, 75/55/35, 60/40, impressions/50…)
// with one data-grounded Expected-Monetary-Value model:
//
//   emvPerWeek      = expectedClickDelta × valuePerClick
//   roiPerEffortDay = emvPerWeek × HorizonWeeks × businessFit × confidence × calibration × timing ÷ effortDays
//   value (0..100)  = normalizeToScore(roiPerEffortDay)   → written to Recommendation.impactScore
//
// Pure & side-effect-free (no DB, no clock, no randomness) so it is fully unit-
// testable and identical in shadow vs live. See docs/designs/2026-05-31-opportunity-value-model.md.
//
// GROUNDED SPINES: quick_win consumes roiScore, content_gap consumes opportunityScore
// (the persisted composites the audit found discarded). A grounded composite always
// produces a positive click-delta, and ungrounded LLM-only items are held below
// grounded ones by both the confidence discount AND a conservative effort floor —
// so the grounded-beats-ungrounded invariant (design §2.4) holds cross-branch.
//
// CONSTANTS POLICY: every constant below either traces to a grounded field or
// carries a calibration path (P5 workspace_opportunity_weights / outcome calibration).
// No naked magic — the pr-check "magic-scale guard" (added P3) enforces this.

import type {
  OpportunityInput,
  OpportunityScore,
  OpportunityComponent,
  OpportunityWeights,
  OpportunityDimension,
  Recommendation,
} from '../../shared/types/recommendations.js';
import { classifyKdGap } from '../authority-context.js';
import { ctrAt } from './ctr-curve.js';

export const MODEL_VERSION = 'ov-1';

/** Value horizon: weekly EMV is projected over this many weeks. Calibration path:
 *  outcome time-to-measure (P5) will tune this per action type. */
const HORIZON_WEEKS = 12;

/** Default effort (person-days) per branch. Calibration path: P5 derives real
 *  time-to-implement from action_outcomes once history accrues. */
const DEFAULT_EFFORT_DAYS: Record<OpportunityInput['branch'], number> = {
  quick_win: 1,
  ranking_opp: 5,
  content_gap: 5,
  decay: 2,
  technical: 0.5,
  freshness: 0.5,
  diagnostic: 2,
};

/** Lower bound on effort so a zero/negative caller override cannot inflate ROI. */
const MIN_EFFORT_DAYS = 0.25;

/** Ungrounded (LLM-label / heuristic) items are scored at this minimum effort so a
 *  hyped low-effort guess cannot ride a small divisor above a grounded opportunity.
 *  Rationale: when we don't actually know the opportunity, we don't get to assume
 *  it is a quick win. Together with the confidence discount this enforces the
 *  grounded-beats-ungrounded invariant across branches. */
const UNGROUNDED_MIN_EFFORT_DAYS = 5;

/** Intent → value-per-click weight. Commercial-value (rubric dim 3). When CPC is
 *  present, valuePerClick = cpc × intentWeight; otherwise intentWeight is the proxy. */
const INTENT_WEIGHT: Record<NonNullable<OpportunityInput['intent']>, number> = {
  transactional: 1.0,
  commercial: 0.7,
  informational: 0.3,
  navigational: 0.2,
};
const DEFAULT_INTENT_WEIGHT = 0.5;

/** KD-vs-authority winnability multiplier, reused from the authority module so
 *  the OV scorer and the existing adjustKdImpactScore agree. Mirrors
 *  KD_SCORE_MULTIPLIER in authority-context.ts (0.6 / 0.8 / 1.0 / 1.2). */
const WINNABILITY_MULTIPLIER: Record<ReturnType<typeof classifyKdGap>, number> = {
  'very-challenging': 0.6,
  'challenging': 0.8,
  'aligned': 1.0,
  'within-reach': 1.2,
};
const MAX_WINNABILITY = 1.2;

/** Provenance → confidence. The LLM "high/medium/low" label lands here as a
 *  DISCOUNT, never as a score. Grounded-beats-ungrounded invariant (design §2.4). */
const CONFIDENCE = {
  groundedProvider: 1.0,   // real volume + position
  groundedComposite: 0.95, // roiScore / opportunityScore present
  llmLabel: 0.5,           // only an LLM adjective
  heuristic: 0.4,          // pure fallback
} as const;

/** Default display weights for the explainability breakdown (sum ≈ 1).
 *  Calibration path: P5 workspace_opportunity_weights ridge-nudges these. */
export const DEFAULT_WEIGHTS: OpportunityWeights = {
  demand: 0.22,
  winnability: 0.20,
  intent: 0.18,
  effort: 0.12,
  businessFit: 0.13,
  timing: 0.08,
  evidence: 0.07,
  calibrationVersion: 'platform-default',
};

/** Demand display-normalization ceiling (volume/impressions → 0..1 bar). Display-only. */
const DEMAND_CEILING = 5000;

/** Severity → fraction of a page's own traffic value that a technical fix can
 *  recover. Bounded < 1 so a technical fix cannot outrank a grounded commercial
 *  opportunity of comparable traffic (closes Q1). */
const SEVERITY_LIFT = { error: 0.15, warning: 0.07, info: 0.02 } as const;
const CRITICAL_LIFT_MULT = 1.5;

/** Stale-content recoverable CTR gap (freshness branch). */
const FRESHNESS_CTR_GAP = 0.02;

/** Repeat-decay tactic penalty: a page that already burned a refresh and kept
 *  declining is a worse bet for the same play (closes MW5). */
const REPEAT_DECAY_FACTOR = 0.4;

/** Fallback weekly click-delta for an ungrounded LLM-labelled item with no metrics.
 *  Small + then discounted by CONFIDENCE.llmLabel and the ungrounded effort floor so
 *  it cannot dominate a grounded opportunity (design §2.4 invariant). */
const LLM_FALLBACK_CLICKDELTA: Record<NonNullable<OpportunityInput['llmLabel']>, number> = {
  high: 12,
  medium: 6,
  low: 2,
};

/** Locale-stable integer formatting so the persisted/client-visible evidence
 *  string is deterministic regardless of server locale (purity contract). */
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function intentWeight(intent: OpportunityInput['intent']): number {
  return intent ? INTENT_WEIGHT[intent] : DEFAULT_INTENT_WEIGHT;
}

function winnability(difficulty: number | null, authorityStrength: number | null): number {
  // No KD or no authority signal → neutral (aligned) winnability.
  if (difficulty == null || !authorityStrength) return WINNABILITY_MULTIPLIER.aligned;
  return WINNABILITY_MULTIPLIER[classifyKdGap(difficulty, authorityStrength)];
}

function provenanceConfidence(input: OpportunityInput): { confidence: number; spine: OpportunityScore['groundedSpine'] } {
  const hasProvider = num(input.volume) != null && num(input.currentPosition) != null;
  const hasRoi = num(input.roiScore) != null;
  const hasOpp = num(input.opportunityScore) != null;
  if (hasProvider) return { confidence: CONFIDENCE.groundedProvider, spine: hasRoi ? 'roiScore' : hasOpp ? 'opportunityScore' : 'computed' };
  if (hasRoi || hasOpp) return { confidence: CONFIDENCE.groundedComposite, spine: hasRoi ? 'roiScore' : 'opportunityScore' };
  if (input.llmLabel) return { confidence: CONFIDENCE.llmLabel, spine: 'computed' };
  return { confidence: CONFIDENCE.heuristic, spine: 'computed' };
}

/** Target position a ranking change aims for: top-of-page (3) when below it,
 *  else one place up (capped at 1). */
function targetPosition(currentPosition: number | null): number {
  if (currentPosition == null) return 3;
  if (currentPosition <= 3) return Math.max(1, currentPosition - 1);
  return 3;
}

/** CTR uplift of moving from current position to the realistic target. */
function ctrUplift(input: OpportunityInput): number {
  const curve = input.ctrCurve ?? null;
  const pos = num(input.currentPosition);
  return Math.max(0, ctrAt(targetPosition(pos), curve) - ctrAt(pos ?? 20, curve));
}

/**
 * Expected weekly click delta — type-specific, always grounded where data exists.
 * Grounded composites (roiScore / opportunityScore) are consumed numerically as the
 * spine for their branch, so a strong composite never collapses to a 0 score even
 * when provider volume is absent (closes Q6/MW1/CC1/IW1 + the §2.4 invariant).
 */
function expectedClickDelta(input: OpportunityInput): number {
  const volume = num(input.volume);
  const win = winnability(num(input.difficulty), num(input.authorityStrength));
  const roiScore = num(input.roiScore);
  const opportunityScore = num(input.opportunityScore);

  switch (input.branch) {
    case 'quick_win': {
      // Grounded spine: the persisted roiScore composite (volume·(1−KD/100)/position).
      if (roiScore != null) return Math.max(0, roiScore);
      if (volume != null && volume > 0) return volume * ctrUplift(input) * win;
      return input.llmLabel ? LLM_FALLBACK_CLICKDELTA[input.llmLabel] : 0;
    }
    case 'ranking_opp': {
      // Striking-distance: real CTR uplift × winnability, reading volume + KD/authority
      // (the flat 60/40 + unread-volume bug). Falls back to a grounded composite.
      if (volume != null && volume > 0) return volume * ctrUplift(input) * win;
      if (roiScore != null) return Math.max(0, roiScore);
      if (opportunityScore != null) return (opportunityScore / 100) * DEMAND_CEILING * win / 10;
      return input.llmLabel ? LLM_FALLBACK_CLICKDELTA[input.llmLabel] : 0;
    }
    case 'content_gap': {
      // Grounded spine: the trend-weighted opportunityScore composite.
      if (opportunityScore != null) {
        if (volume != null && volume > 0) return (opportunityScore / 100) * volume * ctrAt(targetPosition(num(input.currentPosition)), input.ctrCurve ?? null) * win;
        // No provider volume → use the composite directly as a grounded click-delta proxy.
        return (opportunityScore / 100) * DEMAND_CEILING * win / 10;
      }
      if (volume != null && volume > 0) return volume * ctrUplift(input) * win;
      return input.llmLabel ? LLM_FALLBACK_CLICKDELTA[input.llmLabel] : 0;
    }
    case 'decay': {
      const prev = num(input.previousClicks) ?? 0;
      const cur = num(input.currentClicks) ?? 0;
      const lost = Math.max(0, prev - cur);
      // Recoverability: nearer current position is easier to win back; weighted by
      // winnability and halved for repeat failures (cause-aware, fixes IW6/MW5).
      const pos = num(input.currentPosition);
      const recoverBase = pos == null ? 0.4 : pos <= 10 ? 0.6 : 0.35;
      const repeat = input.isRepeatDecay ? REPEAT_DECAY_FACTOR : 1;
      return lost * recoverBase * win * repeat;
    }
    case 'technical': {
      const sev = input.severity ?? 'info';
      const lift = SEVERITY_LIFT[sev] * (input.isCritical ? CRITICAL_LIFT_MULT : 1);
      const traffic = num(input.currentClicks) ?? 0;
      return traffic * lift;
    }
    case 'freshness': {
      const impr = num(input.impressions) ?? 0;
      return impr * FRESHNESS_CTR_GAP;
    }
    case 'diagnostic': {
      return input.llmLabel ? LLM_FALLBACK_CLICKDELTA[input.llmLabel] : 0;
    }
  }
}

function valuePerClick(input: OpportunityInput): number {
  const w = intentWeight(input.intent);
  const cpc = num(input.cpc);
  return cpc != null && cpc > 0 ? cpc * w : w;
}

/** Monotonic compression of roiPerEffortDay → 0..100. The ORDER (not magnitude)
 *  is what ranking needs; per-workspace percentile display normalization is layered
 *  on later (P6). log1p keeps the mapping monotonic and bounded. */
export function normalizeToScore(roiPerEffortDay: number): number {
  if (!Number.isFinite(roiPerEffortDay) || roiPerEffortDay <= 0) return 0;
  return Math.min(100, Math.round(12 * Math.log1p(roiPerEffortDay)));
}

function buildComponents(
  input: OpportunityInput,
  parts: { confidence: number; spine: OpportunityScore['groundedSpine']; effortDays: number; businessFit: number; timing: number },
  weights: OpportunityWeights,
): OpportunityComponent[] {
  const volume = num(input.volume) ?? num(input.impressions) ?? 0;
  const win = winnability(num(input.difficulty), num(input.authorityStrength));
  const iw = intentWeight(input.intent);
  const timingActive = parts.timing > 1;
  const comps: Array<{ dimension: OpportunityDimension; rawValue: number | string | null; normalized: number; evidence: string }> = [
    { dimension: 'demand', rawValue: num(input.volume) ?? num(input.impressions), normalized: clamp01(volume / DEMAND_CEILING), evidence: `${fmtInt(volume)} monthly searches/impressions` },
    { dimension: 'winnability', rawValue: num(input.difficulty), normalized: clamp01(win / MAX_WINNABILITY), evidence: input.difficulty != null ? `KD ${input.difficulty} vs domain authority` : 'authority/KD unknown' },
    { dimension: 'intent', rawValue: input.intent ?? null, normalized: clamp01(iw), evidence: `${input.intent ?? 'unspecified'} intent` },
    { dimension: 'effort', rawValue: parts.effortDays, normalized: clamp01(1 - parts.effortDays / 5), evidence: `~${parts.effortDays} day(s) to implement` },
    { dimension: 'businessFit', rawValue: num(input.businessFitAlignment), normalized: clamp01((parts.businessFit - 1) / 0.5), evidence: parts.businessFit > 1 ? 'aligned with stated business priorities' : 'no explicit priority match' },
    // Timing has no score effect until an opportunity event sets timingBoost (P7);
    // report a 0 contribution until then so the breakdown never overstates a driver.
    { dimension: 'timing', rawValue: num(input.timingBoost) ?? 0, normalized: timingActive ? clamp01(parts.timing - 1) : 0, evidence: timingActive ? 'recent opportunity event raises urgency' : 'no active timing event' },
    { dimension: 'evidence', rawValue: parts.spine, normalized: clamp01(parts.confidence), evidence: parts.spine === 'computed' && parts.confidence <= CONFIDENCE.llmLabel ? 'estimated (no provider metrics)' : `grounded in ${parts.spine}` },
  ];
  return comps.map((c) => {
    const weight = weights[c.dimension];
    return { ...c, weight, contribution: Math.round(weight * c.normalized * 1000) / 1000 };
  });
}

export interface ComputeOptions {
  /** Per-workspace calibration multiplier [0.75..1.25]; identity (1.0) until outcomes exist. */
  calibration?: number;
  /** Per-workspace calibrated display weights (P5). Defaults to platform weights. */
  weights?: OpportunityWeights;
}

/** THE scorer. Pure: same input → same OpportunityScore. */
export function computeOpportunityValue(input: OpportunityInput, opts: ComputeOptions = {}): OpportunityScore {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const calibration = clamp(opts.calibration ?? 1.0, 0.75, 1.25);

  const { confidence, spine } = provenanceConfidence(input);
  const isUngrounded = confidence <= CONFIDENCE.llmLabel;

  // Resolve effort: positive floor on any override; ungrounded items pay a
  // conservative minimum so a hyped low-effort guess cannot out-divide a grounded item.
  const overrideOrDefault = num(input.effortDays) != null && input.effortDays! > 0 ? input.effortDays! : DEFAULT_EFFORT_DAYS[input.branch];
  let effortDays = Math.max(MIN_EFFORT_DAYS, overrideOrDefault);
  if (isUngrounded) effortDays = Math.max(effortDays, UNGROUNDED_MIN_EFFORT_DAYS);

  const clickDeltaPerWeek = Math.max(0, expectedClickDelta(input));
  const emvPerWeek = clickDeltaPerWeek * valuePerClick(input);
  const businessFit = 1 + 0.5 * clamp01(num(input.businessFitAlignment) ?? 0);
  const timing = 1 + Math.max(0, num(input.timingBoost) ?? 0);

  const roiPerEffortDay = (emvPerWeek * HORIZON_WEEKS * businessFit * confidence * calibration * timing) / effortDays;
  const value = normalizeToScore(roiPerEffortDay);

  const components = buildComponents(input, { confidence, spine, effortDays, businessFit, timing }, weights);

  return {
    value,
    emvPerWeek: Math.round(emvPerWeek * 100) / 100,
    roiPerEffortDay: Math.round(roiPerEffortDay * 100) / 100,
    confidence,
    calibration,
    groundedSpine: spine,
    components,
    calibrationVersion: weights.calibrationVersion,
    modelVersion: MODEL_VERSION,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/**
 * Strangler-fig selector — the single chokepoint for the legacy↔OV cutover.
 * Returns the OV value only when the caller resolves the `opportunity-value-scorer`
 * flag ON for the workspace (resolution wired in P3); otherwise the legacy score.
 * Pure: the flag boolean is passed in, never read here.
 */
export function pickImpactScore(rec: Pick<Recommendation, 'impactScore' | 'opportunity'>, useOpportunityValue: boolean): number {
  if (useOpportunityValue && rec.opportunity) return rec.opportunity.value;
  return rec.impactScore;
}
