/**
 * The Issue — Phase 4 trust-ladder contracts.
 *
 * Per-archetype auto-send: the operator EARNS auto-send for a low-risk recommendation bucket by
 * manually greenlighting it for N consecutive weekly cycles; once earned + enabled, the weekly
 * cron auto-sends that bucket's active recs.
 *
 * Only the two NON-MONETIZABLE, low-risk buckets are auto-send-eligible. The money + judgment-heavy
 * buckets (authority_bet/content, refresh_reclaim, defend/cannibalization, local) are NEVER
 * auto-sent — the operator always gates them. Eligibility is enforced server-side at both the store
 * and the route. Shared by the admin TrustLadderPanel + the autosend store + the cron.
 */
import type { Archetype } from './strategy-archetype.js';

/** The only archetypes that can ever be promoted to auto-send. */
export const AUTOSEND_ELIGIBLE_ARCHETYPES = ['quick_win', 'technical'] as const;
export type AutoSendEligibleArchetype = typeof AUTOSEND_ELIGIBLE_ARCHETYPES[number];

/** Consecutive weekly cycles of consistent manual greenlighting required to earn auto-send. */
export const AUTOSEND_TRUST_THRESHOLD = 3;

/** Narrowing guard: is this archetype auto-send-eligible? */
export function isAutoSendEligible(a: Archetype): a is AutoSendEligibleArchetype {
  return (AUTOSEND_ELIGIBLE_ARCHETYPES as readonly string[]).includes(a);
}

/** One eligible archetype's trust-ladder state for a workspace. */
export interface AutoSendPolicyRow {
  archetype: AutoSendEligibleArchetype;
  /** Operator opt-in. Can only be true once `earned`. */
  enabled: boolean;
  /** Consecutive ISO-week cycles credited (latched once it reaches the threshold). */
  consecutiveCycles: number;
  /** ISO Monday of the last week a send credited this archetype (null = never). */
  lastCreditedWeek: string | null;
  /** consecutiveCycles >= AUTOSEND_TRUST_THRESHOLD — the toggle unlocks once true. */
  earned: boolean;
}

/** GET /api/auto-send-policy/:workspaceId response — exactly the eligible archetypes. */
export interface AutoSendPolicyResponse {
  workspaceId: string;
  threshold: number;
  policies: AutoSendPolicyRow[];
}
