import { randomUUID } from 'crypto';

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { getGbpConnectionSafe } from './google-business-profile-store.js';
import {
  GBP_REVIEW_RESPONSE_ACTOR_TYPES,
  GBP_REVIEW_RESPONSE_EVENT_TYPES,
  GBP_REVIEW_RESPONSE_STATUSES,
  type GbpReviewRating,
  type GbpReviewResponseActorType,
  type GbpReviewResponseEvent,
  type GbpReviewResponseEventType,
  type GbpReviewResponseReviewContext,
  type GbpReviewResponseStatus,
  type GbpReviewResponseSummary,
  type GbpReviewResponseWorkflowRead,
} from '../shared/types/google-business-profile.js';
import { GBP_REVIEW_RESPONSE_TRANSITIONS, validateTransition } from './state-machines.js';

export class GbpReviewResponseError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GbpReviewResponseError';
    this.status = status;
  }
}

export interface GbpReviewResponseActor {
  type: GbpReviewResponseActorType;
  id?: string;
}

interface ReviewContextRow {
  id: string;
  workspace_id: string;
  google_location_id: string;
  client_location_id: string | null;
  review_resource_name: string;
  review_id: string;
  star_rating: GbpReviewRating;
  rating_value: number | null;
  comment: string | null;
  reviewer_display_name: string | null;
  reviewer_is_anonymous: number;
  create_time: string | null;
  update_time: string | null;
  reply_comment: string | null;
  reply_update_time: string | null;
  synced_at: string;
  location_title: string | null;
}

