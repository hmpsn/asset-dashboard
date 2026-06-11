/**
 * Content Publish Job (C3, audit item #12)
 *
 * Wraps the shared `publishPostToWebflow()` domain service in the background job platform for the
 * AUTO-PUBLISH-ON-APPROVAL path. Before C3 this ran as a silent fire-and-forget `.then()` inside
 * the content-posts PATCH handler: failures only `log.warn`-ed and never reached the operator.
 *
 * Dispatched from server/routes/content-posts.ts via `createJob(CONTENT_PUBLISH)` +
 * `setImmediate(runContentPublishJob)`. The frontend observes the job through
 * `useBackgroundTasks`/`useJobProgress` (polling /api/jobs) + the `CONTENT_PUBLISHED` broadcast the
 * service emits on success. The approve PATCH itself keeps its `200 + post` response contract — it
 * never carried publish results (publish was already detached), so making it a job is purely an
 * improvement: failures now surface as job `error` + activity.
 *
 * Idempotency: the job short-circuits to `done` if the post is already published
 * (`webflowItemId` present) before doing any Webflow work, and the underlying service re-reads the
 * post + guards outcome recording with the dedup guard — so a retry never double-publishes or
 * double-records.
 */
import { updateJob, unregisterAbort } from './jobs.js';
import { getPost } from './content-posts-db.js';
import { createLogger } from './logger.js';
import { isProgrammingError } from './errors.js';
import {
  publishPostToWebflow,
  PublishPostError,
} from './domains/content/publish-post-to-webflow.js';

const log = createLogger('content-publish-job');

export interface RunContentPublishJobOptions {
  jobId: string;
  workspaceId: string;
  postId: string;
}

export async function runContentPublishJob({
  jobId,
  workspaceId,
  postId,
}: RunContentPublishJobOptions): Promise<void> {
  try {
    updateJob(jobId, { status: 'running', message: 'Publishing to Webflow...' });

    // Idempotency short-circuit: if the post was already published (e.g. a manual publish raced the
    // approval, or this job is a retry), don't re-publish.
    const existing = getPost(workspaceId, postId);
    if (existing?.webflowItemId) {
      updateJob(jobId, {
        status: 'done',
        message: 'Post already published',
        result: { postId, itemId: existing.webflowItemId, alreadyPublished: true },
      });
      return;
    }

    const result = await publishPostToWebflow(workspaceId, postId, { activitySource: 'auto-publish' });

    updateJob(jobId, {
      status: 'done',
      message: `Published "${result.post.title}" to Webflow`,
      result: { postId, itemId: result.itemId, slug: result.slug, isUpdate: result.isUpdate },
    });
  } catch (err) {
    // The service already performed any partial-failure stamp (webflowItemId without publishedAt)
    // before throwing, so the job error path adds no DB writes.
    if (err instanceof PublishPostError) {
      log.warn({ err, workspaceId, postId, code: err.code }, 'content-publish-job: publish failed');
    } else if (isProgrammingError(err)) {
      log.warn({ err, workspaceId, postId }, 'content-publish-job: programming error');
    } else {
      log.debug({ err, workspaceId, postId }, 'content-publish-job: publish failed');
    }
    updateJob(jobId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: 'Auto-publish to Webflow failed',
    });
  } finally {
    unregisterAbort(jobId);
  }
}
