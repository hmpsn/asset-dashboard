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
 *        - If `requestId` is supplied and the row exists, that request is reused (MCP's
 *          parentRequestId path — keeps MCP behaviour identical).
 *        - Else find an existing request linked to this post (by `postId`, then `briefId`).
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
import {
  createContentRequest,
  getContentRequest,
  listContentRequests,
  updateContentRequest,
} from '../../content-requests.js';
import { getPost } from '../../content-posts-db.js';
import { notifyClientPostReady } from '../../email.js';
import { invalidateContentPipelineIntelligence } from '../../intelligence-freshness.js';
import { createLogger } from '../../logger.js';
import { getClientPortalUrl, getWorkspace } from '../../workspaces.js';
import { WS_EVENTS } from '../../ws-events.js';
import type { ContentTopicRequest, GeneratedPost } from '../../../shared/types/content.js';

const log = createLogger('send-post-to-client');

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

export interface SendPostToClientOptions {
  /** Optional inline note from the operator (Admin Send Convention — single button + optional note). */
  note?: string;
  /**
   * Explicit content_request to reuse (MCP's `parentRequestId` path). When provided AND the row
   * exists, this request is reused instead of find-or-create. Keeps MCP behaviour identical.
   */
  requestId?: string;
  /** Activity-log metadata `source` (e.g. 'mcp-chat' for MCP, 'admin' for the route). Default 'admin'. */
  activitySource?: string;
  /** Extra activity-log metadata merged in (e.g. MCP's `action: 'mcp_post_sent_to_client'`). */
  activityMetadata?: Record<string, unknown>;
}

export interface SendPostToClientResult {
  /** The content_request now in `post_review`. */
  request: ContentTopicRequest;
  /** The post that was sent. */
  post: GeneratedPost;
  /** True when a new content_request was created this call (vs an existing one reused). */
  created: boolean;
}

/**
 * Find the existing content_request that already represents this post, if any. Prefers a direct
 * `postId` link (a re-send of the same post), then falls back to the request that owns the post's
 * brief (`briefId`) — mirroring the route's prior post_review auto-populate lookup. Declined
 * requests are ignored so a fresh send doesn't resurrect a dead request.
 */
function findRequestForPost(workspaceId: string, post: GeneratedPost): ContentTopicRequest | undefined {
  const requests = listContentRequests(workspaceId).filter((r) => r.status !== 'declined');
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
  const { note, requestId: explicitRequestId, activitySource = 'admin', activityMetadata } = options;

  const post = getPost(workspaceId, postId);
  if (!post) throw new PostNotFoundError(workspaceId, postId);

  // ── Find-or-create the post's content_request ──
  // 1) explicit request (MCP parentRequestId), 2) existing request linked to the post, 3) create.
  let request: ContentTopicRequest | undefined;
  if (explicitRequestId) {
    request = getContentRequest(workspaceId, explicitRequestId);
  }
  if (!request) request = findRequestForPost(workspaceId, post);

  const created = !request;
  if (!request) {
    // Seed at `in_progress` so `in_progress → post_review` is a legal transition.
    request = createContentRequest(workspaceId, {
      topic: post.title,
      targetKeyword: post.targetKeyword,
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

  // ── Transition to post_review + link the post/brief (validateTransition runs inside) ──
  const updated = updateContentRequest(workspaceId, request.id, {
    briefId: post.briefId,
    postId: post.id,
    status: 'post_review',
    internalNote: note,
  });
  // updateContentRequest returns null only when the row is missing; we just created/loaded it.
  if (!updated) throw new Error(`Content request disappeared during send: ${request.id}`);

  // ── Notify the client (the bit MCP was missing — B6) ──
  const ws = getWorkspace(workspaceId);
  if (ws?.clientEmail) {
    notifyClientPostReady({
      clientEmail: ws.clientEmail,
      workspaceName: ws.name,
      workspaceId,
      topic: updated.topic,
      targetKeyword: updated.targetKeyword,
      dashboardUrl: getClientPortalUrl(ws),
    });
  }

  // ── Broadcast (created vs reused) + intelligence freshness ──
  invalidateContentPipelineIntelligence(workspaceId);
  broadcastToWorkspace(
    workspaceId,
    created ? WS_EVENTS.CONTENT_REQUEST_CREATED : WS_EVENTS.CONTENT_REQUEST_UPDATE,
    { id: updated.id, status: updated.status },
  );

  // ── Activity log ──
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

  log.info(
    { workspaceId, postId: post.id, requestId: updated.id, created },
    'post sent to client for review',
  );

  return { request: updated, post, created };
}
