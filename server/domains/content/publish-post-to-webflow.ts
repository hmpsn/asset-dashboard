/**
 * Shared "Publish post to Webflow CMS" service (C3, audit item #12).
 *
 * The single, reusable code path that pushes a generated post to the Webflow CMS. Before this
 * existed there were TWO drifting publish paths:
 *
 *   1. Manual publish — `POST .../publish-to-webflow` (server/routes/content-publish.ts). The
 *      authoritative implementation: superset field map (incl. `summary` from the brief and
 *      `featuredImage`), outcome tracking, broadcast, activity, follow-on rec regen.
 *   2. Auto-publish on approval — a SILENT fire-and-forget `.then()` inside the PATCH handler
 *      (server/routes/content-posts.ts). It wrote a STRICT SUBSET of the field map (no `summary`,
 *      no `featuredImage`), never surfaced failures (log.warn only), and skipped the rec-regen
 *      follow-on entirely.
 *
 * This service is the ONE field map + ONE broadcast/activity/outcome/follow-on site consumed by
 * both. Auto-publish now runs as a background job (server/content-publish-job.ts) so failures
 * surface as job `error` + activity instead of vanishing.
 *
 * The contract (verified against the prior manual-publish path):
 *   - Post status `approved` is TERMINAL — publishing is a SIDE EFFECT tracked via
 *     `webflowItemId`/`webflowCollectionId`/`publishedAt`/`publishedSlug`, NOT a status change.
 *     This service never mutates `status`.
 *   - Race / idempotency guard: re-reads the post immediately before deciding create-vs-update so
 *     a concurrent publish (manual racing the approval job) is detected via `webflowItemId`.
 *   - On create failure → throws, stamps NOTHING (FM-2: no partial `webflowItemId`).
 *   - On publish-live failure → stamps `webflowItemId` + `webflowCollectionId` only (so a retry
 *     takes the update path), then throws.
 *   - On success → stamps `webflowItemId`/`webflowCollectionId`/`publishedAt`/`publishedSlug`,
 *     records the outcome action (guarded by `getActionByWorkspaceAndSource` so retries / re-
 *     publishes don't double-record), broadcasts `CONTENT_PUBLISHED` with the canonical payload,
 *     logs `content_published`, and enqueues `queueKeywordStrategyPostUpdateFollowOns`.
 */
import { getBrief } from '../../content-brief.js';
import { getPost, updatePostField } from '../../content-posts-db.js';
import { generateFeaturedImage } from '../../content-image.js';
import { assemblePostHtml, generateSlug } from '../../html-to-richtext.js';
import {
  createCollectionItem,
  updateCollectionItem,
  publishCollectionItems,
} from '../../webflow-cms.js';
import { getWorkspace, getTokenForSite } from '../../workspaces.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { WS_EVENTS } from '../../ws-events.js';
import { invalidateContentPipelineIntelligence } from '../../intelligence-freshness.js';
import { queueKeywordStrategyPostUpdateFollowOns } from '../../keyword-strategy-follow-ons.js';
import { recordAction, getActionByWorkspaceAndSource } from '../../outcome-tracking.js';
import { resolveContentRecommendationsForPublishedPost } from '../recommendations/resolution-service.js';
import { captureBaselineFromGsc } from '../../outcome-measurement.js';
import { normalizePageUrl } from '../../helpers.js';
import { createLogger } from '../../logger.js';
import type { GeneratedPost } from '../../../shared/types/content.js';
import type { Workspace } from '../../../shared/types/workspace.js';

const log = createLogger('publish-post-to-webflow');

type PublishFieldMap = NonNullable<Workspace['publishTarget']>['fieldMap'];

export type PublishPostErrorCode =
  | 'workspace_not_found'
  | 'no_publish_target'
  | 'no_site'
  | 'no_token'
  | 'post_not_found'
  | 'invalid_status'
  | 'create_failed'
  | 'publish_failed'
  | 'no_item_id';

/**
 * Thrown for every publish failure. `httpStatus` lets the synchronous manual route map directly to
 * a response; the job runner maps any throw to job `error`.
 */
