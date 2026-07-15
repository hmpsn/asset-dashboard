/**
 * Shared "Send post to client for review" service (POST-C1).
 *
 * The single, reusable code path that turns a generated post into a CLIENT-FACING review
 * artifact. Before this existed, the only thing that surfaced a post to the client was the MCP
 * `send_to_client` tool (`ensurePostRequest` in server/mcp/tools/content-actions.ts) — the admin
 * ContentManager "Review" button only bumped the INTERNAL `GeneratedPost.status`, so operator-sent
 * posts never reached the client inbox.
 *
 * What this service does (the contract):
 *   1. Load the post (throws `PostNotFoundError` if missing).
 *   2. Find-or-create the post's `content_topic_request`:
 *        - If `requestId` is supplied and the row exists, that request is reused only when its
 *          lifecycle can legally enter `post_review`; otherwise a domain conflict is thrown.
 *        - Else find a lifecycle-compatible request linked to this post (by `postId`, then
 *          `briefId`). Concluded or otherwise incompatible requests are historical artifacts and
 *          do not get resurrected.
 *        - Else create a fresh request seeded at `in_progress` (so the transition to
 *          `post_review` is legal per CONTENT_REQUEST_TRANSITIONS).
 *   3. Transition the request to `post_review` and set `postId`/`briefId`
 *      (`updateContentRequest` calls `validateTransition` internally).
 *   4. Email the client (`notifyClientPostReady`) when a `clientEmail` is configured — this is the
 *      bit MCP was missing (B6), now shared so MCP gets it for free.
 *   5. Broadcast `CONTENT_REQUEST_UPDATE` (or `CONTENT_REQUEST_CREATED` when a request was created
 *      this call) so admin + client surfaces refresh.
 *   6. Log a `post_sent_for_review` activity.
 *
 * A `post_review` content_request projects to `awaiting_client` via the content_request deliverable
 * adapter, so the sent post reaches BOTH the legacy ContentTab/PostReviewCard surface AND the new
 * unified inbox (`listClientFacingDeliverables`) — unflagged, by design.
 */
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import db from '../../db/index.js';
import {
  createContentRequest,
  ExplicitContentRequestNotFoundError,
  getContentRequest,
  listContentRequests,
  updateContentRequest,
} from '../../content-requests.js';
import { getPost } from '../../content-posts-db.js';
import { notifyClientPostReady } from '../../email.js';
import { invalidateContentPipelineIntelligence } from '../../intelligence-freshness.js';
import { createLogger } from '../../logger.js';
import { getClientInboxReviewsUrl, getWorkspace } from '../../workspaces.js';
import { WS_EVENTS } from '../../ws-events.js';
import type { ContentTopicRequest, GeneratedPost } from '../../../shared/types/content.js';
import { IncompleteContentPostError, isPostDeliverable } from './generation-integrity.js';
import { GenerationRevisionConflictError } from '../../generation-provenance.js';
import { CONTENT_REQUEST_TRANSITIONS } from '../../state-machines.js';

const log = createLogger('send-post-to-client');

function runPostCommitEffect(
  effectName: string,
  context: { workspaceId: string; postId: string; requestId: string },
  effect: () => void,
): void {
  try {
    effect();
  } catch (error) {
    try {
      log.warn({ ...context, effectName, err: error }, 'post send post-commit effect failed');
    } catch { // catch-ok -- failure reporting must not undo a committed send.
    }
  }
}

/** Thrown when the post to send does not exist in the workspace (route maps this to a 404). */
export class PostNotFoundError extends Error {
  readonly workspaceId: string;
  readonly postId: string;
  constructor(workspaceId: string, postId: string) {
    super(`Post not found: ${postId}`);
    this.name = 'PostNotFoundError';
    this.workspaceId = workspaceId;
    this.postId = postId;
  }
}

/**
 * Thrown when a caller explicitly selects a request whose lifecycle cannot legally enter
 * `post_review`. Explicit authority must never silently switch to a different request.
 */
