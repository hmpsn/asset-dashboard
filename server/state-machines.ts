/**
 * Centralized state machine transition guards.
 *
 * Every entity with a status column should define its valid transitions here.
 * Call validateTransition(entity, transitions, from, to) before mutating status
 * in DB layer functions — it THROWS InvalidTransitionError on an illegal move
 * and returns the new status on success.
 *
 * Each `*_TRANSITIONS` table below is also wrapped by the shared lifecycle
 * envelope (`registerLifecycle`, see the "Lifecycle envelope registration" block
 * near the bottom). Registration is a typed view over these tables — it never
 * changes their vocabulary or edges. `shared/types/lifecycle.ts` holds the
 * contract types; census + verdicts live in
 * `docs/rules/lifecycle-state-machines.md`.
 */

import { registerLifecycle } from '../shared/types/lifecycle.js';
import type {
  MatrixGenerationAttemptStatus,
  MatrixGenerationItemStatus,
  MatrixGenerationRunStatus,
} from '../shared/types/matrix-generation.js';
import type {
  BrandGenerationAttemptStatus,
  BrandGenerationItemStatus,
  BrandGenerationRunStatus,
} from '../shared/types/brand-generation.js';

// ── Approval Item ──
// pending ↔ approved ↔ applied
// pending ↔ rejected
export const APPROVAL_ITEM_TRANSITIONS: Record<string, readonly string[]> = {
  pending:  ['approved', 'rejected'],
  approved: ['pending', 'applied'],   // pending = undo approval
  rejected: ['pending'],              // undo rejection
  applied:  [],                       // terminal — applied to Webflow
};

export type ApprovalItemStatus = 'pending' | 'approved' | 'rejected' | 'applied';

// ── Content Topic Request ──
// Complex pipeline with 10 states. Admins can fast-track forward (e.g.
// requested → in_progress when handling the brief/review process internally).
// The guard prevents backward movement and ensures terminal states stay terminal.
export const CONTENT_REQUEST_TRANSITIONS: Record<string, readonly string[]> = {
  pending_payment:   ['requested', 'declined'],
  requested:         ['brief_generated', 'client_review', 'approved', 'in_progress', 'delivered', 'published', 'declined'],
  brief_generated:   ['client_review', 'approved', 'in_progress', 'delivered', 'published', 'declined'],
  client_review:     ['approved', 'changes_requested', 'in_progress', 'delivered', 'published', 'declined'],
  changes_requested: ['client_review', 'brief_generated', 'approved', 'in_progress', 'post_review', 'delivered', 'published', 'declined'],
  approved:          ['in_progress', 'delivered', 'published', 'declined'],
  in_progress:       ['post_review', 'delivered', 'published', 'declined'],
  post_review:       ['changes_requested', 'delivered', 'published', 'declined'],
  delivered:         ['published'],
  published:         [],  // terminal
  declined:          [],  // terminal
};

export type ContentRequestStatus = 'pending_payment' | 'requested' | 'brief_generated' | 'client_review' | 'approved' | 'changes_requested' | 'in_progress' | 'post_review' | 'delivered' | 'published' | 'declined';

// ── Generated Post ──
export const POST_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  generating:      ['needs_attention', 'draft', 'error'],
  needs_attention: ['generating', 'draft', 'error'],
  error:           ['generating', 'draft'],
  draft:      ['review'],
  review:     ['approved', 'draft'],  // draft = send back for edits
  approved:   [],                     // terminal (publish is tracked separately)
};

export type PostStatus = 'generating' | 'needs_attention' | 'draft' | 'review' | 'approved' | 'error';

// ── Work Order ──
// completed → closed is the operator-only one-way close-out (no reopen): once
// the fulfillment is delivered, an operator can explicitly CLOSE the order to
// take it out of the client conversation lane. There is intentionally NO
// completed → in_progress reopen and NO closed → anything edge (closed is
// terminal). cancelled stays terminal.
export const WORK_ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  pending:     ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed:   ['closed'],  // operator-only one-way close-out (no reopen)
  closed:      [],  // terminal — no reopen
  cancelled:   [],  // terminal
};

export type WorkOrderStatus = 'pending' | 'in_progress' | 'completed' | 'closed' | 'cancelled';

// ── Content Subscription ──
export const CONTENT_SUB_TRANSITIONS: Record<string, readonly string[]> = {
  pending:   ['active', 'cancelled'],
  active:    ['pending', 'paused', 'cancelled', 'past_due'],
  paused:    ['pending', 'active', 'cancelled'],
  past_due:  ['pending', 'active', 'cancelled'],
  cancelled: [],  // terminal
};

export type ContentSubStatus = 'active' | 'paused' | 'cancelled' | 'past_due' | 'pending';

// ── Client Action ──
// Manual/agency-executed recommendations sent to the client. A client can make
// one decision from pending; admins can reopen requested-change items after
// revising the recommendation, complete accepted/worked items, or archive.
export const CLIENT_ACTION_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['approved', 'changes_requested', 'completed', 'archived'],
  approved: ['completed', 'archived'],
  changes_requested: ['pending', 'completed', 'archived'],
  completed: ['archived'],
  archived: [],
};

