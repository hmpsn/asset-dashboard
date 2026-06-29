import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { getValidGbpAccessToken, updateGbpReviewReply } from './google-business-profile-client.js';
import { googleBusinessProfileProviderErrorMessage } from './google-business-profile-errors.js';
import {
  beginGbpReviewResponsePublish,
  completeGbpReviewResponsePublish,
  failGbpReviewResponsePublish,
  GbpReviewResponseError,
  getGbpReviewResponse,
} from './google-business-profile-review-responses-store.js';
import { isGoogleProviderError } from './google-provider-client.js';
import { createJob, updateJob } from './jobs.js';
import { createLogger } from './logger.js';
import { markDeliverableApplied } from './domains/inbox/send-to-client.js';
import { WS_EVENTS } from './ws-events.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import { GBP_REVIEW_RESPONSE_STATUSES } from '../shared/types/google-business-profile.js';

const log = createLogger('gbp-review-response-publish-job');

function broadcastResponseUpdate(workspaceId: string, action: string, responseId: string): void {
  broadcastToWorkspace(workspaceId, WS_EVENTS.GBP_REVIEW_RESPONSES_UPDATED, {
    workspaceId,
    responseId,
    action,
    updatedAt: new Date().toISOString(),
  });
}

export function startGbpReviewReplyPublishJob(input: {
  workspaceId: string;
  responseId: string;
}): { jobId: string } {
  const job = createJob(BACKGROUND_JOB_TYPES.GBP_REVIEW_REPLY_PUBLISH, {
    workspaceId: input.workspaceId,
    total: 1,
    message: 'Publishing GBP review reply...',
  });
  setTimeout(() => {
    void runGbpReviewReplyPublishJob({
      workspaceId: input.workspaceId,
      responseId: input.responseId,
      jobId: job.id,
    });
  }, 0);
  return { jobId: job.id };
}

export async function runGbpReviewReplyPublishJob(input: {
  workspaceId: string;
  responseId: string;
  jobId: string;
}): Promise<void> {
  let attemptId: string | null = null;
  try {
    updateJob(input.jobId, {
      status: 'running',
      progress: 0,
      total: 1,
      message: 'Publishing response to Google...',
    });

    const started = beginGbpReviewResponsePublish(input);
    attemptId = started.attemptId;
    broadcastResponseUpdate(input.workspaceId, 'publish_started', input.responseId);

    const { accessToken } = await getValidGbpAccessToken();
    const googleReply = await updateGbpReviewReply(
      accessToken,
      started.response.reviewResourceName,
      started.replyText,
    );

    const published = completeGbpReviewResponsePublish({
      workspaceId: input.workspaceId,
      responseId: input.responseId,
      attemptId,
      replyText: googleReply.comment ?? started.replyText,
      googleReplyUpdateTime: googleReply.updateTime,
    });

    if (published.sentDeliverableId) {
      markDeliverableApplied(input.workspaceId, published.sentDeliverableId);
    }

    addActivity(
      input.workspaceId,
      'local_seo_updated',
      'Google Business Profile review reply published',
      'An approved Google Business Profile review response was published to Google.',
      { source: 'google_business_profile', responseId: input.responseId },
    );

    updateJob(input.jobId, {
      status: 'done',
      progress: 1,
      total: 1,
      message: 'GBP review reply published',
      result: { responseId: input.responseId },
    });
    broadcastResponseUpdate(input.workspaceId, 'published', input.responseId);
  } catch (error) {
    const safeError = googleBusinessProfileProviderErrorMessage(error);
    log.error({ err: error, workspaceId: input.workspaceId, responseId: input.responseId }, 'GBP review reply publish failed');
    if (attemptId) {
      failGbpReviewResponsePublish({
        workspaceId: input.workspaceId,
        responseId: input.responseId,
        attemptId,
        error: safeError,
        providerStatus: isGoogleProviderError(error) ? error.status : undefined,
        providerKind: isGoogleProviderError(error) ? error.kind : undefined,
      });
    }
    addActivity(
      input.workspaceId,
      'local_seo_updated',
      'Google Business Profile review reply failed',
      'An approved Google Business Profile review response could not be published to Google.',
      { source: 'google_business_profile', responseId: input.responseId, error: safeError },
    );
    updateJob(input.jobId, {
      status: 'error',
      error: safeError,
      message: 'GBP review reply publish failed',
    });
    broadcastResponseUpdate(input.workspaceId, 'publish_failed', input.responseId);
  }
}

export function startPublishForApprovedResponse(workspaceId: string, responseId: string): { jobId: string } {
  const response = getGbpReviewResponse(workspaceId, responseId);
  if (!response) throw new GbpReviewResponseError('Review response not found', 404);
  if (
    response.status !== GBP_REVIEW_RESPONSE_STATUSES.APPROVED
    && response.status !== GBP_REVIEW_RESPONSE_STATUSES.PUBLISH_FAILED
  ) {
    throw new GbpReviewResponseError('Review response must be approved or failed before publishing', 409);
  }
  return startGbpReviewReplyPublishJob({ workspaceId, responseId });
}
