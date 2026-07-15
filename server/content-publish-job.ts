/**
 * Content Publish Job (C3, audit item #12)
 *
 * Wraps the shared `publishPostToWebflow()` domain service in the background job platform for the
 * AUTO-PUBLISH-ON-APPROVAL path. Before C3 this ran as a silent fire-and-forget `.then()` inside
 * the content-posts PATCH handler: failures only `log.warn`-ed and never reached the operator.
 *
 * Every auto, manual HTTP, and MCP publish first passes through
 * `createContentPublishJob()`, which atomically owns `content_post:<postId>` and
 * asserts the initiating revision before any Webflow work. The frontend observes the job through
 * `useBackgroundTasks`/`useJobProgress` (polling /api/jobs) + the `CONTENT_PUBLISHED` broadcast the
 * service emits on success. The approve PATCH itself keeps its `200 + post` response contract — it
 * never carried publish results (publish was already detached), so making it a job is purely an
 * improvement: failures now surface as job `error` + activity.
 *
 * Idempotency: the job short-circuits to `done` if the post is already published
 * (`webflowItemId` + `publishedAt` present at exactly the publish-stamp successor revision) before
 * doing any Webflow work. A draft item retained after a publish-live failure must continue through
 * the update + publish retry path. The service re-reads the
 * post + guards outcome recording with the dedup guard — so a retry never double-publishes or
 * double-records.
 */
import {
  createResourceScopedJob,
  getJob,
  runResourceScopedJobWorker,
  updateJob,
  type Job,
  type ResourceScopedJobStart,
} from './jobs.js';
import {
  assertPostGenerationRevision,
  getPost,
} from './content-posts-db.js';
import { createLogger } from './logger.js';
import { isProgrammingError } from './errors.js';
import { addActivity } from './activity-log.js';
import {
  assertContentPublishAuthorityCurrent,
  assertContentPublishTargetIdentity,
  captureContentPublishAuthority,
  preflightContentPublishWorkspace,
  publishPostToWebflow,
  PublishPostError,
  type ContentPublishAuthority,
  type PublishPostToWebflowOptions,
  type PublishPostToWebflowResult,
} from './domains/content/publish-post-to-webflow.js';
import { GenerationRevisionConflictError } from './generation-provenance.js';
import {
  BACKGROUND_JOB_TYPES,
  JOB_RESOURCE_TYPES,
  type JobResourceRef,
} from '../shared/types/background-jobs.js';
import type { PersistedGeneratedPost } from '../shared/types/content.js';

const log = createLogger('content-publish-job');

function runContentPublishJobPostCommitEffect(
  workspaceId: string,
  postId: string,
  effect: string,
  callback: () => void,
): void {
  try {
    callback();
  } catch (err) {
    log.warn(
      { err, workspaceId, postId, effect },
      'content publish job post-commit effect failed',
    );
  }
}

export interface RunContentPublishJobOptions {
  jobId: string;
  workspaceId: string;
  postId: string;
  expectedRevision: number;
  authority: ContentPublishAuthority;
}

export interface ContentPublishJobAcceptance {
  post: PersistedGeneratedPost;
  authority: ContentPublishAuthority;
}

export interface CreateContentPublishJobOptions {
  workspaceId: string;
  postId: string;
  expectedRevision: number;
  message?: string;
  /** MCP is intentionally stricter than the operator route. */
  approvedOnly?: boolean;
  /** Optional atomic domain mutation, used by approve-and-auto-publish. */
  accept?: (
    post: PersistedGeneratedPost,
    job: Readonly<Job>,
  ) => PersistedGeneratedPost;
}

/**
 * Atomically acquire the one publish owner for a post and validate the exact
 * revision observed by the caller. All Webflow-capable entry points use this
 * boundary so two requests cannot both create and publish external CMS items.
 */
