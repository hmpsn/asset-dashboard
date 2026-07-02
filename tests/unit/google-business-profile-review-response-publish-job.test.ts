// tests/unit/google-business-profile-review-response-publish-job.test.ts
//
// Reconcile R8-PR1 (Task B13) — attribution seam coverage for
// server/google-business-profile-review-response-publish-job.ts. Mints the new
// `gbp_review_reply` ActionType. This job SHIPS DARK (cannot fire in production until
// Google API access opens — see docs/rules/outcome-engine-stubs.md), but the recording
// logic must be correct from day one, so this suite exercises it directly against a fully
// mocked module graph (matching the sibling seam test conventions in
// tests/unit/webflow-seo-bulk-accept-fixes-job.test.ts).
//
// Pins:
//   1. success: updateGbpReviewReply resolving (Google confirms the publish) records
//      exactly one `gbp_review_reply` tracked action with attribution 'platform_executed'
//      and a source snapshot derived from the reviewer's display name.
//   2. failure (FM-2): a Google API error records NO tracked action and the job status is
//      'error'.
//   3. idempotency: a pre-existing tracked action for the same response is not duplicated
//      (covers the retry-publish route re-invoking this job).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addActivity: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  getValidGbpAccessToken: vi.fn(),
  updateGbpReviewReply: vi.fn(),
  beginGbpReviewResponsePublish: vi.fn(),
  completeGbpReviewResponsePublish: vi.fn(),
  failGbpReviewResponsePublish: vi.fn(),
  getGbpReviewResponse: vi.fn(),
  createJob: vi.fn(),
  updateJob: vi.fn(),
  markDeliverableApplied: vi.fn(),
  getActionByWorkspaceAndSource: vi.fn(),
  recordAction: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../server/activity-log.js', () => ({ addActivity: mocks.addActivity }));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: mocks.broadcastToWorkspace }));