export type ClientActionStateStatus = 'pending' | 'approved' | 'changes_requested' | 'completed' | 'archived';

// ── Recommendation ──
// Lifecycle for engine-produced recommendations (server/recommendations.ts).
// A rec starts pending, can be moved to in_progress (work started), completed
// (issue resolved — either by a client/admin marking it done, by an applied
// change/work-order whose affected pages match it, or by auto-resolution on the
// next full regen), or dismissed (client chose to ignore it). pending↔in_progress
// is reversible; completed and dismissed are reopenable back to pending so a
// regen that re-detects the issue (or a client un-dismiss) can revive it.
export const RECOMMENDATION_TRANSITIONS: Record<string, readonly string[]> = {
  // Internal RecStatus axis (unchanged) — admin triage.
  pending:     ['in_progress', 'completed', 'dismissed'],
  in_progress: ['pending', 'completed', 'dismissed'],
  completed:   ['pending', 'in_progress'],   // pending/in_progress = issue re-detected
  dismissed:   ['pending'],                  // un-dismiss
  // Strategy v3 operator curation axis (clientStatus) — admin-only (validated separately
  // from the client-side map below). 'system' is the implicit start for an absent clientStatus.
  system:      ['curated'],
  curated:     ['sent', 'system'],           // 'system' = operator un-curated before sending
  // 'sent' has NO operator-side forward edge here — the client owns sent → approved|declined|
  // discussing via CLIENT_REC_TRANSITIONS. (A re-send is a fresh sentAt, not a transition.)
};

// Strategy v3 — client-side response axis (spec §7.2). A sent rec is the only thing the
// client can act on. Distinct from RecStatus AND from the operator curation axis: the
// client act-on route (POST /api/public/recommendations/:ws/:recId/act-on) validates
// ONLY against this map and mutates ONLY clientStatus — never RecStatus, never completion.
// "Act on this" (greenlight) is the sent|discussing → approved edge; it also creates a durable
// content REQUEST (nothing is pre-generated). The other client edges (declined / discussing)
// flow through the same axis.
export const CLIENT_REC_TRANSITIONS: Record<string, readonly string[]> = {
  sent:       ['approved', 'declined', 'discussing'],
  discussing: ['approved', 'declined'],   // a discussion resolves to a decision
  approved:   [],                         // terminal (client side)
  declined:   [],                         // terminal (client side)
};

export type RecommendationStateStatus = 'pending' | 'in_progress' | 'completed' | 'dismissed';

// ── Briefing Draft ──
// Weekly client briefing lifecycle (server/briefing-store.ts).
//   draft → approved → published   (admin reviewed + published)
//   draft → published              (admin published without explicit approve step)
//   draft|approved → skipped       (admin chose not to publish this week)
//   approved → draft               (admin un-approved to edit again)
// published and skipped are terminal.
export const BRIEFING_DRAFT_TRANSITIONS: Record<string, readonly string[]> = {
  draft:     ['approved', 'published', 'skipped'],
  approved:  ['published', 'skipped', 'draft'],  // draft = "I changed my mind, let me edit"
  published: [],   // terminal
  skipped:   [],   // terminal
};

// ── Background Job Status ──
// Jobs move forward from pending → running and then to terminal states.
// Some jobs can fail/cancel before running, so pending can move directly to
// error/cancelled. Terminal states never reopen.
export const BACKGROUND_JOB_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['running', 'done', 'error', 'cancelled'],
  running: ['done', 'error', 'cancelled'],
  done: [],
  error: [],
  cancelled: [],
};

export type BackgroundJobStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

// ── Google Business Profile Review Response ──
// Drafts can be sent to the client or approved internally by an admin. Publishing is only legal
// after explicit approval metadata is recorded by the GBP response service.
export const GBP_REVIEW_RESPONSE_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['awaiting_client', 'approved', 'cancelled'],
  awaiting_client: ['awaiting_client', 'approved', 'changes_requested', 'declined', 'cancelled'],
  changes_requested: ['draft', 'awaiting_client', 'cancelled'],
  declined: [],
  approved: ['publishing', 'cancelled'],
  publishing: ['published', 'publish_failed'],
  published: [],
  publish_failed: ['publishing', 'cancelled'],
  cancelled: [],
};

export type GbpReviewResponseStateStatus =
  | 'draft'
  | 'awaiting_client'
  | 'changes_requested'
  | 'declined'
  | 'approved'
  | 'publishing'
  | 'published'
  | 'publish_failed'
  | 'cancelled';