export class PostReviewRequestLifecycleConflictError extends Error {
  readonly code = 'post_review_request_lifecycle_conflict' as const;
  readonly requestId: string;
  readonly status: ContentTopicRequest['status'];

  constructor(requestId: string, status: ContentTopicRequest['status']) {
    super(
      `Content request ${requestId} cannot enter post review from status "${status}". `
      + 'Send without requestId to create or reuse a compatible review request.',
    );
    this.name = 'PostReviewRequestLifecycleConflictError';
    this.requestId = requestId;
    this.status = status;
  }
}

export interface SendPostToClientOptions {
  /** Optional inline note from the operator (Admin Send Convention — single button + optional note). */
  note?: string;
  /**
   * Explicit content_request to reuse (MCP's `parentRequestId` path). When provided, this exact
   * workspace-scoped request must exist and be lifecycle-compatible; it is never a fallback hint.
   */
  requestId?: string;
  /** Activity-log metadata `source` (e.g. 'mcp-chat' for MCP, 'admin' for the route). Default 'admin'. */
  activitySource?: string;
  /** Extra activity-log metadata merged in (e.g. MCP's `action: 'mcp_post_sent_to_client'`). */
  activityMetadata?: Record<string, unknown>;
  /** Revision observed by the caller. Omit only for legacy callers that pin at acceptance. */
  expectedRevision?: number;
  /**
   * Synchronous DB-only authorization commit (for example, consuming an MCP
   * handle). It runs after every send precondition/write but before this
   * transaction commits, so either both the send and authorization commit or
   * both roll back.
   */
  commitAuthorization?: () => void;
}

export interface SendPostToClientResult {
  /** The content_request now in `post_review`. */
  request: ContentTopicRequest;
  /** The post that was sent. */
  post: GeneratedPost;
  /** True when a new content_request was created this call (vs an existing one reused). */
  created: boolean;
  /** False for an idempotent re-send with no request or artifact mutation. */
  changed: boolean;
}

/**
 * A request can be reused in a single atomic send only when it is already in `post_review` or has
 * a direct legal edge there. We intentionally do not perform multi-hop lifecycle mutations here:
 * each request mutation invalidates linked artifacts, so a synthetic approved→in_progress→
 * post_review sequence would bump the post revision twice for one user action.
 */
function canEnterPostReview(status: ContentTopicRequest['status']): boolean {
  return status === 'post_review'
    || CONTENT_REQUEST_TRANSITIONS[status]?.includes('post_review') === true;
}

/**
 * Find the lifecycle-compatible content_request that already represents this post, if any.
 * Prefers a direct `postId` link (a re-send of the same post), then falls back to the request that
 * owns the post's brief (`briefId`). Completed/terminal requests and other incompatible states are
 * ignored so a fresh send does not resurrect historical work or attempt an illegal transition.
 */
function findRequestForPost(workspaceId: string, post: GeneratedPost): ContentTopicRequest | undefined {
  const requests = listContentRequests(workspaceId).filter((request) => canEnterPostReview(request.status));
  const byPost = requests.find((r) => r.postId === post.id);
  if (byPost) return byPost;
  if (post.briefId) return requests.find((r) => r.briefId === post.briefId);
  return undefined;
}

/**
 * Send a generated post to the client for review. See module header for the full contract.
 *
 * @throws {PostNotFoundError} if the post does not exist in the workspace.
 */
