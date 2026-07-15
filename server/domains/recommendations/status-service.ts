import type { RecStatus, Recommendation, RecommendationSet } from '../../../shared/types/recommendations.ts';
import { RECOMMENDATION_TRANSITIONS, validateTransition } from '../../state-machines.js';
import { computeRecommendationSummary, isExemptFromAutoResolve } from './rules.js';
import {
  loadRecommendationSet,
  saveRecommendationSet,
  setRecommendationItemStatus,
} from './storage.js';

/**
 * Reconcile R4-PR1 — the app-level struck≠completed guard (trust-critical invariant).
 *
 * A struck (or sent/discussing/approved) rec must NEVER be swept to `completed`: a struck rec
 * completed would read to the client as "✓ done" when the operator actually decided NOT to do it,
 * and a sent/approved rec is owned by the client-facing axis, not the internal triage axis. The
 * single-writer + the finalization auto-resolve already respect this via `isExemptFromAutoResolve`;
 * this guard closes the SAME hole on the direct RecStatus-completion path (`fixRecommendation`, the
 * PATCH `/:recId` status route, MCP `apply_recommendation`) which reaches `updateRecommendationStatus`.
 *
 * The DB-level constraint/trigger that makes this UNbypassable is the separate R4-PR2 ticket; this is
 * the app-level half that ships first (guards BEFORE the trigger so regen rollbacks aren't opaque 500s).
 */
export class StruckRecCompletionError extends Error {
  readonly recId: string;
  constructor(recId: string) {
    super(`Recommendation ${recId} is exempt from status completion (struck / sent-to-client)`);
    this.name = 'StruckRecCompletionError';
    this.recId = recId;
  }
}

export function loadRecommendations(workspaceId: string): RecommendationSet | null {
  return loadRecommendationSet(workspaceId);
}

export function saveRecommendations(set: RecommendationSet): void {
  saveRecommendationSet(set);
}

export function updateRecommendationStatus(
  workspaceId: string,
  recId: string,
  status: RecStatus
): Recommendation | null {
  // R4-PR1 struck≠completed guard: refuse to complete a rec the operator struck (or one the client
  // owns — sent/discussing/approved). Read the current rec first so the guard sees the live lifecycle
  // axis; `isExemptFromAutoResolve` is the SAME predicate the finalization auto-resolve uses, so the
  // two completion paths cannot drift. A struck rec swept to `completed` would read as "✓ done" to the
  // client — the trust-critical invariant. Non-completion transitions (in_progress, dismissed, reopen)
  // are unaffected.
  if (status === 'completed') {
    const set = loadRecommendationSet(workspaceId);
    const current = set?.recommendations.find(r => r.id === recId);
    if (current && current.status !== 'completed' && isExemptFromAutoResolve(current)) {
      throw new StruckRecCompletionError(recId);
    }
  }
  // Recompute the summary so topRecommendationId stays consistent after a
  // status flip — completing or dismissing a rec must not leave the pointer
  // referencing that now-inactive rec. computeRecommendationSummary already
  // excludes completed/dismissed recs when picking activeRecs[0].
  return setRecommendationItemStatus(
    workspaceId,
    recId,
    status,
    computeRecommendationSummary,
    (current, next) => validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, current, next),
  );
}

export function dismissRecommendation(workspaceId: string, recId: string): boolean {
  return updateRecommendationStatus(workspaceId, recId, 'dismissed') !== null;
}