// ── Client Deliverable (unified send-to-client spine) ──
// One canonical status vocabulary across the five bespoke send-to-client pipelines
// (design §4.2). Base map:
//   draft → awaiting_client
//   awaiting_client → {awaiting_client (resend/supersede) | changes_requested | approved | declined | partial}
//   changes_requested ↔ awaiting_client
//   approved → applied            (apply is opt-in per adapter, default no-op — D-apply)
//   partial → {approved | declined | changes_requested}
//   order lifecycle: ordered → in_progress → completed   (work_order, kind='order')
//   terminals: applied | declined | expired | cancelled | completed
// Any non-terminal state may also be cancelled/expired (operator/system close-out).
// Per-type overrides are applied via getDeliverableTransitions(type).
export const CLIENT_DELIVERABLE_TRANSITIONS: Record<string, readonly string[]> = {
  draft:             ['awaiting_client', 'cancelled'],
  // awaiting_client → awaiting_client is the idempotent resend/supersede edge (a second
  // sendToClient with the same sourceRef onto a still-pending row). Terminal rows have no
  // outbound awaiting_client edge, so a resend onto them throws (no silent revert).
  awaiting_client:   ['awaiting_client', 'changes_requested', 'approved', 'declined', 'partial', 'expired', 'cancelled'],
  changes_requested: ['awaiting_client', 'approved', 'declined', 'cancelled'],
  partial:           ['approved', 'declined', 'changes_requested', 'cancelled'],
  approved:          ['applied', 'cancelled'],
  // order lifecycle (work_order)
  ordered:           ['in_progress', 'cancelled'],
  in_progress:       ['completed', 'cancelled'],
  // terminals
  applied:           [],
  declined:          [],
  expired:           [],
  cancelled:         [],
  completed:         [],
};

// Per-type transition overrides (design §4.2). Each entry is MERGED onto the base map
// (override keys replace the base key wholesale). Returned by getDeliverableTransitions.
//   copy_section: approve is terminal (no →applied; the side-effect is voice-sample
//     harvest, modeled as an adapter no-op apply) and changes_requested routes to draft.
//   content_request: full production pipeline is carried by CONTENT_REQUEST_TRANSITIONS
//     (the projected type keeps its own machine); no override needed here.
//   schema_plan: client approve does NOT auto-apply — kept identical to the base map
//     (apply is a separate operator transition), so no override entry.
//   briefing / notification kind: one-way, NO client transitions.
const DELIVERABLE_TYPE_OVERRIDES: Record<string, Record<string, readonly string[]>> = {
  copy_section: {
    changes_requested: ['draft', 'awaiting_client'],
    approved: [], // terminal — copy approve has no apply step
  },
  brand_generation: {
    // One client decision may leave other suite items unresolved. Repeated
    // item decisions therefore keep the parent honestly partial until the
    // final source is approved. There is no whole-bundle decline or apply edge.
    awaiting_client: ['awaiting_client', 'changes_requested', 'partial', 'approved', 'expired', 'cancelled'],
    changes_requested: ['awaiting_client', 'changes_requested', 'partial', 'approved', 'expired', 'cancelled'],
    partial: ['partial', 'approved', 'changes_requested', 'expired', 'cancelled'],
    approved: [],
  },
  // (briefing is handled by NOTIFICATION_DELIVERABLE_TYPES below; an override entry here
  // would be dead — getDeliverableTransitions short-circuits to {} before reading this map.)
};

// Types whose kind is one-way notification — they have NO transitions of any kind.
const NOTIFICATION_DELIVERABLE_TYPES = new Set<string>(['briefing']);

/**
 * Resolve the transition map for a specific deliverable type: the base
 * CLIENT_DELIVERABLE_TRANSITIONS with the per-type override keys merged on top.
 * Notification types (briefing) get an EMPTY map — no transitions are legal, so the
 * validator rejects every status change (enforces the one-way safety, design §4.2).
 */
export function getDeliverableTransitions(type: string): Readonly<Record<string, readonly string[]>> {
  if (NOTIFICATION_DELIVERABLE_TYPES.has(type)) return {};
  const override = DELIVERABLE_TYPE_OVERRIDES[type];
  if (!override) return CLIENT_DELIVERABLE_TRANSITIONS;
  return { ...CLIENT_DELIVERABLE_TRANSITIONS, ...override };
}

// ── Content Matrix Cell (content-plan grid) ──
// The 8 MatrixCellStatus values from shared/types/content.ts. updateMatrixCell
// (server/content-matrices.ts) is currently any-to-any (CP-K4 gap) — this map brings
// it under validateTransition during the content_plan cutover (design §4.4, M6).
// Forward pipeline with the operator send-back edges (review→draft, flagged→draft).
// Admin shortcuts included:
//   planned/keyword_validated/brief_generated → review  (send-samples admin action)
//   planned/keyword_validated/brief_generated → approved (batch-approve admin action)
// Client review action (G2/C2): a client may flag ANY client-visible cell for changes.
// CLIENT_VISIBLE_CELL_STATUSES (review/flagged/approved/published) ALL surface the flag form
// in the client UI (MatrixProgressView CellPreviewModal), so flagging must be a legal edge from
// review/approved/published too — not just review. Without approved→flagged / published→flagged
// the public flag route threw InvalidTransitionError → 500 for an in-spec client action.
export const MATRIX_CELL_TRANSITIONS: Record<string, readonly string[]> = {
  planned:           ['keyword_validated', 'brief_generated', 'draft', 'review', 'approved'],
  keyword_validated: ['brief_generated', 'draft', 'planned', 'review', 'approved'],
  brief_generated:   ['draft', 'keyword_validated', 'review', 'approved'],
  draft:             ['review', 'brief_generated'],
  review:            ['flagged', 'approved', 'draft'],
  flagged:           ['review', 'draft', 'approved'],
  approved:          ['published', 'review', 'flagged'], // flagged: client flags an approved cell (G2/C2)
  published:         ['flagged'], // client flags a published cell for changes (G2/C2) — otherwise terminal
};