interface ResponseRow {
  id: string;
  workspace_id: string;
  google_location_id: string;
  client_location_id: string | null;
  review_resource_name: string;
  status: GbpReviewResponseStatus;
  draft_text: string;
  edited_text: string | null;
  sent_deliverable_id: string | null;
  approved_at: string | null;
  approved_by_type: GbpReviewResponseActorType | null;
  approved_by_id: string | null;
  published_at: string | null;
  google_reply_update_time: string | null;
  publish_job_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  response_id: string;
  workspace_id: string;
  event_type: GbpReviewResponseEventType;
  actor_type: GbpReviewResponseActorType;
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

const stmts = createStmtCache(() => ({
  getReviewContext: db.prepare(`
    SELECT r.*, l.title AS location_title
    FROM google_business_reviews r
    JOIN workspace_google_business_locations m
      ON m.workspace_id = r.workspace_id
      AND m.google_location_id = r.google_location_id
    JOIN google_business_locations l
      ON l.id = r.google_location_id
    WHERE r.workspace_id = ?
      AND r.review_resource_name = ?
  `),
  listEligibleReviews: db.prepare(`
    SELECT r.*, l.title AS location_title
    FROM google_business_reviews r
    JOIN workspace_google_business_locations m
      ON m.workspace_id = r.workspace_id
      AND m.google_location_id = r.google_location_id
    JOIN google_business_locations l
      ON l.id = r.google_location_id
    WHERE r.workspace_id = ?
      AND (r.reply_comment IS NULL OR TRIM(r.reply_comment) = '')
    ORDER BY COALESCE(r.update_time, r.create_time, r.synced_at) DESC
    LIMIT 100
  `),
  getResponse: db.prepare(`
    SELECT *
    FROM google_business_review_responses
    WHERE id = ? AND workspace_id = ?
  `),
  getResponseByReview: db.prepare(`
    SELECT *
    FROM google_business_review_responses
    WHERE workspace_id = ? AND review_resource_name = ?
  `),
  listResponses: db.prepare(`
    SELECT *
    FROM google_business_review_responses
    WHERE workspace_id = ?
    ORDER BY updated_at DESC
    LIMIT 100
  `),
  insertResponse: db.prepare(`
    INSERT INTO google_business_review_responses (
      id, workspace_id, google_location_id, client_location_id, review_resource_name,
      status, draft_text, edited_text, sent_deliverable_id, approved_at, approved_by_type,
      approved_by_id, published_at, google_reply_update_time, publish_job_id, last_error,
      created_at, updated_at
    )
    VALUES (
      @id, @workspaceId, @googleLocationId, @clientLocationId, @reviewResourceName,
      @status, @draftText, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL,
      @now, @now
    )
  `),
  updateDraft: db.prepare(`
    UPDATE google_business_review_responses
    SET status = @status, -- status-ok: guarded by validateTransition before status changes
      draft_text = @draftText, edited_text = @editedText,
      last_error = NULL, updated_at = @now
    WHERE id = @id AND workspace_id = @workspaceId
  `),
  markSent: db.prepare(`
    UPDATE google_business_review_responses
    SET status = 'awaiting_client', sent_deliverable_id = @deliverableId, updated_at = @now -- status-ok: GBP_REVIEW_RESPONSE_TRANSITIONS guard runs in the calling mark* function before this write
    WHERE id = @id AND workspace_id = @workspaceId
  `),
  markDecision: db.prepare(`
    UPDATE google_business_review_responses
    SET status = @status, -- status-ok: guarded by validateTransition before status changes
      approved_at = @approvedAt, approved_by_type = @approvedByType,
      approved_by_id = @approvedById, last_error = NULL, updated_at = @now
    WHERE id = @id AND workspace_id = @workspaceId
  `),
  markPublishing: db.prepare(`
    UPDATE google_business_review_responses
    SET status = 'publishing', publish_job_id = @jobId, last_error = NULL, updated_at = @now -- status-ok: GBP_REVIEW_RESPONSE_TRANSITIONS guard runs in the calling mark* function before this write
    WHERE id = @id AND workspace_id = @workspaceId
  `),
  markPublished: db.prepare(`
    UPDATE google_business_review_responses
    SET status = 'published', published_at = @publishedAt, google_reply_update_time = @googleReplyUpdateTime, -- status-ok: GBP_REVIEW_RESPONSE_TRANSITIONS guard runs in the calling mark* function before this write
      last_error = NULL, updated_at = @publishedAt
    WHERE id = @id AND workspace_id = @workspaceId
  `),
  markPublishFailed: db.prepare(`
    UPDATE google_business_review_responses
    SET status = 'publish_failed', last_error = @error, updated_at = @now -- status-ok: GBP_REVIEW_RESPONSE_TRANSITIONS guard runs in the calling mark* function before this write
    WHERE id = @id AND workspace_id = @workspaceId
  `),
  insertEvent: db.prepare(`
    INSERT INTO google_business_review_response_events (
      id, response_id, workspace_id, event_type, actor_type, actor_id, note, created_at
    )
    VALUES (@id, @responseId, @workspaceId, @eventType, @actorType, @actorId, @note, @createdAt)
  `),
  insertAttempt: db.prepare(`
    INSERT INTO google_business_review_reply_publish_attempts (
      id, response_id, workspace_id, job_id, status, provider_status, provider_kind,
      error, started_at, completed_at
    )
    VALUES (@id, @responseId, @workspaceId, @jobId, 'running', NULL, NULL, NULL, @startedAt, NULL)
  `),
  markAttemptDone: db.prepare(`
    UPDATE google_business_review_reply_publish_attempts
    SET status = 'done', completed_at = @completedAt -- status-ok: documented exemption — provider-attempt/job tracker (running→done/failed), NOT the response lifecycle. Insert-running then terminal outcome, per attempt. Census classification (docs/rules/lifecycle-state-machines.md).
    WHERE id = @id AND workspace_id = @workspaceId
  `),
  markAttemptFailed: db.prepare(`
    UPDATE google_business_review_reply_publish_attempts
    SET status = 'failed', provider_status = @providerStatus, provider_kind = @providerKind, -- status-ok: documented exemption — provider-attempt/job tracker (see markAttemptDone), not a guarded lifecycle. docs/rules/lifecycle-state-machines.md.
      error = @error, completed_at = @completedAt
    WHERE id = @id AND workspace_id = @workspaceId
  `),
  updateReviewReply: db.prepare(`
    UPDATE google_business_reviews
    SET reply_comment = @replyComment, reply_update_time = @replyUpdateTime,
      reply_state = @replyState, updated_at = @updatedAt
    WHERE workspace_id = @workspaceId AND review_resource_name = @reviewResourceName
  `),
  listEvents: db.prepare(`
    SELECT *
    FROM google_business_review_response_events
    WHERE workspace_id = ? AND response_id = ?
    ORDER BY created_at ASC
  `),
}));

function currentReplyText(row: ResponseRow): string {
  return row.edited_text?.trim() || row.draft_text;
}

function commentExcerpt(value: string | null): string | undefined {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length > 260 ? `${cleaned.slice(0, 257).trim()}...` : cleaned;
}

function rowToReviewContext(row: ReviewContextRow, includeText: boolean): GbpReviewResponseReviewContext {
  return {
    id: row.id,
    googleLocationId: row.google_location_id,
    ...(row.client_location_id ? { clientLocationId: row.client_location_id } : {}),
    reviewResourceName: row.review_resource_name,
    reviewId: row.review_id,
    rating: row.star_rating,
    ...(typeof row.rating_value === 'number' ? { ratingValue: row.rating_value } : {}),
    ...(commentExcerpt(row.comment) ? { commentExcerpt: commentExcerpt(row.comment) } : {}),
    ...(includeText && row.comment ? { commentText: row.comment } : {}),
    ...(row.reviewer_display_name ? { reviewerDisplayName: row.reviewer_display_name } : {}),
    reviewerIsAnonymous: row.reviewer_is_anonymous === 1,
    ...(row.create_time ? { createTime: row.create_time } : {}),
    ...(row.update_time ? { updateTime: row.update_time } : {}),
    hasReply: Boolean(row.reply_comment?.trim()),
    ...(row.reply_update_time ? { replyUpdateTime: row.reply_update_time } : {}),
    syncedAt: row.synced_at,
    ...(row.location_title ? { locationTitle: row.location_title } : {}),
  };
}

function rowToEvent(row: EventRow): GbpReviewResponseEvent {
  return {
    id: row.id,
    responseId: row.response_id,
    workspaceId: row.workspace_id,
    type: row.event_type,
    actorType: row.actor_type,
    ...(row.actor_id ? { actorId: row.actor_id } : {}),
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.created_at,
  };
}

function rowToSummary(row: ResponseRow, review: GbpReviewResponseReviewContext): GbpReviewResponseSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    reviewResourceName: row.review_resource_name,
    googleLocationId: row.google_location_id,
    ...(row.client_location_id ? { clientLocationId: row.client_location_id } : {}),
    status: row.status,
    draftText: row.draft_text,
    ...(row.edited_text ? { editedText: row.edited_text } : {}),
    ...(row.sent_deliverable_id ? { sentDeliverableId: row.sent_deliverable_id } : {}),
    ...(row.approved_at ? { approvedAt: row.approved_at } : {}),
    ...(row.approved_by_type ? { approvedByType: row.approved_by_type } : {}),
    ...(row.approved_by_id ? { approvedById: row.approved_by_id } : {}),
    ...(row.published_at ? { publishedAt: row.published_at } : {}),
    ...(row.google_reply_update_time ? { googleReplyUpdateTime: row.google_reply_update_time } : {}),
    ...(row.publish_job_id ? { publishJobId: row.publish_job_id } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    review,
  };
}

