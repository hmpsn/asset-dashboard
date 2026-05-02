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
  generating: ['draft'],
  draft:      ['review'],
  review:     ['approved', 'draft'],  // draft = send back for edits
  approved:   [],                     // terminal (publish is tracked separately)
};

export type PostStatus = 'generating' | 'draft' | 'review' | 'approved';

// ── Work Order ──
export const WORK_ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  pending:     ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed:   [],  // terminal
  cancelled:   [],  // terminal
};

export type WorkOrderStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

// ── Content Subscription ──
export const CONTENT_SUB_TRANSITIONS: Record<string, readonly string[]> = {
  pending:   ['active', 'cancelled'],
  active:    ['paused', 'cancelled', 'past_due'],
  paused:    ['active', 'cancelled'],
  past_due:  ['active', 'cancelled'],
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
