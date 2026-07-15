/**
 * content_request deliverable adapter (PR-1e, DARK — the SECOND PROJECTED type).
 *
 * content_request (briefs/posts) is a D-hybrid / PROJECTED deliverable type. Like copy_section
 * (PR-1d), it is NOT physically migrated into the `client_deliverable` tables: its rich
 * production pipeline (the `content_topic_requests` row + its append-only `comments[]` thread,
 * `brief_id`/`post_id` FKs, `delivery_url`, `upgraded_at`, the brief-vs-post service split) STAYS
 * in its source table. This adapter exposes a content request through the unified
 * `ClientDeliverable` interface at READ time via `projectFromSource()` (design §13-D1, M4),
 * consumed by the Phase-2 inbox/rollup. There is NO dual-write, NO backfill, NO send-seam hook,
 * and NO source-file edit for a projected type — projection is read-time only.
 *
 * THE UNIT: one `ClientDeliverable` per content REQUEST (`content_topic_requests.id`). A request
 * carries a brief and/or a post through a 10-state production pipeline; the brief/post review is a
 * single client-facing review artifact per request (the client reviews the brief, then later the
 * post, against the SAME request). The brief-vs-post distinction (`briefId`/`postId` +
 * `serviceType`) rides in `payload` so Phase-2 can render the right surface.
 *
 * kind = 'review' (design §4.1): a brief or post is a content review artifact the client reads and
 * approves/requests-changes-on — not a per-item approval batch (kind 'batch') and not an inline
 * decision (kind 'decision'). content_request is SENT via the bespoke content-briefs /
 * content-requests routes (grandfathered in pr-check's `unified-send-to-client-bespoke-route`),
 * NOT the unified `sendToClient()` service.
 *
 * sourceRef = `content_request:<id>` — STABLE per-request. The request id is the globally-unique
 * natural key (`content_topic_requests.id`), so a re-projection of the same request maps onto the
 * same deliverable identity (design §4.5). One deliverable per request.
 *
 * STATUS MAP (the 10-state pipeline → canonical, M4). CONTENT_REQUEST_TRANSITIONS
 * (state-machines.ts) is the source machine; content_request has NO per-type deliverable override,
 * so the projection maps onto the canonical vocabulary. The CLIENT-FACING states map to ACTIVE
 * inbox statuses; the INTERNAL production/monetization states are NOT active inbox items and fold
 * to draft/applied — but the RAW production state is ALWAYS carried in `payload.contentRequestStatus`
 * so it is never lost:
 *   client_review      → awaiting_client     (brief sent, waiting on the client)
 *   post_review        → awaiting_client     (post review IS a client-facing review)
 *   changes_requested  → changes_requested   (client asked for edits)
 *   approved           → approved            (client approved)
 *   declined           → declined            (TERMINAL — client/operator declined)
 *   pending_payment    → draft               (internal: not yet paid; nothing to review)
 *   requested          → draft               (internal: queued; no brief yet)
 *   brief_generated    → draft               (internal: brief exists but not yet sent to client)
 *   in_progress        → draft               (internal: post being written)
 *   delivered          → applied             (TERMINAL: post delivered to the client)
 *   published          → applied             (TERMINAL: post published)
 * Use an EXHAUSTIVE switch with a `never` guard so a future content_request status can't silently
 * mis-map.
 *
 * Required-but-not-the-real-path methods (`validateSendable` / `buildPayload` / `sourceRef` /
 * `applyDeliverable`): the `DeliverableAdapter` interface requires them, so we provide coherent
 * implementations. BUT content_request is SENT via the content-briefs/content-requests routes, NOT
 * the unified service — these exist for interface completeness and the projected read path, not a
 * unified-send dual-write. `buildPayload` reuses the same projection builder as `projectFromSource`
 * so the two never drift. `applyDeliverable` is a DISABLED stub (the post-delivery side-effects
 * live in the source/send path, not a unified apply).
 *
 * Leaf rule: this module imports ONLY shared types (content, client-deliverable) + the adapter
 * contract. It does NOT import `content-requests.ts` or any source/route module (no cycle, stays
 * read-only — the projection input is passed in by the Phase-2 reader).
 */
import type {
  ContentTopicRequest,
  ContentRequestComment,
} from '../../../../shared/types/content.js';
import type { ContentRequestStatus } from '../../../state-machines.js';
import type {
  ClientDeliverable,
  DeliverableStatus,
} from '../../../../shared/types/client-deliverable.js';
import {
  registerAdapter,
  type BuiltDeliverablePayload,
  type DeliverableAdapter,
  type SendableResult,
} from './types.js';

/**
 * content_request status → canonical DeliverableStatus (M4). The client-facing states map to
 * active inbox statuses; the internal production/monetization states fold to draft (pre-review) or
 * applied (terminal delivered/published). The raw status is ALWAYS carried in
 * `payload.contentRequestStatus` so the production state is never lost. All 11 source statuses are
 * covered so a drifted value can never silently fall through (exhaustiveness guard).
 */