function insertEvent(
  response: ResponseRow,
  type: GbpReviewResponseEventType,
  actor: GbpReviewResponseActor,
  note?: string | null,
): void {
  stmts().insertEvent.run({
    id: randomUUID(),
    responseId: response.id,
    workspaceId: response.workspace_id,
    eventType: type,
    actorType: actor.type,
    actorId: actor.id ?? null,
    note: note ?? null,
    createdAt: new Date().toISOString(),
  });
}

function getReviewContextOrThrow(
  workspaceId: string,
  reviewResourceName: string,
  options: { requireUnanswered: boolean; includeText: boolean },
): GbpReviewResponseReviewContext {
  const row = stmts().getReviewContext.get(workspaceId, reviewResourceName) as ReviewContextRow | undefined;
  if (!row) throw new GbpReviewResponseError('Review not found', 404);
  if (options.requireUnanswered && row.reply_comment?.trim()) {
    throw new GbpReviewResponseError('Existing Google replies are read-only in this phase', 409);
  }
  return rowToReviewContext(row, options.includeText);
}

export function getGbpReviewContextForDraft(
  workspaceId: string,
  reviewResourceName: string,
): GbpReviewResponseReviewContext {
  return getReviewContextOrThrow(workspaceId, reviewResourceName, {
    requireUnanswered: true,
    includeText: true,
  });
}

