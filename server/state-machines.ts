/**
 * Centralized state machine transition guards.
 *
 * Every entity with a status column should define its valid transitions here.
 * Call validateTransition() before mutating status in DB layer functions.
 */

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
  generating: ['draft', 'error'],
  error:      ['draft'],
  draft:      ['review'],
  review:     ['approved', 'draft'],  // draft = send back for edits
  approved:   [],                     // terminal (publish is tracked separately)
};

export type PostStatus = 'generating' | 'draft' | 'review' | 'approved' | 'error';

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
  pending:     ['in_progress', 'completed', 'dismissed'],
  in_progress: ['pending', 'completed', 'dismissed'],
  completed:   ['pending', 'in_progress'],   // pending/in_progress = issue re-detected
  dismissed:   ['pending'],                  // un-dismiss
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

export type DeliverableStateStatus =
  | 'draft'
  | 'awaiting_client'
  | 'changes_requested'
  | 'partial'
  | 'approved'
  | 'declined'
  | 'applied'
  | 'expired'
  | 'cancelled'
  | 'ordered'
  | 'in_progress'
  | 'completed';

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
// through validateTransition, but `applyKeywordCommandCenterActionInternal` flipped
// active↔paused↔deprecated directly. This map closes that gap so the live KCC/Hub
// action engine refuses illegal moves (defense-in-depth: an illegal transition is
// "never allowed", orthogonal to protection which is "needs confirmation").
//
// The edge set is DERIVED from the real action switch (`applyKeywordCommandCenterActionInternal`)
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