export function mapContentRequestStatusToDeliverableStatus(
  status: ContentRequestStatus,
): DeliverableStatus {
  switch (status) {
    // ── client-facing review states ──
    case 'client_review':
      return 'awaiting_client';
    case 'post_review':
      return 'awaiting_client'; // post review IS a client-facing review (M4)
    case 'changes_requested':
      return 'changes_requested';
    case 'approved':
      return 'approved';
    case 'declined':
      return 'declined';
    // ── internal production/monetization states (not active inbox items) ──
    case 'pending_payment':
      return 'draft';
    case 'requested':
      return 'draft';
    case 'brief_generated':
      return 'draft';
    case 'in_progress':
      return 'draft';
    // ── terminal delivery states ──
    case 'delivered':
      return 'applied';
    case 'published':
      return 'applied';
    default: {
      // Exhaustiveness guard: a new ContentRequestStatus must extend this map explicitly.
      const _exhaustive: never = status;
      void _exhaustive;
      return 'draft';
    }
  }
}

/**
 * Whether a content_request status is one the client is actively looking at (or has decided on).
 * Used to derive `sentAt` (the request has been put in front of the client) without inventing a
 * timestamp — drives the projected lifecycle markers off the source state.
 */
function isClientFacingStatus(status: ContentRequestStatus): boolean {
  return (
    status === 'client_review' ||
    status === 'post_review' ||
    status === 'changes_requested' ||
    status === 'approved' ||
    status === 'declined'
  );
}

/**
 * The client-safe payload carried in `client_deliverable.payload` for a projected content request:
 * the FKs (`briefId`/`postId`), the full client/team `comments[]` thread, the
 * `deliveryUrl`, `upgradedAt`, the brief-vs-post discriminators (`serviceType` + `hasBrief`/`hasPost`
 * so Phase-2 can pick the right surface), and — ALWAYS — the raw `contentRequestStatus` so the
 * production state survives the canonical mapping.
 */
export interface ProjectedContentRequestPayload {
  family: 'content_request';
  /** ALWAYS carried — the raw production state, so the canonical mapping never loses it. */
  contentRequestStatus: ContentRequestStatus;
  /** FK to the generated brief (content_topic_requests.brief_id), or null. */
  briefId: string | null;
  /** FK to the generated post (content_topic_requests.post_id), or null. */
  postId: string | null;
  /** The full append-only comment thread (client/team), carried verbatim. */
  comments: ContentRequestComment[];
  /** Delivered post URL (content_topic_requests.delivery_url), or null. */
  deliveryUrl: string | null;
  /** When the request was upgraded brief_only → full_post (content_topic_requests.upgraded_at), or null. */
  upgradedAt: string | null;
  /** brief_only vs full_post — distinguishes which surface Phase-2 renders, or null. */
  serviceType: ContentTopicRequest['serviceType'] | null;
  /** Whether a brief exists (briefId present) — brief-vs-post surface hint. */
  hasBrief: boolean;
  /** Whether a post exists (postId present) — brief-vs-post surface hint. */
  hasPost: boolean;
  /** Page type for the request (blog/landing/service/…), or null. */
  pageType: ContentTopicRequest['pageType'] | null;
  [key: string]: unknown;
}

function stableSourceRef(id: string): string | null {
  return id ? `content_request:${id}` : null;
}

/**
 * The comment thread, carried verbatim. `comments` is optional on ContentTopicRequest (the row
 * mapper always materializes it, but the shared type marks it `?`), so default to [] ONLY when the
 * field is absent — never substitute a fallback for a real (possibly empty) thread.
 */
function projectComments(request: ContentTopicRequest): ContentRequestComment[] {
  return request.comments ?? [];
}

/** Build the typed payload JSON for a content-request projection (shared by build + project). */
function buildRequestPayload(request: ContentTopicRequest): ProjectedContentRequestPayload {
  const briefId = request.briefId ?? null;
  const postId = request.postId ?? null;
  return {
    family: 'content_request',
    // M4: ALWAYS carry the raw production state so the canonical mapping never loses it.
    contentRequestStatus: request.status,
    briefId,
    postId,
    comments: projectComments(request),
    deliveryUrl: request.deliveryUrl ?? null,
    upgradedAt: request.upgradedAt ?? null,
    serviceType: request.serviceType ?? null,
    hasBrief: briefId !== null,
    hasPost: postId !== null,
    pageType: request.pageType ?? null,
  };
}

/** Title + summary for the request (a single human-readable review artifact). */
function requestTitle(request: ContentTopicRequest): string {
  // The post review surfaces the generated post; the brief review surfaces the brief. Both key off
  // the request topic (the stable human label). hasPost → "Post Review", else → "Brief Review".
  const surface = request.postId ? 'Post Review' : 'Brief Review';
  return request.topic ? `${surface}: ${request.topic}` : surface;
}
function requestSummary(request: ContentTopicRequest): string {
  // Lead with the target keyword + intent (what the content is for), like the admin RequestList row.
  const parts: string[] = [];
  if (request.targetKeyword) parts.push(request.targetKeyword);
  if (request.intent) parts.push(request.intent);
  return parts.join(' · ');
}