export function getGbpReviewResponse(workspaceId: string, responseId: string): GbpReviewResponseSummary | null {
  const row = stmts().getResponse.get(responseId, workspaceId) as ResponseRow | undefined;
  if (!row) return null;
  const review = getReviewContextOrThrow(workspaceId, row.review_resource_name, {
    requireUnanswered: false,
    includeText: false,
  });
  return rowToSummary(row, review);
}

export function listGbpReviewResponseWorkflow(workspaceId: string): GbpReviewResponseWorkflowRead {
  const connection = getGbpConnectionSafe();
  const eligibleReviews = (stmts().listEligibleReviews.all(workspaceId) as ReviewContextRow[])
    .map(row => rowToReviewContext(row, false));
  const rows = stmts().listResponses.all(workspaceId) as ResponseRow[];
  const reviewByResource = new Map(eligibleReviews.map(review => [review.reviewResourceName, review]));
  const responses = rows.map(row => {
    const review = reviewByResource.get(row.review_resource_name)
      ?? getReviewContextOrThrow(workspaceId, row.review_resource_name, {
        requireUnanswered: false,
        includeText: false,
      });
    return rowToSummary(row, review);
  });
  return {
    connection,
    eligibleReviews,
    responses,
    policy: {
      rawReviewTextUsedForDraftingOnly: true,
      guidance: 'Raw authenticated review text may be used only to draft a response for that review. It remains unavailable to general copy or intelligence generation.',
    },
  };
}

export function upsertGbpReviewResponseDraft(input: {
  workspaceId: string;
  reviewResourceName: string;
  draftText: string;
  actor: GbpReviewResponseActor;
}): GbpReviewResponseSummary {
  const review = getReviewContextOrThrow(input.workspaceId, input.reviewResourceName, {
    requireUnanswered: true,
    includeText: true,
  });
  const existing = stmts().getResponseByReview.get(input.workspaceId, input.reviewResourceName) as ResponseRow | undefined;
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    if (!existing) {
      stmts().insertResponse.run({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        googleLocationId: review.googleLocationId,
        clientLocationId: review.clientLocationId ?? null,
        reviewResourceName: input.reviewResourceName,
        status: GBP_REVIEW_RESPONSE_STATUSES.DRAFT,
        draftText: input.draftText,
        now,
      });
      const created = stmts().getResponseByReview.get(input.workspaceId, input.reviewResourceName) as ResponseRow;
      insertEvent(created, GBP_REVIEW_RESPONSE_EVENT_TYPES.DRAFT_GENERATED, input.actor);
      return created;
    }
    if (existing.status !== GBP_REVIEW_RESPONSE_STATUSES.DRAFT) {
      validateTransition('gbp_review_response', GBP_REVIEW_RESPONSE_TRANSITIONS, existing.status, GBP_REVIEW_RESPONSE_STATUSES.DRAFT);
    }
    stmts().updateDraft.run({
      id: existing.id,
      workspaceId: input.workspaceId,
      status: GBP_REVIEW_RESPONSE_STATUSES.DRAFT,
      draftText: input.draftText,
      editedText: null,
      now,
    });
    const updated = stmts().getResponse.get(existing.id, input.workspaceId) as ResponseRow;
    insertEvent(updated, GBP_REVIEW_RESPONSE_EVENT_TYPES.DRAFT_GENERATED, input.actor);
    return updated;
  });
  const row = tx();
  const publicReview = getReviewContextOrThrow(input.workspaceId, row.review_resource_name, {
    requireUnanswered: true,
    includeText: false,
  });
  return rowToSummary(row, publicReview);
}