// ── Client Request (support tickets) ──
// The 6 RequestStatus values from shared/types/requests.ts. PATCH /api/requests/:id
// and PATCH /api/requests/bulk both validate this map before mutating so illegal moves
// like closed→new do not re-fire client status email, broadcast, or partially bulk-apply.
// Forward flow with operator reopen edges; closed is terminal.
export const REQUEST_TRANSITIONS: Record<string, readonly string[]> = {
  new:         ['in_review', 'in_progress', 'on_hold', 'completed', 'closed'],
  in_review:   ['in_progress', 'on_hold', 'completed', 'closed', 'new'],
  in_progress: ['on_hold', 'in_review', 'completed', 'closed'],
  on_hold:     ['in_review', 'in_progress', 'completed', 'closed'],
  completed:   ['closed', 'in_progress'], // reopen to in_progress if work resumes
  closed:      [], // terminal — no reopen (forbids closed→new, B24)
};

export type RequestTransitionStatus = 'new' | 'in_review' | 'in_progress' | 'on_hold' | 'completed' | 'closed';

// ── Schema Site Plan ──
// Five statuses derived from SchemaSitePlan['status']:
//   draft → sent_to_client         admin sends for review
//   draft → active                  admin activates without client review (SchemaPlanPanel
//                                    offers "Activate Plan" alongside "Send to client" on drafts)
//   sent_to_client → client_approved | client_changes_requested   client responds
//   client_changes_requested → draft | sent_to_client              admin revises or resends
//   client_approved → active        admin activates the plan
//   sent_to_client → active         admin fast-tracks without waiting for client response
//   active → draft                  admin resets to rework (e.g. site redesign)
//
// The `sendSchemaPlanToClientForReview` mutation is UI-gated to draft plans only.
// `activateSchemaPlanForAdmin` is allowed from draft, sent_to_client, or client_approved —
// the SchemaPlanPanel renders "Activate Plan" whenever status is draft or client_approved,
// so direct draft → active must be legal (admin self-serve activation, no client gate).
// No self-transitions and no backward jumps from client_approved → draft directly
// (force the admin to activate, then reset if needed).
export const SCHEMA_PLAN_TRANSITIONS: Record<string, readonly string[]> = {
  draft:                    ['sent_to_client', 'active'],
  sent_to_client:           ['client_approved', 'client_changes_requested', 'active'],
  client_changes_requested: ['draft', 'sent_to_client'],
  client_approved:          ['active'],
  active:                   ['draft'],  // admin resets to rework
};

export type SchemaPlanStatus =
  | 'draft'
  | 'sent_to_client'
  | 'client_approved'
  | 'client_changes_requested'
  | 'active';

// ── Tracked Keyword (rank-tracking lifecycle) ──
// The four TRACKED_KEYWORD_STATUS values (shared/types/rank-tracking.ts). Until P3
// (Keyword Hub Wave 4) the tracked-keyword lifecycle was the ONLY status entity whose
// mutations were not state-machine-guarded: every other status column already routes
// through validateTransition, but the KCC action service flipped active↔paused↔deprecated
// directly. This map closes that gap so the live KCC/Hub
// action engine refuses illegal moves (defense-in-depth: an illegal transition is
// "never allowed", orthogonal to protection which is "needs confirmation").
//
// The edge set is DERIVED from the real action switch in the KCC action service
// — the minimal map that ADMITS every transition the switch performs and REJECTS the rest:
//   active → paused      PAUSE_TRACKING
//   active → deprecated  RETIRE, DECLINE-of-tracked
//   paused → deprecated  RETIRE / DECLINE while paused (Retire is offered whenever row.tracking exists)
//   paused → active      RESTORE
//   deprecated → active  RESTORE (revive clears deprecatedAt/replacedBy — rank-tracking.ts)
// Plus the reconcile-only lifecycle edge active|paused → replaced (rank-tracking-reconciliation.ts
// flips an active strategy-owned keyword to REPLACED when a current target supersedes it; that
// path does NOT route through this validator but the edge is part of the real lifecycle, so the
// model includes it to stay faithful). `replaced` and the unreachable cross-edges are terminal:
// deprecated/replaced are NOT freely interconvertible, and `replaced` never revives (the only
// revive path, RESTORE, targets `active` from paused/deprecated — a replaced keyword has been
// superseded and is re-tracked as a fresh insert, not a transition).
//
// NOT a machine state: `not_tracked`. TRACK/PROMOTE_EVIDENCE/ADD_TO_STRATEGY create a row at
// ACTIVE — an INSERT, not a transition — so those paths do not route through validateTransition.
export const TRACKED_KEYWORD_TRANSITIONS: Record<string, readonly string[]> = {
  active:     ['paused', 'deprecated', 'replaced'],
  paused:     ['active', 'deprecated', 'replaced'],
  deprecated: ['active'],   // RESTORE — the only edge out of deprecated
  replaced:   [],           // terminal — superseded; re-tracking is a fresh insert
};

