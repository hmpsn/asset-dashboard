import {
  GBP_REVIEW_RESPONSE_ACTOR_TYPES,
  GBP_REVIEW_RESPONSE_STATUSES,
  type GbpReviewResponseSummary,
} from '../../../../shared/types/google-business-profile.js';
import type { ClientDeliverable } from '../../../../shared/types/client-deliverable.js';
import { broadcastToWorkspace } from '../../../broadcast.js';
import { isFeatureEnabled } from '../../../feature-flags.js';
import {
  GbpReviewResponseError,
  recordGbpReviewResponseDecision,
} from '../../../google-business-profile-review-responses-store.js';
import { WS_EVENTS } from '../../../ws-events.js';
import type { startPublishForApprovedResponse as StartPublishForApprovedResponse } from '../../../google-business-profile-review-response-publish-job.js';
import {
  registerAdapter,
  type BuiltDeliverablePayload,
  type DeliverableAdapter,
  type DeliverableSourceDecision,
  type RespondToSourceOptions,
  type RespondToSourceResult,
  type SendableResult,
} from './types.js';

export interface GbpReviewResponseDeliverableInput {
  response: GbpReviewResponseSummary;
}

export interface GbpReviewResponseDeliverablePayload {
  family: 'gbp_review_response';
  responseId: string;
  reviewResourceName: string;
  googleLocationId: string;
  clientLocationId: string | null;
  locationTitle: string | null;
  ratingValue: number | null;
  reviewerDisplayName: string | null;
  reviewerIsAnonymous: boolean;
  reviewText: string | null;
  proposedReply: string;
  [key: string]: unknown;
}

function sourceRef(responseId: string): string {
  return `gbp_review_response:${responseId}`;
}

function buildPayload(response: GbpReviewResponseSummary): GbpReviewResponseDeliverablePayload {
  return {
    family: 'gbp_review_response',
    responseId: response.id,
    reviewResourceName: response.reviewResourceName,
    googleLocationId: response.googleLocationId,
    clientLocationId: response.clientLocationId ?? null,
    locationTitle: response.review.locationTitle ?? null,
    ratingValue: response.review.ratingValue ?? null,
    reviewerDisplayName: response.review.reviewerDisplayName ?? null,
    reviewerIsAnonymous: response.review.reviewerIsAnonymous,
    reviewText: response.review.commentExcerpt ?? null,
    proposedReply: response.editedText ?? response.draftText,
  };
}

function responseFeatureEnabled(workspaceId: string): boolean {
  return isFeatureEnabled('gbp-auth-connection', workspaceId)
    && isFeatureEnabled('gbp-auth-reviews', workspaceId)
    && isFeatureEnabled('gbp-review-responses', workspaceId);
}

function broadcastResponseUpdate(workspaceId: string, action: string, responseId: string): void {
  broadcastToWorkspace(workspaceId, WS_EVENTS.GBP_REVIEW_RESPONSES_UPDATED, {
    workspaceId,
    responseId,
    action,
    updatedAt: new Date().toISOString(),
  });
}

function responseIdFromDeliverable(deliverable: ClientDeliverable): string {
  const raw = (deliverable.payload as { responseId?: unknown }).responseId;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('GBP review response deliverable is missing responseId');
  }
  return raw;
}

export const gbpReviewResponseAdapter: DeliverableAdapter<GbpReviewResponseDeliverableInput> = {
  type: 'gbp_review_response',
  validateSendable: ({ response }): SendableResult => {
    if (!response.id) return { ok: false, reason: 'review response has no id' };
    if (response.status === GBP_REVIEW_RESPONSE_STATUSES.PUBLISHED) {
      return { ok: false, reason: 'review response is already published' };
    }
    if (
      response.status !== GBP_REVIEW_RESPONSE_STATUSES.DRAFT
      && response.status !== GBP_REVIEW_RESPONSE_STATUSES.CHANGES_REQUESTED
      && response.status !== GBP_REVIEW_RESPONSE_STATUSES.AWAITING_CLIENT
    ) {
      return { ok: false, reason: 'review response is not ready to send to the client' };
    }
    if (!response.draftText.trim()) return { ok: false, reason: 'review response draft is empty' };
    if (response.review.hasReply) return { ok: false, reason: 'review already has a Google reply' };
    return { ok: true };
  },
  buildPayload: ({ response }): BuiltDeliverablePayload => ({
    title: `Review response: ${response.review.locationTitle ?? 'Google Business Profile'}`,
    summary: response.review.commentExcerpt ?? 'Approve this public Google review response.',
    kind: 'review',
    payload: buildPayload(response),
    externalRef: response.reviewResourceName,
  }),
  sourceRef: ({ response }) => sourceRef(response.id),
  async respondToSource(
    workspaceId: string,
    deliverable: ClientDeliverable,
    decision: DeliverableSourceDecision,
    opts?: RespondToSourceOptions,
  ): Promise<RespondToSourceResult> {
    if (!responseFeatureEnabled(workspaceId)) {
      throw new GbpReviewResponseError('Google Business Profile review responses are not enabled', 404);
    }
    const responseId = responseIdFromDeliverable(deliverable);
    const actor = {
      type: GBP_REVIEW_RESPONSE_ACTOR_TYPES.CLIENT,
      id: opts?.actor?.id,
    };
    if (decision === 'approved') {
      recordGbpReviewResponseDecision({
        workspaceId,
        responseId,
        status: 'approved',
        actor,
        note: opts?.note,
      });
      const publisher: { startPublishForApprovedResponse: typeof StartPublishForApprovedResponse } =
        await import('../../../google-business-profile-review-response-publish-job.js'); // dynamic-import-ok -- avoids adapter -> send-to-client -> publish-job import cycle while preserving typed export shape.
      publisher.startPublishForApprovedResponse(workspaceId, responseId);
      broadcastResponseUpdate(workspaceId, 'client_approved', responseId);
      return { handled: false };
    }
    recordGbpReviewResponseDecision({
      workspaceId,
      responseId,
      status: decision === 'changes_requested' ? 'changes_requested' : 'declined',
      actor,
      note: opts?.note,
    });
    broadcastResponseUpdate(workspaceId, decision, responseId);
    return { handled: false };
  },
};

registerAdapter(gbpReviewResponseAdapter as DeliverableAdapter);
