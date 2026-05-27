/**
 * trial-state.ts — Single source of truth for trial status computation.
 *
 * Both the admin workspace list (server/routes/workspaces.ts) and the
 * client-safe serializer (server/serializers/client-safe.ts) previously
 * computed isTrial / trialDaysRemaining inline with subtly different logic.
 * This module centralizes the computation so both paths return identical
 * results for the same workspace row.
 *
 * Uses computeEffectiveTier() from server/workspaces.ts as the authority
 * on whether a free-tier workspace is currently in a Growth trial.
 */

import { computeEffectiveTier, type EffectiveTier } from '../workspaces.js';

export interface TrialState {
  isTrial: boolean;
  trialDaysRemaining: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Compute trial status for a workspace.
 *
 * @param ws  Must include at least `tier` (baseTier string) and `trialEndsAt`
 *            (ISO date string or null/undefined).
 * @param nowMs  Override for deterministic testing (default: Date.now()).
 * @returns `isTrial` is true when effectiveTier is 'growth' but baseTier is
 *          'free' (i.e. the workspace is on a Growth trial). `trialDaysRemaining`
 *          is the ceiling-rounded days left when on trial, or 0 when not on trial.
 */
export function computeTrialState(
  ws: { tier?: string | null; trialEndsAt?: string | null },
  nowMs = Date.now(),
): TrialState {
  // Route through the canonical tier resolver so the isTrial decision
  // never drifts from the tier decision.
  const baseTier: EffectiveTier = ((ws.tier as EffectiveTier | undefined | null) || 'free');
  const effectiveTier = computeEffectiveTier(
    { tier: baseTier, trialEndsAt: ws.trialEndsAt ?? undefined },
    nowMs,
  );

  const isTrial = effectiveTier === 'growth' && baseTier === 'free';

  if (!isTrial || !ws.trialEndsAt) {
    return { isTrial: false, trialDaysRemaining: 0 };
  }

  const trialEndMs = new Date(ws.trialEndsAt).getTime();
  const daysRemaining = Math.max(0, Math.ceil((trialEndMs - nowMs) / MS_PER_DAY));

  return { isTrial: true, trialDaysRemaining: daysRemaining };
}