export type TrackedKeywordTransitionStatus = 'active' | 'paused' | 'deprecated' | 'replaced';

// ── Copy Section (copy pipeline) ──
// Folded from server/copy-review.ts (was a PARALLEL validator: VALID_TRANSITIONS +
// isValidTransition). The section-level review machine:
//   pending → draft                 (AI generates the copy)
//   draft → client_review | approved  (send for review, or admin fast-approve)
//   client_review → approved | revision_requested  (client responds)
//   revision_requested → draft       (author revises)
//   approved is terminal (approve harvests a voice sample; no reopen).
// Same-state no-ops (e.g. re-generating a draft) are handled at the write boundary
// in copy-review.ts by skipping the guard when from === to — never a self-edge here.
export const COPY_SECTION_TRANSITIONS: Record<string, readonly string[]> = {
  pending:            ['draft'],
  draft:              ['client_review', 'approved'],
  client_review:      ['approved', 'revision_requested'],
  revision_requested: ['draft'],
  approved:           [],  // terminal
};

export type CopySectionTransitionStatus =
  | 'pending'
  | 'draft'
  | 'client_review'
  | 'approved'
  | 'revision_requested';

// ── Voice Profile (brand engine calibration) ──
// Folded from server/voice-calibration.ts (was a PARALLEL validator:
// LEGAL_STATUS_TRANSITIONS + VoiceProfileStateTransitionError). The critical
// constraint is that draft → calibrated is FORBIDDEN — the ONLY way to reach
// `calibrated` is through `calibrating`, which runs the calibration pipeline that
// populates voiceDNA + guardrails (skipping it would inject undefined DNA into
// Layer 2 of buildSystemPrompt). See PR #168 scaled-review finding I5.
//   draft → calibrating
//   calibrating → draft | calibrated
//   calibrated → draft | calibrating   (recalibrate)
// No terminal state (a calibrated profile can be re-opened for recalibration), so
// this table is registered in the envelope but is NOT part of the graph-contract's
// terminal-requiring pinned list. Same-state no-ops are pre-filtered at the write
// boundary in voice-calibration.ts (updates.status !== profile.status).
export const VOICE_PROFILE_TRANSITIONS: Record<string, readonly string[]> = {
  draft:       ['calibrating'],
  calibrating: ['draft', 'calibrated'],
  calibrated:  ['draft', 'calibrating'],
};

export type VoiceProfileTransitionStatus = 'draft' | 'calibrating' | 'calibrated';

// ── Insight resolution (analytics_insights.resolution_status) ──
// The unguarded resolveInsight() path (server/analytics-insights-store.ts). The
// stored column is nullable: a freshly computed insight has resolution_status NULL
// (838 NULL rows in dev). NULL is modeled as the synthetic `unresolved` origin —
// resolveInsight() coerces `currentStatus ?? 'unresolved'` before validating so a
// null-origin NEVER crashes validateTransition.
//   unresolved → in_progress | resolved   (start work, or resolve directly)
//   in_progress → resolved                 (finish)
//   resolved → in_progress                 (reopen — an admin/agent can re-open a
//                                           resolved insight; previously tolerated,
//                                           kept legal to avoid a runtime regression)
// Idempotent replays (resolved → resolved, in_progress → in_progress) are handled
// as a no-op at the call site (skip the guard when from === to) — NOT self-edges,
// so this table has no self-transitions. No terminal state (resolved is reopenable),
// so it is envelope-registered but not in the graph-contract pinned list.
export const INSIGHT_RESOLUTION_TRANSITIONS: Record<string, readonly string[]> = {
  unresolved:  ['in_progress', 'resolved'],
  in_progress: ['resolved'],
  resolved:    ['in_progress'],
};

export type InsightResolutionTransitionStatus = 'unresolved' | 'in_progress' | 'resolved';

// ── Discovery Extraction (brand engine discovery) ──
// server/discovery-ingestion.ts updateExtractionStatus. A triage lifecycle:
//   pending → accepted | dismissed
//   accepted / dismissed are terminal.
// Re-accepting/re-dismissing an already-resolved extraction (idempotent PATCH) is a
// no-op skipped at the write boundary — never a self-edge.
export const EXTRACTION_TRANSITIONS: Record<string, readonly string[]> = {
  pending:   ['accepted', 'dismissed'],
  accepted:  [],  // terminal
  dismissed: [],  // terminal
};

