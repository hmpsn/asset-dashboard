/**
 * The Issue — operator-steering batch contracts (spec §11/§12).
 *
 * The deeper curation verbs: correct a rec's wording (title/insight), add a rec the system missed,
 * and reorder the client-facing running order — all surviving the weekly regen. Overrides live in
 * `rec_operator_override` (rec_id-keyed, so they follow a rec through regen via id-continuity) and
 * apply ONLY at display boundaries. Shared by server/rec-operator-overrides.ts + the routes + the
 * admin steering UI + the contract tests.
 */
import type { RecType, RecPriority } from './recommendations.js';

/**
 * Manual-rec mint is allowed for every RecType EXCEPT `cannibalization` (deliverable-routed — it
 * needs a urlSetKey + a competing-page set the operator can't hand-author here).
 */
export const MANUAL_REC_ALLOWED_TYPES = [
  'content', 'content_refresh', 'keyword_gap', 'topic_cluster', 'technical', 'metadata',
  'schema', 'performance', 'accessibility', 'strategy', 'aeo', 'local_visibility',
  'local_service_gap', 'competitor',
] as const;
export type ManualRecType = typeof MANUAL_REC_ALLOWED_TYPES[number];

export function isManualRecType(t: RecType | string): t is ManualRecType {
  return (MANUAL_REC_ALLOWED_TYPES as readonly string[]).includes(t);
}

export const REC_WORDING_TITLE_MAX = 160;
export const REC_WORDING_INSIGHT_MAX = 600;

/** PATCH wording. An absent/empty field clears that override (restores the source wording). */
export interface RecWordingOverridePayload {
  title?: string;
  insight?: string;
}

/** PATCH reorder — the curated/sent recs in the desired client-facing order. */
export interface ReorderRecsPayload {
  recIds: string[];
}

/** POST manual-rec — the operator-authored recommendation the system missed. */
export interface CreateManualRecPayload {
  type: ManualRecType;
  title: string;
  insight: string;
  description?: string;
  priority?: RecPriority;
  targetKeyword?: string;
  affectedPages?: string[];
}

/** GET operator-overrides — the two override maps for the admin steering UI. */
export interface OperatorOverridesResponse {
  workspaceId: string;
  wording: Record<string, { title?: string; insight?: string }>;
  sortOrder: Record<string, number>;
}
