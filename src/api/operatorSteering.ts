// ── Operator steering (strategy-the-issue §11/§12) — admin curation API ────────
//
// The deeper curation verbs the owner flagged: correct a rec's wording (title/
// insight), add a rec the system missed, and reorder the client-facing running
// order — all on the ADMIN recommendation routes (HMAC token via the global gate;
// NO `requireAuth`). Overrides live in `rec_operator_override` (rec_id-keyed) and
// follow a rec through the weekly regen via id-continuity; they apply ONLY at the
// display boundaries (admin GET serialization + the public client projection), so
// `loadRecommendations` stays pure (no baking).
//
// Mirrors the `recommendations.*` send/strike/etc. wrappers in src/api/misc.ts.

import { get, patch, post } from './client';
import type {
  CreateManualRecPayload,
  OperatorOverridesResponse,
  RecWordingOverridePayload,
} from '../../shared/types/rec-operator-steering';
import type { Recommendation } from '../../shared/types/recommendations';

/** GET the two override maps (wording + sortOrder) for the admin steering UI. */
export function getOperatorOverrides(workspaceId: string): Promise<OperatorOverridesResponse> {
  return get<OperatorOverridesResponse>(`/api/recommendations/${workspaceId}/operator-overrides`);
}

/**
 * PATCH a wording override (title/insight). An absent/empty field clears that
 * override (restores the source wording). Returns the (display-overridden) rec.
 */
export function editRecWording(
  workspaceId: string,
  recId: string,
  payload: RecWordingOverridePayload,
): Promise<Recommendation> {
  return patch<Recommendation>(
    `/api/recommendations/${workspaceId}/${recId}/wording`,
    payload,
  );
}

/** PATCH the client-facing running order — the curated recs in desired order. */
export function reorderRecs(workspaceId: string, recIds: string[]): Promise<OperatorOverridesResponse> {
  return patch<OperatorOverridesResponse>(
    `/api/recommendations/${workspaceId}/reorder`,
    { recIds },
  );
}

/** POST a manual (operator-authored) rec the system missed. Returns the minted rec. */
export function createManualRec(
  workspaceId: string,
  payload: CreateManualRecPayload,
): Promise<Recommendation> {
  return post<Recommendation>(`/api/recommendations/${workspaceId}/manual-rec`, payload);
}