export type ExtractionTransitionStatus = 'pending' | 'accepted' | 'dismissed';

// ── Suggested Brief (content decay → brief suggestion triage) ──
// server/suggested-briefs-store.ts. Triage lifecycle:
//   pending → accepted | dismissed | snoozed
//   snoozed → accepted | dismissed | pending   (snooze expires back to pending)
//   accepted / dismissed are terminal.
export const SUGGESTED_BRIEF_TRANSITIONS: Record<string, readonly string[]> = {
  pending:   ['accepted', 'dismissed', 'snoozed'],
  snoozed:   ['accepted', 'dismissed', 'pending'],
  accepted:  [],  // terminal
  dismissed: [],  // terminal
};

export type SuggestedBriefTransitionStatus = 'pending' | 'accepted' | 'dismissed' | 'snoozed';

// ── SEO Suggestion (Webflow SEO meta suggestions) ──
// server/seo-suggestions.ts markApplied/dismissSuggestions (bulk WHERE id IN writes).
//   pending → applied | dismissed
//   applied / dismissed are terminal.
// Bulk writes read each row's current status and skip idempotent no-ops (re-dismiss a
// dismissed suggestion, re-apply an applied one) at the write boundary — no self-edges.
export const SEO_SUGGESTION_TRANSITIONS: Record<string, readonly string[]> = {
  pending:   ['applied', 'dismissed'],
  applied:   [],  // terminal
  dismissed: [],  // terminal
};

export type SeoSuggestionTransitionStatus = 'pending' | 'applied' | 'dismissed';

// ── Pending Schema (schema queue pre-generation) ──
// server/schema-queue.ts. Pre-generated skeletons queued for a matrix cell:
//   pending → applied | stale
//   applied / stale are terminal.
// markStaleByCellId already filters WHERE status = 'pending' in SQL; the guard is
// belt-and-suspenders at the row level for any future direct-write path.
export const PENDING_SCHEMA_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['applied', 'stale'],
  applied: [],  // terminal
  stale:   [],  // terminal
};

export type PendingSchemaTransitionStatus = 'pending' | 'applied' | 'stale';

// ── Client Signal (intent signals from client chat) ──
// server/client-signals-store.ts updateSignalStatus. Operator triage.
// IMPORTANT: the admin route (routes/client-signals.ts) DELIBERATELY allows both
// forward AND backward moves so an operator can undo a mis-triage ("Status
// transitions are intentionally unrestricted"). The guard therefore models the full
// reversible triage graph among the three valid statuses — its job is to reject
// out-of-union values (the stale store comment named new/acknowledged/resolved) and
// centralise the vocabulary, NOT to impose a forward-only pipeline that would break
// the documented undo path. Same-status no-ops are skipped at the write boundary.
export const CLIENT_SIGNAL_TRANSITIONS: Record<string, readonly string[]> = {
  new:      ['reviewed', 'actioned'],
  reviewed: ['new', 'actioned'],
  actioned: ['new', 'reviewed'],
};

export type ClientSignalTransitionStatus = 'new' | 'reviewed' | 'actioned';

// ── Site Blueprint (page strategy) ──
// server/page-strategy.ts updateBlueprint. Blueprint lifecycle:
//   draft → active                (activate after generation/edit)
//   active → archived | draft      (archive, or send back to rework)
//   archived → draft | active      (unarchive to rework or reactivate)
// archived is the primary terminal but reopenable (rework). Same-status updates from
// the general update() path skip the guard at the write boundary (from === to).
export const BLUEPRINT_TRANSITIONS: Record<string, readonly string[]> = {
  draft:    ['active', 'archived'],
  active:   ['archived', 'draft'],
  archived: ['draft', 'active'],
};

export type BlueprintTransitionStatus = 'draft' | 'active' | 'archived';

// ── Brand Identity Deliverable (brand engine) ──
// server/brand-identity.ts setDeliverableStatus. Two-state approve/revert cycle:
//   draft → approved
//   approved → draft   (revert to editing)
// Re-approval (approved → approved) is a no-op short-circuited in setDeliverableStatus
// (it captures priorStatus and skips the guard + side-effect when unchanged).
export const BRAND_DELIVERABLE_TRANSITIONS: Record<string, readonly string[]> = {
  draft:    ['approved'],
  approved: ['draft'],
};

export type BrandDeliverableTransitionStatus = 'draft' | 'approved';

// ── Client Location (local SEO) ──
// server/client-locations.ts updateClientLocation. Two-state confirmation cycle:
//   needs_review → confirmed
//   confirmed → needs_review   (re-review, e.g. GBP data drift)
// Same-status updates from the general update() path skip the guard (from === to).
export const CLIENT_LOCATION_TRANSITIONS: Record<string, readonly string[]> = {
  needs_review: ['confirmed'],
  confirmed:    ['needs_review'],
};

export type ClientLocationTransitionStatus = 'needs_review' | 'confirmed';