export function updateGbpReviewResponseDraft(input: {
  workspaceId: string;
  responseId: string;
  draftText: string;
  actor: GbpReviewResponseActor;
}): GbpReviewResponseSummary {
  const existing = stmts().getResponse.get(input.responseId, input.workspaceId) as ResponseRow | undefined;
  if (!existing) throw new GbpReviewResponseError('Review response not found', 404);
  if (
    existing.status !== GBP_REVIEW_RESPONSE_STATUSES.DRAFT
    && existing.status !== GBP_REVIEW_RESPONSE_STATUSES.CHANGES_REQUESTED
  ) {
    throw new GbpReviewResponseError('Only draft or changes-requested responses can be edited before approval', 409);
  }
  const now = new Date().toISOString();
  stmts().updateDraft.run({
    id: existing.id,
    workspaceId: input.workspaceId,
    status: existing.status,
    draftText: input.draftText,
    editedText: input.draftText,
    now,
  });
  const updated = stmts().getResponse.get(input.responseId, input.workspaceId) as ResponseRow;
  insertEvent(updated, GBP_REVIEW_RESPONSE_EVENT_TYPES.DRAFT_EDITED, input.actor);
  const review = getReviewContextOrThrow(input.workspaceId, updated.review_resource_name, {
    requireUnanswered: true,
    includeText: false,
  });
  return rowToSummary(updated, review);
}

export function assertGbpReviewResponseSendable(workspaceId: string, responseId: string): GbpReviewResponseSummary {
  const existing = stmts().getResponse.get(responseId, workspaceId) as ResponseRow | undefined;
  if (!existing) throw new GbpReviewResponseError('Review response not found', 404);
  if (
    existing.status !== GBP_REVIEW_RESPONSE_STATUSES.DRAFT
    && existing.status !== GBP_REVIEW_RESPONSE_STATUSES.CHANGES_REQUESTED
    && existing.status !== GBP_REVIEW_RESPONSE_STATUSES.AWAITING_CLIENT
  ) {
    throw new GbpReviewResponseError('Only draft or client-awaiting review responses can be sent to the client', 409);
  }
  const review = getReviewContextOrThrow(workspaceId, existing.review_resource_name, {
    requireUnanswered: true,
    includeText: false,
  });
  return rowToSummary(existing, review);
}

export function markGbpReviewResponseSent(input: {
  workspaceId: string;
  responseId: string;
  deliverableId: string;
  actor: GbpReviewResponseActor;
  note?: string | null;
}): GbpReviewResponseSummary {
  const existing = stmts().getResponse.get(input.responseId, input.workspaceId) as ResponseRow | undefined;
  if (!existing) throw new GbpReviewResponseError('Review response not found', 404);
  validateTransition('gbp_review_response', GBP_REVIEW_RESPONSE_TRANSITIONS, existing.status, GBP_REVIEW_RESPONSE_STATUSES.AWAITING_CLIENT);
  stmts().markSent.run({
    id: existing.id,
    workspaceId: input.workspaceId,
    deliverableId: input.deliverableId,
    now: new Date().toISOString(),
  });
  const updated = stmts().getResponse.get(input.responseId, input.workspaceId) as ResponseRow;
  insertEvent(updated, GBP_REVIEW_RESPONSE_EVENT_TYPES.SENT_TO_CLIENT, input.actor, input.note);
  const review = getReviewContextOrThrow(input.workspaceId, updated.review_resource_name, {
    requireUnanswered: true,
    includeText: false,
  });
  return rowToSummary(updated, review);
}