vi.mock('../../server/google-business-profile-client.js', () => ({
  getValidGbpAccessToken: mocks.getValidGbpAccessToken,
  updateGbpReviewReply: mocks.updateGbpReviewReply,
}));
vi.mock('../../server/google-business-profile-errors.js', () => ({
  googleBusinessProfileProviderErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));
vi.mock('../../server/google-business-profile-review-responses-store.js', () => ({
  beginGbpReviewResponsePublish: mocks.beginGbpReviewResponsePublish,
  completeGbpReviewResponsePublish: mocks.completeGbpReviewResponsePublish,
  failGbpReviewResponsePublish: mocks.failGbpReviewResponsePublish,
  getGbpReviewResponse: mocks.getGbpReviewResponse,
  GbpReviewResponseError: class GbpReviewResponseError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock('../../server/google-provider-client.js', () => ({
  isGoogleProviderError: () => false,
}));
vi.mock('../../server/jobs.js', () => ({
  createJob: mocks.createJob,
  updateJob: mocks.updateJob,
}));
vi.mock('../../server/logger.js', () => ({ createLogger: vi.fn(() => mocks.logger) }));
vi.mock('../../server/domains/inbox/deliverable-apply-state.js', () => ({
  markDeliverableApplied: mocks.markDeliverableApplied,
}));
vi.mock('../../server/outcome-tracking.js', () => ({
  getActionByWorkspaceAndSource: mocks.getActionByWorkspaceAndSource,
  recordAction: mocks.recordAction,
}));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: {
    GBP_REVIEW_RESPONSES_UPDATED: 'gbp-review-responses:updated',
  },
}));

const { runGbpReviewReplyPublishJob } = await import(
  '../../server/google-business-profile-review-response-publish-job.js'
);

const startedResponse = {
  response: { id: 'response_1', reviewResourceName: 'accounts/1/locations/1/reviews/rev_1' },
  attemptId: 'attempt_1',
  replyText: 'Thank you for your feedback!',
};

const publishedSummary = {
  id: 'response_1',
  workspaceId: 'ws_1',
  reviewResourceName: 'accounts/1/locations/1/reviews/rev_1',
  googleLocationId: 'locations/1',
  status: 'published',
  draftText: 'Thank you for your feedback!',
  editedText: 'Thank you for your feedback!',
  sentDeliverableId: 'deliverable_1',
  publishedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  review: {
    id: 'review_1',
    googleLocationId: 'locations/1',
    reviewResourceName: 'accounts/1/locations/1/reviews/rev_1',
    reviewId: 'rev_1',
    rating: 'FIVE',
    reviewerDisplayName: 'Jamie Rivera',
    reviewerIsAnonymous: false,
    hasReply: true,
    syncedAt: new Date().toISOString(),
  },
};

describe('GBP review reply publish job — attribution seam (ships dark)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.beginGbpReviewResponsePublish.mockReturnValue(startedResponse);
    mocks.getValidGbpAccessToken.mockResolvedValue({ accessToken: 'token_1' });
    mocks.updateGbpReviewReply.mockResolvedValue({ comment: 'Thank you for your feedback!', updateTime: new Date().toISOString() });
    mocks.completeGbpReviewResponsePublish.mockReturnValue(publishedSummary);
    mocks.getActionByWorkspaceAndSource.mockReturnValue(null);
  });

  it('records exactly one gbp_review_reply tracked action with platform_executed attribution + source snapshot on success', async () => {
    await runGbpReviewReplyPublishJob({ workspaceId: 'ws_1', responseId: 'response_1', jobId: 'job_1' });

    expect(mocks.updateGbpReviewReply).toHaveBeenCalledTimes(1);
    expect(mocks.recordAction).toHaveBeenCalledTimes(1);
    expect(mocks.recordAction).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      actionType: 'gbp_review_reply',
      sourceType: 'gbp_review_response',
      sourceId: 'response_1',
      attribution: 'platform_executed',
      source: {
        label: "Reply to Jamie Rivera's review",
        snapshot: { title: "Reply to Jamie Rivera's review", type: 'gbp_review_response' },
      },
    }));
    expect(mocks.updateJob).toHaveBeenCalledWith('job_1', expect.objectContaining({ status: 'done' }));
    // Attribution is recorded after markDeliverableApplied, which itself only runs when a
    // deliverable is linked — assert recordAction fires regardless of that ordering detail.
    expect(mocks.markDeliverableApplied).toHaveBeenCalledWith('ws_1', 'deliverable_1');
  });

  it('records NO tracked action and the job status is failed when the Google API call errors (FM-2)', async () => {
    mocks.updateGbpReviewReply.mockRejectedValue(new Error('Google API rejected the reply'));

    await runGbpReviewReplyPublishJob({ workspaceId: 'ws_1', responseId: 'response_1', jobId: 'job_2' });

    expect(mocks.recordAction).not.toHaveBeenCalled();
    expect(mocks.completeGbpReviewResponsePublish).not.toHaveBeenCalled();
    expect(mocks.failGbpReviewResponsePublish).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      responseId: 'response_1',
      attemptId: 'attempt_1',
    }));
    expect(mocks.updateJob).toHaveBeenCalledWith('job_2', expect.objectContaining({
      status: 'error',
      message: 'GBP review reply publish failed',
    }));
  });

  it('does not duplicate the tracked action when one already exists for the response (idempotency — retry-publish)', async () => {
    mocks.getActionByWorkspaceAndSource.mockReturnValue({ id: 'existing_action' });

    await runGbpReviewReplyPublishJob({ workspaceId: 'ws_1', responseId: 'response_1', jobId: 'job_3' });

    expect(mocks.getActionByWorkspaceAndSource).toHaveBeenCalledWith('ws_1', 'gbp_review_response', 'response_1');
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it('omits the source snapshot when the review carries no reviewer display name', async () => {
    mocks.completeGbpReviewResponsePublish.mockReturnValue({
      ...publishedSummary,
      review: { ...publishedSummary.review, reviewerDisplayName: undefined },
    });

    await runGbpReviewReplyPublishJob({ workspaceId: 'ws_1', responseId: 'response_1', jobId: 'job_4' });

    expect(mocks.recordAction).toHaveBeenCalledWith(expect.not.objectContaining({ source: expect.anything() }));
  });

  it('a tracking failure inside recordAction does not abort the publish', async () => {
    mocks.recordAction.mockImplementation(() => {
      throw new Error('DB write failed');
    });

    await runGbpReviewReplyPublishJob({ workspaceId: 'ws_1', responseId: 'response_1', jobId: 'job_5' });

    expect(mocks.updateJob).toHaveBeenCalledWith('job_5', expect.objectContaining({ status: 'done' }));
  });
});