// ── Content Matrix Generation Run ──
// M0 lands the durable lifecycle before M1/M3 execute work. Structural reads
// never create a run; retries reopen only the explicitly resumable states.
export const MATRIX_GENERATION_RUN_TRANSITIONS = {
  queued: ['running', 'blocked', 'conflict', 'cancelled', 'failed'],
  running: ['awaiting_review', 'completed', 'completed_with_errors', 'blocked', 'conflict', 'cancelled', 'failed'],
  awaiting_review: ['running', 'completed', 'completed_with_errors', 'cancelled'],
  completed: [],
  completed_with_errors: ['running'],
  blocked: ['queued', 'running', 'cancelled', 'failed'],
  conflict: ['queued', 'running', 'cancelled', 'failed'],
  cancelled: [],
  failed: ['queued', 'running', 'cancelled'],
} as const satisfies Record<MatrixGenerationRunStatus, readonly MatrixGenerationRunStatus[]>;

// ── Content Matrix Generation Item ──
export const MATRIX_GENERATION_ITEM_TRANSITIONS = {
  queued: ['preflighting', 'cancelled', 'failed'],
  preflighting: ['preflighted', 'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'],
  preflighted: ['generating_brief', 'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'],
  generating_brief: ['generating_post', 'needs_attention', 'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'],
  generating_post: ['auditing_deterministic', 'needs_attention', 'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'],
  auditing_deterministic: ['auditing_model', 'revising', 'ready_for_human_review', 'needs_attention', 'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'],
  auditing_model: ['revising', 'ready_for_human_review', 'needs_attention', 'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'],
  revising: ['auditing_deterministic', 'needs_attention', 'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'],
  ready_for_human_review: [],
  needs_attention: ['queued', 'preflighting', 'cancelled'],
  blocked_missing_evidence: ['queued', 'preflighting', 'cancelled'],
  conflict: ['queued', 'preflighting', 'cancelled'],
  cancelled: [],
  failed: ['queued', 'preflighting', 'cancelled'],
} as const satisfies Record<MatrixGenerationItemStatus, readonly MatrixGenerationItemStatus[]>;

// ── Content Matrix Generation Attempt ──
export const MATRIX_GENERATION_ATTEMPT_TRANSITIONS = {
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
} as const satisfies Record<MatrixGenerationAttemptStatus, readonly MatrixGenerationAttemptStatus[]>;

// ── Brand Deliverable Generation Run ──
// A full-suite bootstrap pauses truthfully in awaiting_review until an exact
// finalized voice version resumes it. Explicit review-directed revisions may
// reopen completed or mixed runs; cancelled runs remain terminal.
export const BRAND_GENERATION_RUN_TRANSITIONS = {
  queued: ['running', 'blocked', 'conflict', 'cancelled', 'failed'],
  running: ['awaiting_review', 'completed', 'completed_with_errors', 'blocked', 'conflict', 'cancelled', 'failed'],
  awaiting_review: ['running', 'cancelled', 'failed'],
  completed: ['running'],
  completed_with_errors: ['running', 'cancelled'],
  blocked: ['running', 'cancelled', 'failed'],
  conflict: ['running', 'cancelled', 'failed'],
  cancelled: [],
  failed: ['running', 'cancelled'],
} as const satisfies Record<BrandGenerationRunStatus, readonly BrandGenerationRunStatus[]>;

// ── Brand Deliverable Generation Item ──
export const BRAND_GENERATION_ITEM_TRANSITIONS = {
  queued: ['preflighting', 'cancelled', 'failed'],
  preflighting: ['generating', 'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'],
  generating: ['auditing_deterministic', 'needs_attention', 'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'],
  // The review states are also legal recovery targets when a human-requested
  // revision is cancelled or fails after entering either audit stage. The
  // worker uses changes_requested because acceptance invalidated old lineage.
  auditing_deterministic: ['auditing_model', 'revising', 'ready_for_human_review', 'changes_requested', 'needs_attention', 'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'],
  auditing_model: ['revising', 'ready_for_human_review', 'changes_requested', 'needs_attention', 'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'],
  revising: ['auditing_deterministic', 'ready_for_human_review', 'changes_requested', 'needs_attention', 'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'],
  ready_for_human_review: ['approved', 'changes_requested', 'revising', 'conflict'],
  approved: [],
  changes_requested: ['revising', 'cancelled'],
  needs_attention: ['preflighting', 'generating', 'revising', 'cancelled'],
  blocked_missing_evidence: ['preflighting', 'cancelled'],
  conflict: ['preflighting', 'revising', 'cancelled'],
  cancelled: [],
  failed: ['preflighting', 'generating', 'revising', 'cancelled'],
} as const satisfies Record<BrandGenerationItemStatus, readonly BrandGenerationItemStatus[]>;

// ── Brand Deliverable Generation Attempt ──
export const BRAND_GENERATION_ATTEMPT_TRANSITIONS = {
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
} as const satisfies Record<BrandGenerationAttemptStatus, readonly BrandGenerationAttemptStatus[]>;