export function recordGbpReviewResponseDecision(input: {
  workspaceId: string;
  responseId: string;
  status: Extract<GbpReviewResponseStatus, 'approved' | 'changes_requested' | 'declined'>;
  actor: GbpReviewResponseActor;
  note?: string | null;
}): GbpReviewResponseSummary {
  const existing = stmts().getResponse.get(input.responseId, input.workspaceId) as ResponseRow | undefined;
  if (!existing) throw new GbpReviewResponseError('Review response not found', 404);
  validateTransition('gbp_review_response', GBP_REVIEW_RESPONSE_TRANSITIONS, existing.status, input.status);
  const now = new Date().toISOString();
  const approved = input.status === GBP_REVIEW_RESPONSE_STATUSES.APPROVED;
  stmts().markDecision.run({
    id: existing.id,
    workspaceId: input.workspaceId,
    status: input.status,
    approvedAt: approved ? now : null,
    approvedByType: approved ? input.actor.type : null,
    approvedById: approved ? input.actor.id ?? null : null,
    now,
  });
  const updated = stmts().getResponse.get(input.responseId, input.workspaceId) as ResponseRow;
  const eventType = input.status === GBP_REVIEW_RESPONSE_STATUSES.APPROVED
    ? input.actor.type === GBP_REVIEW_RESPONSE_ACTOR_TYPES.CLIENT
      ? GBP_REVIEW_RESPONSE_EVENT_TYPES.CLIENT_APPROVED
      : GBP_REVIEW_RESPONSE_EVENT_TYPES.ADMIN_APPROVED
    : input.status === GBP_REVIEW_RESPONSE_STATUSES.CHANGES_REQUESTED
      ? GBP_REVIEW_RESPONSE_EVENT_TYPES.CHANGES_REQUESTED
      : GBP_REVIEW_RESPONSE_EVENT_TYPES.DECLINED;
  insertEvent(updated, eventType, input.actor, input.note);
  const review = getReviewContextOrThrow(input.workspaceId, updated.review_resource_name, {
    requireUnanswered: true,
    includeText: false,
  });
  return rowToSummary(updated, review);
}

export function beginGbpReviewResponsePublish(input: {
  workspaceId: string;
  responseId: string;
  jobId: string;
}): { response: GbpReviewResponseSummary; attemptId: string; replyText: string } {
  const existing = stmts().getResponse.get(input.responseId, input.workspaceId) as ResponseRow | undefined;
  if (!existing) throw new GbpReviewResponseError('Review response not found', 404);
  if (!existing.approved_at || !existing.approved_by_type) {
    throw new GbpReviewResponseError('Review response must be explicitly approved before publishing', 409);
  }
  validateTransition('gbp_review_response', GBP_REVIEW_RESPONSE_TRANSITIONS, existing.status, GBP_REVIEW_RESPONSE_STATUSES.PUBLISHING);
  const attemptId = randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    stmts().markPublishing.run({
      id: existing.id,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      now,
    });
    stmts().insertAttempt.run({
      id: attemptId,
      responseId: existing.id,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      startedAt: now,
    });
    const updated = stmts().getResponse.get(input.responseId, input.workspaceId) as ResponseRow;
    insertEvent(updated, GBP_REVIEW_RESPONSE_EVENT_TYPES.PUBLISH_STARTED, {
      type: GBP_REVIEW_RESPONSE_ACTOR_TYPES.SYSTEM,
      id: input.jobId,
    });
    return updated;
  });
  const updated = tx();
  const review = getReviewContextOrThrow(input.workspaceId, updated.review_resource_name, {
    requireUnanswered: true,
    includeText: false,
  });
  return { response: rowToSummary(updated, review), attemptId, replyText: currentReplyText(updated) };
}