export const contentRequestAdapter: DeliverableAdapter<ContentTopicRequest, ContentTopicRequest> = {
  type: 'content_request',

  /**
   * Guarantee 0: a request with content (a generated brief or post) is reviewable. A request still
   * in pre-content states (pending_payment/requested — no brief_id yet) has nothing to put in front
   * of the client. (Interface completeness — content_request actually sends via the
   * content-briefs/content-requests routes, not the unified service.)
   */
  validateSendable: (request): SendableResult => {
    const hasContent = Boolean(request.briefId) || Boolean(request.postId);
    if (!hasContent) {
      return {
        ok: false,
        reason: 'content request has no reviewable content (no brief or post generated yet)',
      };
    }
    return { ok: true };
  },

  /**
   * Coherent typed payload (no child items — a brief/post is a single review artifact, the detail
   * rides in payload). Reuses the same projection builder as projectFromSource so build and project
   * never drift. NOTE: content_request is SENT via the content-briefs/content-requests routes, not
   * the unified service — this exists for interface completeness + the projected read path
   * (design §13-D1), not a dual-write.
   */
  buildPayload: (request): BuiltDeliverablePayload => ({
    title: requestTitle(request),
    summary: requestSummary(request),
    kind: 'review',
    payload: buildRequestPayload(request),
    externalRef: request.id,
    // No typed child items: a brief/post is a single review artifact (the detail is in payload).
  }),

  // Stable per-request key: content_request:<id>. id is the globally-unique request id.
  sourceRef: (request) => stableSourceRef(request.id),

  // apply disabled — content_request's post-delivery side-effects (delivery URL, publish) live in
  // the SOURCE/send path (content-requests.ts / content-briefs.ts), NOT a unified apply. The
  // adapter opts OUT of `appliesOnApprove`; this stub throws if any future caller wires it on.
  applyDeliverable: contentRequestApplyDisabledStub,

  /**
   * THE method for a projected type. Expose a content REQUEST through the unified ClientDeliverable
   * interface at read time (design §13-D1, M4). The deliverable id + workspace/timestamps come from
   * the source request; the brief/post FKs, the full comment thread, the delivery URL, the
   * upgrade marker, and the brief-vs-post discriminators ride in `payload` — and the raw production
   * status is ALWAYS carried so the canonical mapping never loses it. This is a PURE read
   * projection: it writes nothing and is normally consumed only by the Phase-2 inbox/rollup.
   */
  projectFromSource: (request): ClientDeliverable => {
    const status = mapContentRequestStatusToDeliverableStatus(request.status);
    const clientFacing = isClientFacingStatus(request.status);
    return {
      // The deliverable identity for a projected request is the request itself — there is no
      // physical client_deliverable row (D-hybrid). Use the stable content_request:<id> as the id so
      // a reader can key on it consistently; sourceRef carries the same natural key.
      id: `content_request:${request.id}`,
      workspaceId: request.workspaceId,
      externalRef: request.id,
      type: 'content_request',
      kind: 'review',
      status,
      title: requestTitle(request),
      summary: requestSummary(request),
      payload: buildRequestPayload(request),
      // The client/team thread is carried in payload.comments[]. Only the explicitly client-safe
      // note crosses this boundary; internalNote remains operator-only.
      note: request.clientNote ?? null,
      clientResponseNote: request.clientFeedback ?? request.declineReason ?? null,
      parentDeliverableId: null,
      // Projected at read time — no physical send/decide/apply lifecycle on a client_deliverable
      // row. The real lifecycle lives in content_topic_requests.status (carried in payload). Derive
      // the lifecycle markers off the source state + timestamps, never inventing "now".
      sentAt: clientFacing ? request.updatedAt : null,
      decidedAt:
        request.status === 'approved' ||
        request.status === 'declined' ||
        request.status === 'changes_requested'
          ? request.updatedAt
          : null,
      dueAt: null,
      appliedAt:
        request.status === 'delivered' || request.status === 'published'
          ? request.updatedAt
          : null,
      generatedAt: request.requestedAt,
      source: 'content_request',
      sourceRef: stableSourceRef(request.id),
      createdAt: request.requestedAt,
      updatedAt: request.updatedAt,
    };
  },
};

/**
 * The disabled-apply stub for content_request. content_request's terminal side-effects — delivering
 * the post (delivery URL) and publishing — happen in the SOURCE/send path
 * (`server/content-requests.ts` / `server/routes/content-briefs.ts`), NOT via a unified apply. The
 * adapter opts OUT of `appliesOnApprove`; this stub throws to make the disabled-apply contract
 * explicit if any future caller wires it on.
 */
export async function contentRequestApplyDisabledStub(
  _deliverable: ClientDeliverable,
): Promise<{ applied: number }> {
  throw new Error(
    'content_request apply is disabled (D-apply): the post-delivery/publish side-effects live in the content-requests/content-briefs source path, not a unified apply',
  );
}

registerAdapter(contentRequestAdapter as DeliverableAdapter);