export function createContentPublishJob({
  workspaceId,
  postId,
  expectedRevision,
  message = 'Publishing to Webflow...',
  approvedOnly = false,
  accept,
}: CreateContentPublishJobOptions): ResourceScopedJobStart<ContentPublishJobAcceptance> {
  // Preserve the publish service's workspace/configuration validation order
  // without leaving an orphan job or claim when deterministic preflight fails.
  // The second read inside acceptance proves the post/brief identity used to
  // build the claim is still current before the job row becomes durable.
  preflightContentPublishWorkspace(workspaceId);
  const observedPost = getPost(workspaceId, postId);
  if (!observedPost) {
    throw new PublishPostError('post_not_found', `Post not found: ${postId}`, 404);
  }
  const observedAuthority = captureContentPublishAuthority(workspaceId, observedPost);
  const resources: JobResourceRef[] = [{
    resourceType: JOB_RESOURCE_TYPES.CONTENT_POST,
    resourceId: postId,
  }];
  if (observedAuthority.brief) {
    resources.push({
      resourceType: JOB_RESOURCE_TYPES.CONTENT_BRIEF,
      resourceId: observedAuthority.brief.briefId,
    });
  }

  return createResourceScopedJob(BACKGROUND_JOB_TYPES.CONTENT_PUBLISH, {
    workspaceId,
    message,
    resources,
    accept: job => {
      const post = getPost(workspaceId, postId);
      if (!post) {
        throw new PublishPostError('post_not_found', `Post not found: ${postId}`, 404);
      }
      try {
        assertPostGenerationRevision(workspaceId, postId, expectedRevision);
      } catch (err) {
        if (err instanceof GenerationRevisionConflictError) {
          throw new PublishPostError(
            'local_revision_conflict',
            'The post changed before publishing began. Refresh and try again.',
            409,
          );
        }
        throw err;
      }
      if (approvedOnly && post.status !== 'approved') {
        throw new PublishPostError(
          'invalid_status',
          `Post status is '${post.status}' — only 'approved' posts can be published via MCP. Take the post through review and approval first.`,
          400,
        );
      }
      assertContentPublishAuthorityCurrent(workspaceId, observedAuthority);
      const acceptedPost = accept ? accept(post, job) : post;
      if (acceptedPost.id !== post.id
        || acceptedPost.workspaceId !== post.workspaceId
        || acceptedPost.briefId !== post.briefId) {
        throw new Error('Content publish acceptance changed the claimed post or brief identity');
      }
      // The optional atomic acceptance callback may mutate only the claimed
      // post lifecycle. Re-prove the exact config/brief authority after it so
      // the durable job cannot outgrow the resources acquired above.
      assertContentPublishAuthorityCurrent(workspaceId, observedAuthority);
      return {
        post: acceptedPost,
        authority: observedAuthority,
      };
    },
  });
}

interface ExecuteClaimedContentPublishOptions extends RunContentPublishJobOptions {
  publishOptions: Pick<PublishPostToWebflowOptions, 'activitySource' | 'generateImage'>;
  allowAlreadyPublishedSuccess?: boolean;
  failureMessage: string;
}

function persistVerifiedContentPublishDone(input: {
  jobId: string;
  workspaceId: string;
  postId: string;
  message: string;
  result: Record<string, unknown>;
}): boolean {
  try {
    updateJob(input.jobId, {
      status: 'done',
      message: input.message,
      result: input.result,
    });
    const persisted = getJob(input.jobId);
    if (persisted?.status !== 'done') {
      throw new Error(`Publish job terminal state was not persisted (found ${persisted?.status ?? 'missing'})`);
    }
    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(
      {
        err,
        jobId: input.jobId,
        workspaceId: input.workspaceId,
        postId: input.postId,
        artifactCommitted: true,
      },
      'content publish artifact committed but terminal job persistence failed',
    );
    try {
      updateJob(input.jobId, {
        status: 'error',
        error,
        message: 'Post published, but completion tracking failed',
        result: {
          ...input.result,
          code: 'completion_tracking_failed',
          artifactCommitted: true,
        },
      });
      const fallback = getJob(input.jobId);
      const fallbackResult = fallback?.result as {
        code?: string;
        artifactCommitted?: boolean;
      } | undefined;
      if (fallback?.status !== 'error'
        || fallbackResult?.code !== 'completion_tracking_failed'
        || fallbackResult.artifactCommitted !== true) {
        throw new Error(
          `Publish job completion-tracking fallback was not persisted (found ${fallback?.status ?? 'missing'})`,
        );
      }
    } catch (fallbackErr) {
      log.error(
        {
          err: fallbackErr,
          jobId: input.jobId,
          workspaceId: input.workspaceId,
          postId: input.postId,
          artifactCommitted: true,
        },
        'content publish committed artifact fallback terminal write failed',
      );
    }
    return false;
  }
}