export class PublishPostError extends Error {
  readonly code: PublishPostErrorCode;
  readonly httpStatus: number;
  constructor(code: PublishPostErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = 'PublishPostError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface PublishPostToWebflowOptions {
  /**
   * Generate + attach a featured image (manual route opt-in). Auto-publish omits this. Only has an
   * effect when the publish target maps a `featuredImage` field.
   */
  generateImage?: boolean;
  /** Activity-log/source distinction. Default 'manual'. */
  activitySource?: 'manual' | 'auto-publish';
}

export interface PublishPostToWebflowResult {
  itemId: string;
  slug: string;
  isUpdate: boolean;
  /** The post row after publish-tracking fields were stamped. */
  post: GeneratedPost;
}

/**
 * Build the ONE canonical Webflow `fieldData` map — the manual-publish superset. Both publish
 * paths now produce identical field data for identical inputs (field-map parity contract).
 *
 * `featuredImage` is added by the caller AFTER image generation (async), so it is not built here.
 */
function buildPublishFieldData(
  workspaceId: string,
  post: GeneratedPost,
  fieldMap: PublishFieldMap,
  slug: string,
): Record<string, unknown> {
  const bodyHtml = assemblePostHtml(post);
  const fieldData: Record<string, unknown> = {};

  if (fieldMap.title) fieldData[fieldMap.title] = post.title;
  if (fieldMap.slug) fieldData[fieldMap.slug] = slug;
  if (fieldMap.body) fieldData[fieldMap.body] = bodyHtml;
  if (fieldMap.metaTitle) fieldData[fieldMap.metaTitle] = post.seoTitle || post.title;
  if (fieldMap.metaDescription) fieldData[fieldMap.metaDescription] = post.seoMetaDescription || post.metaDescription;
  if (fieldMap.publishDate) fieldData[fieldMap.publishDate] = new Date().toISOString();

  // Brief-sourced excerpt/summary — the auto-publish path used to silently drop this.
  if (fieldMap.summary && post.briefId) {
    const brief = getBrief(workspaceId, post.briefId);
    if (brief?.executiveSummary) fieldData[fieldMap.summary] = brief.executiveSummary;
  }

  return fieldData;
}

/**
 * Publish a generated post to the workspace's Webflow CMS publish target. See the module header for
 * the full contract. Throws {@link PublishPostError} on any failure.
 */
export async function publishPostToWebflow(
  workspaceId: string,
  postId: string,
  opts: PublishPostToWebflowOptions = {},
): Promise<PublishPostToWebflowResult> {
  const { generateImage = false, activitySource = 'manual' } = opts;

  const ws = getWorkspace(workspaceId);
  if (!ws) throw new PublishPostError('workspace_not_found', 'Workspace not found', 404);
  if (!ws.publishTarget) {
    throw new PublishPostError('no_publish_target', 'No publish target configured. Set up Publish Settings first.', 400);
  }
  if (!ws.webflowSiteId) throw new PublishPostError('no_site', 'No Webflow site linked to this workspace', 400);

  const token = getTokenForSite(ws.webflowSiteId) || undefined;
  if (!token) throw new PublishPostError('no_token', 'No Webflow API token configured', 400);

  const post = getPost(workspaceId, postId);
  if (!post) throw new PublishPostError('post_not_found', 'Post not found', 404);

  // Allow approved posts or admin override (draft/review).
  if (post.status !== 'approved' && post.status !== 'draft' && post.status !== 'review') {
    throw new PublishPostError('invalid_status', `Post status "${post.status}" cannot be published`, 400);
  }

  const { collectionId, fieldMap } = ws.publishTarget;
  const slug = generateSlug(post.title);
  const fieldData = buildPublishFieldData(workspaceId, post, fieldMap, slug);

  // Generate the featured image if requested and mapped (superset field).
  if (generateImage && fieldMap.featuredImage) {
    log.info(`Generating featured image for post ${postId}`);
    const imgResult = await generateFeaturedImage(post, ws.webflowSiteId, token);
    if (imgResult.success && imgResult.hostedUrl) {
      fieldData[fieldMap.featuredImage] = { url: imgResult.hostedUrl };
    } else {
      log.warn(`Featured image generation failed: ${imgResult.error}`);
    }
  }

  // Re-read the post immediately before create-vs-update to defend against a concurrent publish
  // (manual publish racing the auto-publish job, or vice versa).
  const freshPost = getPost(workspaceId, postId) || post;

  let itemId: string | undefined;
  let isUpdate = false;

  if (freshPost.webflowItemId && freshPost.webflowCollectionId === collectionId) {
    isUpdate = true;
    const updateResult = await updateCollectionItem(collectionId, freshPost.webflowItemId, fieldData, token);
    if (!updateResult.success) {
      throw new PublishPostError('create_failed', `Failed to update CMS item: ${updateResult.error}`, 500);
    }
    itemId = freshPost.webflowItemId;
  } else {
    const createResult = await createCollectionItem(collectionId, fieldData, false, token);
    if (!createResult.success) {
      throw new PublishPostError('create_failed', `Failed to create CMS item: ${createResult.error}`, 500);
    }
    itemId = createResult.itemId;
  }

  if (!itemId) throw new PublishPostError('no_item_id', 'No item ID returned from Webflow', 500);

  // Publish the CMS item to make it live.
  const pubResult = await publishCollectionItems(collectionId, [itemId], token);
  if (!pubResult.success) {
    // Partial-failure stamp: record the item id (so a retry takes the update path) but NOT the
    // publishedAt/publishedSlug (the page is not live yet).
    updatePostField(workspaceId, postId, {
      webflowItemId: itemId,
      webflowCollectionId: collectionId,
    });
    throw new PublishPostError('publish_failed', `Failed to publish CMS item: ${pubResult.error}`, 500);
  }

  // Success — stamp the full publish-tracking set.
  const updatedPost = updatePostField(workspaceId, postId, {
    webflowItemId: itemId,
    webflowCollectionId: collectionId,
    publishedAt: new Date().toISOString(),
    publishedSlug: slug,
  });
  if (!updatedPost) throw new PublishPostError('post_not_found', 'Post not found', 404);

  // Activity log.
  addActivity(
    workspaceId,
    'content_published',
    activitySource === 'auto-publish'
      ? `Auto-published "${post.title}" to Webflow CMS on approval`
      : `${isUpdate ? 'Updated' : 'Published'} "${post.title}" to Webflow CMS`,
    `Collection: ${ws.publishTarget.collectionName} · Slug: ${slug}`,
    { postId, itemId, collectionId, slug, isUpdate, source: activitySource },
  );

  // Outcome tracking — the dedup guard prevents double-recording when a post is re-published
  // (re-deploy after a content edit) or a job is retried.
  try {
    if (!getActionByWorkspaceAndSource(workspaceId, 'post', postId)) {
      const publishedPagePath = slug ? normalizePageUrl(slug) : null;
      const postAction = recordAction({ // recordAction-ok: workspaceId from validated route param / job param
        workspaceId,
        actionType: 'content_published',
        sourceType: 'post',
        sourceId: postId,
        pageUrl: publishedPagePath,
        targetKeyword: post.targetKeyword ?? null,
        baselineSnapshot: {
          captured_at: new Date().toISOString(),
        },
        attribution: 'platform_executed',
      });
      if (publishedPagePath) {
        void captureBaselineFromGsc(postAction.id, workspaceId, publishedPagePath);
      }
    }
  } catch (err) {
    log.warn({ err, postId }, 'Failed to record outcome action for content publish');
  }

  // Broadcast + intelligence freshness.
  invalidateContentPipelineIntelligence(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_PUBLISHED, {
    postId,
    itemId,
    slug,
    title: post.title,
    isUpdate,
  });

  // D2 (audit #11): resolve content-gap recommendations matching the published post's
  // target keyword — the "create content for X" rec completes the moment X goes live.
  // Best-effort: this runs only on the success path (we are past every throw above) and a
  // resolution failure must never undo or fail a successful publish.
  try {
    resolveContentRecommendationsForPublishedPost(workspaceId, post.targetKeyword ?? null);
  } catch (err) {
    log.warn({ err, workspaceId, postId }, 'Failed to resolve content recommendations after publish');
  }

  // Follow-on recommendation regen — a content publish changes the live page inventory so
  // recommendations should reflect it. This used to fire on the manual path only; routing it
  // through the shared service guarantees BOTH paths trigger it. Best-effort: a throw here must
  // never undo a successful publish.
  try {
    queueKeywordStrategyPostUpdateFollowOns({ workspaceId });
  } catch (err) {
    log.warn({ err, workspaceId }, 'Failed to enqueue recommendation regen after content publish');
  }

  return { itemId, slug, isUpdate, post: updatedPost };
}