export function completeGbpReviewResponsePublish(input: {
  workspaceId: string;
  responseId: string;
  attemptId: string;
  replyText: string;
  googleReplyUpdateTime?: string;
}): GbpReviewResponseSummary {
  const existing = stmts().getResponse.get(input.responseId, input.workspaceId) as ResponseRow | undefined;
  if (!existing) throw new GbpReviewResponseError('Review response not found', 404);
  validateTransition('gbp_review_response', GBP_REVIEW_RESPONSE_TRANSITIONS, existing.status, GBP_REVIEW_RESPONSE_STATUSES.PUBLISHED);
  const publishedAt = new Date().toISOString();
  const tx = db.transaction(() => {
    stmts().markPublished.run({
      id: input.responseId,
      workspaceId: input.workspaceId,
      publishedAt,
      googleReplyUpdateTime: input.googleReplyUpdateTime ?? publishedAt,
    });
    stmts().markAttemptDone.run({
      id: input.attemptId,
      workspaceId: input.workspaceId,
      completedAt: publishedAt,
    });
    stmts().updateReviewReply.run({
      workspaceId: input.workspaceId,
      reviewResourceName: existing.review_resource_name,
      replyComment: input.replyText,
      replyUpdateTime: input.googleReplyUpdateTime ?? publishedAt,
      replyState: 'PUBLISHED',
      updatedAt: publishedAt,
    });
    const updated = stmts().getResponse.get(input.responseId, input.workspaceId) as ResponseRow;
    insertEvent(updated, GBP_REVIEW_RESPONSE_EVENT_TYPES.PUBLISH_SUCCEEDED, {
      type: GBP_REVIEW_RESPONSE_ACTOR_TYPES.SYSTEM,
    });
    return updated;
  });
  const updated = tx();
  const review = getReviewContextOrThrow(input.workspaceId, updated.review_resource_name, {
    requireUnanswered: false,
    includeText: false,
  });
  return rowToSummary(updated, review);
}

export function failGbpReviewResponsePublish(input: {
  workspaceId: string;
  responseId: string;
  attemptId: string;
  error: string;
  providerStatus?: number;
  providerKind?: string;
}): GbpReviewResponseSummary {
  const existing = stmts().getResponse.get(input.responseId, input.workspaceId) as ResponseRow | undefined;
  if (!existing) throw new GbpReviewResponseError('Review response not found', 404);
  validateTransition('gbp_review_response', GBP_REVIEW_RESPONSE_TRANSITIONS, existing.status, GBP_REVIEW_RESPONSE_STATUSES.PUBLISH_FAILED);
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    stmts().markPublishFailed.run({
      id: input.responseId,
      workspaceId: input.workspaceId,
      error: input.error,
      now,
    });
    stmts().markAttemptFailed.run({
      id: input.attemptId,
      workspaceId: input.workspaceId,
      providerStatus: input.providerStatus ?? null,
      providerKind: input.providerKind ?? null,
      error: input.error,
      completedAt: now,
    });
    const updated = stmts().getResponse.get(input.responseId, input.workspaceId) as ResponseRow;
    insertEvent(updated, GBP_REVIEW_RESPONSE_EVENT_TYPES.PUBLISH_FAILED, {
      type: GBP_REVIEW_RESPONSE_ACTOR_TYPES.SYSTEM,
    }, input.error);
    return updated;
  });
  const updated = tx();
  const review = getReviewContextOrThrow(input.workspaceId, updated.review_resource_name, {
    requireUnanswered: true,
    includeText: false,
  });
  return rowToSummary(updated, review);
}

export function listGbpReviewResponseEvents(workspaceId: string, responseId: string): GbpReviewResponseEvent[] {
  const rows = stmts().listEvents.all(workspaceId, responseId) as EventRow[];
  return rows.map(rowToEvent);
}