export function sendPostToClientForReview(
  workspaceId: string,
  postId: string,
  options: SendPostToClientOptions = {},
): SendPostToClientResult {
  const {
    note,
    requestId: explicitRequestId,
    activitySource = 'admin',
    activityMetadata,
    expectedRevision,
  } = options;

  const accepted = db.transaction(() => {
    const observedPost = getPost(workspaceId, postId);
    if (!observedPost) throw new PostNotFoundError(workspaceId, postId);
    if (!isPostDeliverable(observedPost)) {
      throw new IncompleteContentPostError('Post is incomplete and cannot be sent to the client.');
    }
    const revision = expectedRevision ?? observedPost.generationRevision;
    if (observedPost.generationRevision !== revision) {
      throw new GenerationRevisionConflictError('content_post', postId, revision);
    }

    // ── Find-or-create the post's content_request ──
    // 1) explicit request, 2) existing request linked to the post, 3) create.
    let request: ContentTopicRequest | undefined;
    if (explicitRequestId) {
      request = getContentRequest(workspaceId, explicitRequestId);
      if (!request) {
        throw new ExplicitContentRequestNotFoundError(workspaceId, explicitRequestId);
      }
      if (request && !canEnterPostReview(request.status)) {
        throw new PostReviewRequestLifecycleConflictError(request.id, request.status);
      }
    }
    if (!request) request = findRequestForPost(workspaceId, observedPost);

    const created = !request;
    if (!request) {
      request = createContentRequest(workspaceId, {
        topic: observedPost.title,
        targetKeyword: observedPost.targetKeyword,
        intent: 'informational',
        priority: 'medium',
        rationale: 'Post shared for client review',
        source: 'strategy',
        serviceType: 'full_post',
        pageType: 'blog',
        initialStatus: 'in_progress',
        dedupe: false,
        clientNote: note,
      });
    }

    const requestTokenBefore = request.updatedAt;
    const updated = updateContentRequest(
      workspaceId,
      request.id,
      {
        briefId: observedPost.briefId,
        postId: observedPost.id,
        status: 'post_review',
        clientNote: note,
      },
      {
        linkedArtifactAuthority: {
          artifactType: 'content_post',
          artifactId: observedPost.id,
          expectedRevision: revision,
        },
      },
    );
    if (!updated) throw new Error(`Content request disappeared during send: ${request.id}`);
    const changed = created || updated.updatedAt !== requestTokenBefore;
    const acceptedPost = getPost(workspaceId, observedPost.id);
    if (!acceptedPost) throw new PostNotFoundError(workspaceId, observedPost.id);
    options.commitAuthorization?.();
    return { request: updated, post: acceptedPost, created, changed };
  }).immediate();

  const { request: updated, post, created, changed } = accepted;
  if (!changed) return accepted;

  const effectContext = { workspaceId, postId: post.id, requestId: updated.id };
  runPostCommitEffect('client_email', effectContext, () => {
    const ws = getWorkspace(workspaceId);
    if (!ws?.clientEmail) return;
    notifyClientPostReady({
      clientEmail: ws.clientEmail,
      workspaceName: ws.name,
      workspaceId,
      topic: updated.topic,
      targetKeyword: updated.targetKeyword,
      dashboardUrl: getClientInboxReviewsUrl(ws),
    });
  });
  runPostCommitEffect('intelligence_invalidation', effectContext, () => {
    invalidateContentPipelineIntelligence(workspaceId);
  });
  runPostCommitEffect('request_broadcast', effectContext, () => {
    broadcastToWorkspace(
      workspaceId,
      created ? WS_EVENTS.CONTENT_REQUEST_CREATED : WS_EVENTS.CONTENT_REQUEST_UPDATE,
      { id: updated.id, status: updated.status },
    );
  });
  runPostCommitEffect('activity', effectContext, () => {
    addActivity(
      workspaceId,
      'post_sent_for_review',
      `Sent post "${post.title}" to client for review`,
      post.targetKeyword ? `Keyword: ${post.targetKeyword}` : '',
      {
        source: activitySource,
        postId: post.id,
        briefId: post.briefId,
        requestId: updated.id,
        note,
        ...activityMetadata,
      },
    );
  });
  runPostCommitEffect('success_log', effectContext, () => {
    log.info(
      { ...effectContext, created },
      'post sent to client for review',
    );
  });

  return accepted;
}