async function executeClaimedContentPublish({
  jobId,
  workspaceId,
  postId,
  expectedRevision,
  authority,
  publishOptions,
  allowAlreadyPublishedSuccess = false,
  failureMessage,
}: ExecuteClaimedContentPublishOptions): Promise<PublishPostToWebflowResult | null> {
  let terminalPersistenceFailed = false;
  let committedResult: PublishPostToWebflowResult | null = null;

  try {
    return await runResourceScopedJobWorker(jobId, async () => {
      updateJob(jobId, { status: 'running', message: 'Publishing to Webflow...' });

      let committed;
      try {
        // Auto-publish retry idempotency: require the durable live marker at
        // exactly the publish-stamp successor, and re-prove the accepted
        // brief/config/collection authority before reporting success.
        const existing = getPost(workspaceId, postId);
        if (allowAlreadyPublishedSuccess
          && existing?.webflowItemId
          && existing.publishedAt
          && existing.generationRevision === expectedRevision + 1) {
          assertContentPublishAuthorityCurrent(workspaceId, authority);
          assertContentPublishTargetIdentity(
            workspaceId,
            postId,
            existing,
            authority.config.collectionId,
          );
          terminalPersistenceFailed = !persistVerifiedContentPublishDone({
            jobId,
            workspaceId,
            postId,
            message: 'Post already published',
            result: { postId, itemId: existing.webflowItemId, alreadyPublished: true },
          });
          return null;
        }

        committed = await publishPostToWebflow(workspaceId, postId, {
          ...publishOptions,
          expectedRevision,
          authority,
          deferPostCommitEffects: true,
        });
      } catch (err) {
        // The service already performed any partial-failure stamp before
        // throwing, so this terminal update only records/releases the owner.
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
          message: failureMessage,
          result: {
            postId,
            status: 'error',
            code: err instanceof PublishPostError ? err.code : 'unexpected',
            ...(err instanceof PublishPostError && err.reconciliation
              ? { reconciliation: err.reconciliation }
              : {}),
          },
        });
        throw err;
      }

      committedResult = committed;
      terminalPersistenceFailed = !persistVerifiedContentPublishDone({
        jobId,
        workspaceId,
        postId,
        message: `Published "${committed.post.title}" to Webflow`,
        result: {
          postId,
          itemId: committed.itemId,
          slug: committed.slug,
          isUpdate: committed.isUpdate,
        },
      });

      // Success effects are causally downstream of the durable terminal row.
      // When terminal persistence fails, the local publish stamp remains true
      // and reconciliation remains unresolved for an operator-safe retry.
      if (!terminalPersistenceFailed) committed.runPostCommitEffects();
      return committed;
    });
  } catch (err) {
    // The worker finalizer may also fail while trying to record its generic
    // infrastructure error. Never reinterpret that as a Webflow publish
    // failure after the external + local artifact commit already succeeded.
    if (terminalPersistenceFailed) {
      log.error(
        { err, jobId, workspaceId, postId, artifactCommitted: Boolean(committedResult) },
        'content publish terminal recovery failed after committed artifact',
      );
      return committedResult;
    }
    throw err;
  }
}

export interface PublishPostWithClaimOptions {
  workspaceId: string;
  postId: string;
  expectedRevision: number;
  generateImage?: boolean;
  activitySource: 'manual' | 'mcp-chat';
  approvedOnly?: boolean;
}

/** Foreground publish that still participates in the durable job/claim spine. */
export async function publishPostToWebflowWithClaim({
  workspaceId,
  postId,
  expectedRevision,
  generateImage,
  activitySource,
  approvedOnly,
}: PublishPostWithClaimOptions): Promise<{
  jobId: string;
  result: PublishPostToWebflowResult;
}> {
  const started = createContentPublishJob({
    workspaceId,
    postId,
    expectedRevision,
    approvedOnly,
  });
  const result = await executeClaimedContentPublish({
    jobId: started.job.id,
    workspaceId,
    postId,
    expectedRevision,
    authority: started.accepted.authority,
    publishOptions: { generateImage, activitySource },
    failureMessage: 'Publish to Webflow failed',
  });
  if (!result) throw new Error('Foreground publish unexpectedly resolved without a result');
  return { jobId: started.job.id, result };
}

export async function runContentPublishJob({
  jobId,
  workspaceId,
  postId,
  expectedRevision,
  authority,
}: RunContentPublishJobOptions): Promise<void> {
  try {
    await executeClaimedContentPublish({
      jobId,
      workspaceId,
      postId,
      expectedRevision,
      authority,
      publishOptions: { activitySource: 'auto-publish' },
      allowAlreadyPublishedSuccess: true,
      failureMessage: 'Auto-publish to Webflow failed',
    });
  } catch (err) {
    // Failure activity (admin-facing — content_publish_failed is not in CLIENT_VISIBLE_TYPES):
    // the job error alone disappears with the job's TTL; the activity entry is the durable record.
    const failedPost = getPost(workspaceId, postId);
    runContentPublishJobPostCommitEffect(workspaceId, postId, 'failure-activity', () => {
      addActivity(
        workspaceId,
        'content_publish_failed',
        `Auto-publish of "${failedPost?.title ?? postId}" to Webflow failed`,
        err instanceof Error ? err.message : String(err),
        {
          postId,
          source: 'auto-publish',
          code: err instanceof PublishPostError ? err.code : 'unexpected',
          ...(err instanceof PublishPostError && err.reconciliation
            ? { reconciliation: err.reconciliation }
            : {}),
        },
      );
    });
  }
}