// ── Lifecycle envelope registration ──
// A typed VIEW over the transition tables above — never a second source of truth.
// Each entry's `states` is derived from the table keys, so it can never drift from
// the map `validateTransition` actually reads. Adding a new table above WITHOUT a
// registration here fails the lifecycle-envelope contract test. Classification /
// derived-projection unions are intentionally absent (see the census doc).
//
// NOTE (R4 boundary): RECOMMENDATION_TRANSITIONS and CLIENT_REC_TRANSITIONS are the
// two-axis recommendation model. They are registered here as a FAITHFUL VIEW of the
// existing single-writer edges only — this envelope does not formalize, collapse, or
// otherwise pre-empt the two-axis shape (owner decision R4: keep the two-axis model).

/** Wrap an existing transition table as a lifecycle definition, deriving states from its keys. */
function registerTransitionTable(
  entity: string,
  transitions: Record<string, readonly string[]>,
): void {
  registerLifecycle({ entity, states: Object.keys(transitions), transitions });
}

registerTransitionTable('approval_item', APPROVAL_ITEM_TRANSITIONS);
registerTransitionTable('content_request', CONTENT_REQUEST_TRANSITIONS);
registerTransitionTable('post', POST_STATUS_TRANSITIONS);
registerTransitionTable('work_order', WORK_ORDER_TRANSITIONS);
registerTransitionTable('content_subscription', CONTENT_SUB_TRANSITIONS);
registerTransitionTable('client_action', CLIENT_ACTION_TRANSITIONS);
registerTransitionTable('recommendation', RECOMMENDATION_TRANSITIONS);
registerTransitionTable('client_recommendation', CLIENT_REC_TRANSITIONS);
registerTransitionTable('briefing_draft', BRIEFING_DRAFT_TRANSITIONS);
registerTransitionTable('background_job', BACKGROUND_JOB_TRANSITIONS);
registerTransitionTable('gbp_review_response', GBP_REVIEW_RESPONSE_TRANSITIONS);
registerTransitionTable('client_deliverable', CLIENT_DELIVERABLE_TRANSITIONS);
registerTransitionTable('matrix_cell', MATRIX_CELL_TRANSITIONS);
registerTransitionTable('client_request', REQUEST_TRANSITIONS);
registerTransitionTable('schema_plan', SCHEMA_PLAN_TRANSITIONS);
registerTransitionTable('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS);
// R3-PR2: newly folded / newly guarded lifecycles.
registerTransitionTable('copy_section', COPY_SECTION_TRANSITIONS);
registerTransitionTable('voice_profile', VOICE_PROFILE_TRANSITIONS);
registerTransitionTable('insight_resolution', INSIGHT_RESOLUTION_TRANSITIONS);
registerTransitionTable('discovery_extraction', EXTRACTION_TRANSITIONS);
registerTransitionTable('suggested_brief', SUGGESTED_BRIEF_TRANSITIONS);
registerTransitionTable('seo_suggestion', SEO_SUGGESTION_TRANSITIONS);
registerTransitionTable('pending_schema', PENDING_SCHEMA_TRANSITIONS);
registerTransitionTable('client_signal', CLIENT_SIGNAL_TRANSITIONS);
registerTransitionTable('blueprint', BLUEPRINT_TRANSITIONS);
registerTransitionTable('brand_deliverable', BRAND_DELIVERABLE_TRANSITIONS);
registerTransitionTable('client_location', CLIENT_LOCATION_TRANSITIONS);
registerTransitionTable('matrix_generation_run', MATRIX_GENERATION_RUN_TRANSITIONS);
registerTransitionTable('matrix_generation_item', MATRIX_GENERATION_ITEM_TRANSITIONS);
registerTransitionTable('matrix_generation_attempt', MATRIX_GENERATION_ATTEMPT_TRANSITIONS);
registerTransitionTable('brand_generation_run', BRAND_GENERATION_RUN_TRANSITIONS);
registerTransitionTable('brand_generation_item', BRAND_GENERATION_ITEM_TRANSITIONS);
registerTransitionTable('brand_generation_attempt', BRAND_GENERATION_ATTEMPT_TRANSITIONS);

// ── Generic validator ──

export class InvalidTransitionError extends Error {
  readonly entity: string;
  readonly from: string;
  readonly to: string;
  constructor(entity: string, from: string, to: string) {
    super(`Invalid ${entity} transition: '${from}' → '${to}'`);
    this.name = 'InvalidTransitionError';
    this.entity = entity;
    this.from = from;
    this.to = to;
  }
}

/**
 * Validate a status transition against a transition map.
 * Throws InvalidTransitionError if the transition is not allowed.
 * Returns the new status for convenient chaining.
 */
export function validateTransition<T extends string>(
  entity: string,
  transitions: Record<string, readonly string[]>,
  from: T,
  to: T,
): T {
  const allowed = transitions[from];
  if (!allowed) {
    throw new InvalidTransitionError(entity, from, to);
  }
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(entity, from, to);
  }
  return to;
}
