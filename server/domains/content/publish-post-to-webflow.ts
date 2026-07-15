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
import { createHash } from 'node:crypto';

import { getBrief } from '../../content-brief.js';
import {
  assertPostGenerationRevision,
  getPost,
  updatePostField,
} from '../../content-posts-db.js';
import { isPostDeliverable } from './generation-integrity.js';
import { generateFeaturedImage } from '../../content-image.js';
import { assemblePostHtml, generateSlug } from '../../html-to-richtext.js';
import {
  createCollectionItem,
  updateCollectionItem,
  publishCollectionItems,
} from '../../webflow-cms.js';
import { getWorkspace, getTokenForSite } from '../../workspaces.js';
import { isProgrammingError } from '../../errors.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { WS_EVENTS } from '../../ws-events.js';
import { invalidateContentPipelineIntelligence } from '../../intelligence-freshness.js';
import { queueKeywordStrategyPostUpdateFollowOns } from '../../keyword-strategy-follow-ons.js';
import { recordAction, getActionByWorkspaceAndSource } from '../../outcome-tracking.js';
import { resolveContentRecommendationsForPublishedPost } from '../recommendations/resolution-service.js';
import { captureBaselineFromGsc } from '../../outcome-measurement.js';
import { normalizePageUrl } from '../../utils/page-address.js';
import { createLogger } from '../../logger.js';
import { GenerationRevisionConflictError } from '../../generation-provenance.js';
import {
  CONTENT_PUBLISH_EXTERNAL_STATES,
  getUnresolvedContentPublishReconciliation,
  getUnresolvedContentPublishReconciliationForOtherCollection,
  recordContentPublishReconciliation,
  resolveContentPublishReconciliation,
  type ContentPublishExternalState,
} from '../../content-publish-reconciliation.js';
import type { GeneratedPost, PersistedGeneratedPost } from '../../../shared/types/content.js';
import type { Workspace } from '../../../shared/types/workspace.js';

const log = createLogger('publish-post-to-webflow');

function runPublishPostCommitEffect(
  workspaceId: string,
  postId: string,
  effect: string,
  run: () => void,
): void {
  try {
    run();
  } catch (err) {
    log.warn(
      { err, workspaceId, postId, effect },
      'content publish post-commit effect failed',
    );
  }
}

export type PublishFieldMap = NonNullable<Workspace['publishTarget']>['fieldMap'];

export type PublishPostErrorCode =
  | 'workspace_not_found'
  | 'no_publish_target'
  | 'no_site'
  | 'no_token'
  | 'post_not_found'
  | 'invalid_status'
  | 'local_revision_conflict'
  | 'brief_revision_conflict'
  | 'publish_config_conflict'
  | 'publish_target_conflict'
  | 'local_stamp_failed'
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
  readonly reconciliation?: PublishReconciliationDiagnostic;
  constructor(
    code: PublishPostErrorCode,
    message: string,
    httpStatus: number,
    reconciliation?: PublishReconciliationDiagnostic,
  ) {
    super(message);
    this.name = 'PublishPostError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.reconciliation = reconciliation;
  }
}

export interface ContentPublishWorkspacePreflight {
  workspace: Workspace;
  publishTarget: NonNullable<Workspace['publishTarget']>;
  webflowSiteId: string;
  token: string;
}

export interface ContentPublishConfigAuthority {
  webflowSiteId: string;
  collectionId: string;
  collectionName: string;
  fieldMap: PublishFieldMap;
  /** One-way identity only. Never persist or log the resolved credential. */
  tokenIdentity: string;
  fingerprint: string;
}

export interface ContentPublishBriefAuthority {
  briefId: string;
  /** Null pins the authoritative absence of a brief row. */
  expectedRevision: number | null;
  executiveSummary: string | null;
}

export interface ContentPublishAuthority {
  config: ContentPublishConfigAuthority;
  /** Captured only when the effective field map publishes a brief summary. */
  brief: ContentPublishBriefAuthority | null;
}

function canonicalPublishFieldMap(fieldMap: PublishFieldMap): PublishFieldMap {
  return {
    title: fieldMap.title,
    slug: fieldMap.slug,
    body: fieldMap.body,
    ...(fieldMap.metaTitle ? { metaTitle: fieldMap.metaTitle } : {}),
    ...(fieldMap.metaDescription ? { metaDescription: fieldMap.metaDescription } : {}),
    ...(fieldMap.summary ? { summary: fieldMap.summary } : {}),
    ...(fieldMap.featuredImage ? { featuredImage: fieldMap.featuredImage } : {}),
    ...(fieldMap.author ? { author: fieldMap.author } : {}),
    ...(fieldMap.publishDate ? { publishDate: fieldMap.publishDate } : {}),
    ...(fieldMap.category ? { category: fieldMap.category } : {}),
  };
}

function contentPublishConfigAuthority(
  preflight: ContentPublishWorkspacePreflight,
): ContentPublishConfigAuthority {
  const fieldMap = canonicalPublishFieldMap(preflight.publishTarget.fieldMap);
  const tokenIdentity = createHash('sha256').update(preflight.token).digest('hex');
  const canonicalConfig = {
    webflowSiteId: preflight.webflowSiteId,
    collectionId: preflight.publishTarget.collectionId,
    collectionName: preflight.publishTarget.collectionName,
    fieldMap,
    tokenIdentity,
  };
  return {
    ...canonicalConfig,
    fingerprint: createHash('sha256')
      .update(JSON.stringify(canonicalConfig))
      .digest('hex'),
  };
}

/**
 * Read-only configuration preflight shared by job acceptance and execution.
 *
 * Keep this validation ahead of post lookup so manual publish preserves the
 * established workspace/configuration error contract without creating a job or
 * resource claim. The publish service repeats it immediately before external
 * work so configuration changes after claim acquisition are still authoritative.
 */
export function preflightContentPublishWorkspace(
  workspaceId: string,
): ContentPublishWorkspacePreflight {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    throw new PublishPostError('workspace_not_found', 'Workspace not found', 404);
  }
  if (!workspace.publishTarget) {
    throw new PublishPostError(
      'no_publish_target',
      'No publish target configured. Set up Publish Settings first.',
      400,
    );
  }
  if (!workspace.webflowSiteId) {
    throw new PublishPostError(
      'no_site',
      'No Webflow site linked to this workspace',
      400,
    );
  }

  const token = getTokenForSite(workspace.webflowSiteId) || undefined;
  if (!token) {
    throw new PublishPostError('no_token', 'No Webflow API token configured', 400);
  }

  return {
    workspace,
    publishTarget: workspace.publishTarget,
    webflowSiteId: workspace.webflowSiteId,
    token,
  };
}

function publishConfigConflict(): PublishPostError {
  return new PublishPostError(
    'publish_config_conflict',
    'The Webflow publish configuration changed after this publish was accepted. Review Publish Settings and retry.',
    409,
  );
}

function briefRevisionConflict(briefId: string): PublishPostError {
  return new PublishPostError(
    'brief_revision_conflict',
    `Brief ${briefId} changed after this publish was accepted. The newer brief was preserved; retry to publish its current summary.`,
    409,
  );
}

function publishTargetConflict(message: string): PublishPostError {
  return new PublishPostError('publish_target_conflict', message, 409);
}

function captureBriefPublishAuthority(
  workspaceId: string,
  post: Pick<GeneratedPost, 'briefId'>,
  config: ContentPublishConfigAuthority,
): ContentPublishBriefAuthority | null {
  if (!config.fieldMap.summary || !post.briefId) return null;
  const brief = getBrief(workspaceId, post.briefId);
  return {
    briefId: post.briefId,
    expectedRevision: brief?.generationRevision ?? null,
    executiveSummary: brief?.executiveSummary ?? null,
  };
}

/** Capture the exact non-secret publish inputs owned by a claimed publish run. */
export function captureContentPublishAuthority(
  workspaceId: string,
  post: Pick<GeneratedPost, 'briefId'>,
): ContentPublishAuthority {
  const config = contentPublishConfigAuthority(preflightContentPublishWorkspace(workspaceId));
  return {
    config,
    brief: captureBriefPublishAuthority(workspaceId, post, config),
  };
}

/**
 * Re-resolve credentials/configuration without exposing the token, then prove
 * that both configuration and brief-sourced summary still match acceptance.
 */
export function assertContentPublishAuthorityCurrent(
  workspaceId: string,
  expected: ContentPublishAuthority,
): ContentPublishWorkspacePreflight {
  let current: ContentPublishWorkspacePreflight;
  try {
    current = preflightContentPublishWorkspace(workspaceId);
  } catch (err) {
    if (isProgrammingError(err)) throw err;
    throw publishConfigConflict();
  }
  const currentConfig = contentPublishConfigAuthority(current);
  if (currentConfig.fingerprint !== expected.config.fingerprint) {
    throw publishConfigConflict();
  }

  if (expected.brief) {
    const currentBrief = getBrief(workspaceId, expected.brief.briefId);
    const expectedAbsent = expected.brief.expectedRevision === null;
    const currentSummary = currentBrief?.executiveSummary ?? null;
    const changed = expectedAbsent
      ? Boolean(currentBrief)
      : !currentBrief
        || currentBrief.generationRevision !== expected.brief.expectedRevision
        || currentSummary !== expected.brief.executiveSummary;
    if (changed) {
      throw briefRevisionConflict(expected.brief.briefId);
    }
  }
  return current;
}

/**
 * An existing or reconciled Webflow identity is collection-bound. Refuse to
 * create in a newly configured collection until the old identity is resolved.
 */
export function assertContentPublishTargetIdentity(
  workspaceId: string,
  postId: string,
  post: Pick<GeneratedPost, 'webflowItemId' | 'webflowCollectionId'>,
  collectionId: string,
): void {
  const itemId = post.webflowItemId?.trim() || undefined;
  const stampedCollectionId = post.webflowCollectionId?.trim() || undefined;
  if (Boolean(itemId) !== Boolean(stampedCollectionId)) {
    throw publishTargetConflict(
      'This post has a partial Webflow identity. Reconcile the existing item and collection before publishing again.',
    );
  }
  if (itemId && stampedCollectionId !== collectionId) {
    throw publishTargetConflict(
      `This post belongs to Webflow collection ${stampedCollectionId}; it cannot be recreated in collection ${collectionId}. Reconcile or remove the old external item first.`,
    );
  }

  const otherCollection = getUnresolvedContentPublishReconciliationForOtherCollection(
    workspaceId,
    postId,
    collectionId,
  );
  if (otherCollection) {
    throw publishTargetConflict(
      `Webflow item ${otherCollection.itemId} is unresolved in collection ${otherCollection.collectionId}. Resolve it before publishing this post to collection ${collectionId}.`,
    );
  }

  const currentCollection = getUnresolvedContentPublishReconciliation(
    workspaceId,
    postId,
    collectionId,
  );
  if (itemId && currentCollection && currentCollection.itemId !== itemId) {
    throw publishTargetConflict(
      'This post has conflicting Webflow item identities in the target collection. Resolve the reconciliation before publishing again.',
    );
  }
}

export interface PublishReconciliationDiagnostic {
  itemId: string;
  collectionId: string;
  externalState: ContentPublishExternalState;
  sourceRevision: number;
}

export interface PublishPostToWebflowOptions {
  /**
   * Generate + attach a featured image (manual route opt-in). Auto-publish omits this. Only has an
   * effect when the publish target maps a `featuredImage` field.
   */
  generateImage?: boolean;
  /** Activity-log/source distinction. Default 'manual'. 'mcp-chat' tags an
   *  agent-driven publish via the MCP publish_post tool (behaves like 'manual'). */
  activitySource?: 'manual' | 'auto-publish' | 'mcp-chat';
  /** Internal CAS precondition captured by the initiating controller/job. */
  expectedRevision: number;
  /** Exact non-secret configuration + brief authority captured with the publish claim. */
  authority: ContentPublishAuthority;
  /**
   * Claimed jobs defer success effects until their durable `done` row has been
   * persisted and verified. Direct domain callers retain the historical inline
   * behavior by leaving this false.
   */
  deferPostCommitEffects?: boolean;
}

export interface PublishPostToWebflowResult {
  itemId: string;
  slug: string;
  isUpdate: boolean;
  /** The post row after publish-tracking fields were stamped. */
  post: PersistedGeneratedPost;
}

export interface DeferredPublishPostToWebflowResult extends PublishPostToWebflowResult {
  /** Idempotent; every individual effect is guarded so one failure cannot suppress the rest. */
  runPostCommitEffects: () => void;
}

interface PublishPostCommitEffect {
  name: string;
  run: () => void;
}

function createPublishPostCommitRunner(
  workspaceId: string,
  postId: string,
  effects: PublishPostCommitEffect[],
): () => void {
  let didRun = false;
  return () => {
    if (didRun) return;
    didRun = true;
    for (const effect of effects) {
      runPublishPostCommitEffect(workspaceId, postId, effect.name, effect.run);
    }
  };
}

function publishRevisionConflict(
  postId: string,
  reconciliation?: PublishReconciliationDiagnostic,
): PublishPostError {
  const externalDetail = reconciliation
    ? ` Webflow item ${reconciliation.itemId} ${reconciliation.externalState === 'published' ? 'is live' : 'was created or updated as a draft'}; its identity was retained for a safe retry.`
    : '';
  return new PublishPostError(
    'local_revision_conflict',
    `Post ${postId} changed while publishing, so the newer local revision was preserved.${externalDetail}`,
    409,
    reconciliation,
  );
}

function recordExternalPublishConflict(input: {
  workspaceId: string;
  postId: string;
  collectionId: string;
  itemId: string;
  externalState: ContentPublishExternalState;
  sourceRevision: number;
  conflict?: PublishPostError;
}): PublishPostError {
  const recorded = recordContentPublishReconciliation({
    workspaceId: input.workspaceId,
    postId: input.postId,
    collectionId: input.collectionId,
    itemId: input.itemId,
    externalState: input.externalState,
    sourceGenerationRevision: input.sourceRevision,
  });
  const reconciliation: PublishReconciliationDiagnostic = {
    itemId: recorded.itemId,
    collectionId: recorded.collectionId,
    externalState: recorded.externalState,
    sourceRevision: recorded.sourceGenerationRevision,
  };
  if (!input.conflict) return publishRevisionConflict(input.postId, reconciliation);
  const externalDetail = ` Webflow item ${recorded.itemId} ${recorded.externalState === 'published' ? 'is live' : 'was created or updated as a draft'}; its identity was retained for a safe retry.`;
  return new PublishPostError(
    input.conflict.code,
    `${input.conflict.message}${externalDetail}`,
    input.conflict.httpStatus,
    reconciliation,
  );
}

function verifyAuthorityAfterExternalMutation(input: {
  workspaceId: string;
  postId: string;
  collectionId: string;
  itemId: string;
  externalState: ContentPublishExternalState;
  sourceRevision: number;
  authority: ContentPublishAuthority;
}): void {
  try {
    assertPostGenerationRevision(input.workspaceId, input.postId, input.sourceRevision);
    assertContentPublishAuthorityCurrent(input.workspaceId, input.authority);
    const currentPost = getPost(input.workspaceId, input.postId);
    if (!currentPost) throw publishRevisionConflict(input.postId);
    assertContentPublishTargetIdentity(
      input.workspaceId,
      input.postId,
      currentPost,
      input.collectionId,
    );
  } catch (err) {
    const conflict = err instanceof GenerationRevisionConflictError
      ? publishRevisionConflict(input.postId)
      : err instanceof PublishPostError
        ? err
        : null;
    if (!conflict) throw err;
    throw recordExternalPublishConflict({ ...input, conflict });
  }
}

function recordExternalPublishStampFailure(
  input: {
    workspaceId: string;
    postId: string;
    collectionId: string;
    itemId: string;
    externalState: ContentPublishExternalState;
    sourceRevision: number;
  },
  cause: unknown,
): PublishPostError {
  const recorded = recordContentPublishReconciliation({
    workspaceId: input.workspaceId,
    postId: input.postId,
    collectionId: input.collectionId,
    itemId: input.itemId,
    externalState: input.externalState,
    sourceGenerationRevision: input.sourceRevision,
  });
  const reconciliation: PublishReconciliationDiagnostic = {
    itemId: recorded.itemId,
    collectionId: recorded.collectionId,
    externalState: recorded.externalState,
    sourceRevision: recorded.sourceGenerationRevision,
  };
  log.error(
    { cause, ...input, reconciliation },
    'Webflow mutation succeeded but the local publish stamp failed; identity retained for retry',
  );
  return new PublishPostError(
    'local_stamp_failed',
    `Webflow item ${recorded.itemId} ${recorded.externalState === 'published' ? 'is live' : 'was retained as a draft'}, but its local publish state could not be saved. Retry to reconcile the existing item.`,
    500,
    reconciliation,
  );
}

/**
 * Build the ONE canonical Webflow `fieldData` map — the manual-publish superset. Both publish
 * paths now produce identical field data for identical inputs (field-map parity contract).
 *
 * `featuredImage` is added by the caller AFTER image generation (async), so it is not built here.
 */
function buildPublishFieldData(
  post: GeneratedPost,
  fieldMap: PublishFieldMap,
  slug: string,
  briefSummary: string | null,
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
  if (fieldMap.summary && briefSummary) fieldData[fieldMap.summary] = briefSummary;

  return fieldData;
}

/**
 * Publish a generated post to the workspace's Webflow CMS publish target. See the module header for
 * the full contract. Throws {@link PublishPostError} on any failure.
 */
export function publishPostToWebflow(
  workspaceId: string,
  postId: string,
  opts: PublishPostToWebflowOptions & { deferPostCommitEffects: true },
): Promise<DeferredPublishPostToWebflowResult>;
export function publishPostToWebflow(
  workspaceId: string,
  postId: string,
  opts: PublishPostToWebflowOptions,
): Promise<PublishPostToWebflowResult>;
export async function publishPostToWebflow(
  workspaceId: string,
  postId: string,
  opts: PublishPostToWebflowOptions,
): Promise<PublishPostToWebflowResult | DeferredPublishPostToWebflowResult> {
  const { generateImage = false, activitySource = 'manual' } = opts;
  let { token } = assertContentPublishAuthorityCurrent(workspaceId, opts.authority);
  const { config } = opts.authority;
  const webflowSiteId = config.webflowSiteId;

  const post = getPost(workspaceId, postId);
  if (!post) throw new PublishPostError('post_not_found', 'Post not found', 404);
  const sourceRevision = opts.expectedRevision;
  try {
    assertPostGenerationRevision(workspaceId, postId, sourceRevision);
  } catch (err) {
    if (err instanceof GenerationRevisionConflictError) throw publishRevisionConflict(postId);
    throw err;
  }

  // Allow approved posts or admin override (draft/review).
  if (post.status !== 'approved' && post.status !== 'draft' && post.status !== 'review') {
    throw new PublishPostError('invalid_status', `Post status "${post.status}" cannot be published`, 400);
  }
  if (!isPostDeliverable(post)) {
    throw new PublishPostError('invalid_status', 'Post is incomplete and cannot be published', 400);
  }

  const { collectionId, collectionName, fieldMap } = config;
  assertContentPublishTargetIdentity(workspaceId, postId, post, collectionId);
  const slug = generateSlug(post.title);
  const fieldData = buildPublishFieldData(
    post,
    fieldMap,
    slug,
    opts.authority.brief?.executiveSummary ?? null,
  );

  // Generate the featured image if requested and mapped (superset field).
  if (generateImage && fieldMap.featuredImage) {
    log.info(`Generating featured image for post ${postId}`);
    const imgResult = await generateFeaturedImage(post, webflowSiteId, token);
    if (imgResult.success && imgResult.hostedUrl) {
      fieldData[fieldMap.featuredImage] = { url: imgResult.hostedUrl };
    } else {
      log.warn(`Featured image generation failed: ${imgResult.error}`);
    }
  }

  // Re-read the post immediately before create-vs-update to defend against a concurrent publish
  // (manual publish racing the auto-publish job, or vice versa).
  const freshPost = getPost(workspaceId, postId);
  if (!freshPost) throw publishRevisionConflict(postId);
  try {
    assertPostGenerationRevision(workspaceId, postId, sourceRevision);
  } catch (err) {
    if (err instanceof GenerationRevisionConflictError) throw publishRevisionConflict(postId);
    throw err;
  }
  token = assertContentPublishAuthorityCurrent(workspaceId, opts.authority).token;
  assertContentPublishTargetIdentity(workspaceId, postId, freshPost, collectionId);

  let itemId: string | undefined;
  let isUpdate = false;
  const unresolved = getUnresolvedContentPublishReconciliation(
    workspaceId,
    postId,
    collectionId,
  );
  const reusableItemId = freshPost.webflowItemId
    && freshPost.webflowCollectionId === collectionId
    ? freshPost.webflowItemId
    : unresolved?.itemId;
  const externalStateAfterMutation = unresolved?.externalState
    ?? (freshPost.publishedAt
      ? CONTENT_PUBLISH_EXTERNAL_STATES.PUBLISHED
      : CONTENT_PUBLISH_EXTERNAL_STATES.DRAFT);

  if (reusableItemId) {
    isUpdate = true;
    const updateResult = await updateCollectionItem(collectionId, reusableItemId, fieldData, token);
    if (!updateResult.success) {
      throw new PublishPostError('create_failed', `Failed to update CMS item: ${updateResult.error}`, 500);
    }
    itemId = reusableItemId;
  } else {
    const createResult = await createCollectionItem(collectionId, fieldData, false, token);
    if (!createResult.success) {
      throw new PublishPostError('create_failed', `Failed to create CMS item: ${createResult.error}`, 500);
    }
    itemId = createResult.itemId;
  }

  if (!itemId) throw new PublishPostError('no_item_id', 'No item ID returned from Webflow', 500);

  // The CMS create/update happened, but it is still safe to stop before making
  // the item live if post, brief, target, token, or field-map authority drifted.
  verifyAuthorityAfterExternalMutation({
    workspaceId,
    postId,
    collectionId,
    itemId,
    externalState: externalStateAfterMutation,
    sourceRevision,
    authority: opts.authority,
  });

  // Publish the CMS item to make it live.
  const pubResult = await publishCollectionItems(collectionId, [itemId], token);
  verifyAuthorityAfterExternalMutation({
    workspaceId,
    postId,
    collectionId,
    itemId,
    externalState: pubResult.success
      ? CONTENT_PUBLISH_EXTERNAL_STATES.PUBLISHED
      : externalStateAfterMutation,
    sourceRevision,
    authority: opts.authority,
  });
  if (!pubResult.success) {
    // Partial-failure stamp: record the item id (so a retry takes the update path) but NOT the
    // publishedAt/publishedSlug (the page is not live yet).
    try {
      const partiallyStamped = updatePostField(workspaceId, postId, {
        webflowItemId: itemId,
        webflowCollectionId: collectionId,
      }, sourceRevision);
      if (!partiallyStamped) {
        throw recordExternalPublishConflict({
          workspaceId,
          postId,
          collectionId,
          itemId,
          externalState: externalStateAfterMutation,
          sourceRevision,
        });
      }
      runPublishPostCommitEffect(workspaceId, postId, 'draft-reconciliation-resolve', () => {
        resolveContentPublishReconciliation({ workspaceId, postId, collectionId, itemId });
      });
    } catch (err) {
      if (err instanceof PublishPostError && err.reconciliation) throw err;
      if (err instanceof GenerationRevisionConflictError) {
        throw recordExternalPublishConflict({
          workspaceId,
          postId,
          collectionId,
          itemId,
          externalState: externalStateAfterMutation,
          sourceRevision,
        });
      }
      throw recordExternalPublishStampFailure({
        workspaceId,
        postId,
        collectionId,
        itemId,
        externalState: externalStateAfterMutation,
        sourceRevision,
      }, err);
    }
    throw new PublishPostError('publish_failed', `Failed to publish CMS item: ${pubResult.error}`, 500);
  }

  // Success — stamp the full publish-tracking set.
  let updatedPost: PersistedGeneratedPost;
  try {
    const stamped = updatePostField(workspaceId, postId, {
      webflowItemId: itemId,
      webflowCollectionId: collectionId,
      publishedAt: new Date().toISOString(),
      publishedSlug: slug,
    }, sourceRevision);
    if (!stamped) {
      throw recordExternalPublishConflict({
        workspaceId,
        postId,
        collectionId,
        itemId,
        externalState: CONTENT_PUBLISH_EXTERNAL_STATES.PUBLISHED,
        sourceRevision,
      });
    }
    updatedPost = stamped;
  } catch (err) {
    if (err instanceof PublishPostError && err.reconciliation) throw err;
    if (err instanceof GenerationRevisionConflictError) {
      throw recordExternalPublishConflict({
        workspaceId,
        postId,
        collectionId,
        itemId,
        externalState: CONTENT_PUBLISH_EXTERNAL_STATES.PUBLISHED,
        sourceRevision,
      });
    }
    throw recordExternalPublishStampFailure({
      workspaceId,
      postId,
      collectionId,
      itemId,
      externalState: CONTENT_PUBLISH_EXTERNAL_STATES.PUBLISHED,
      sourceRevision,
    }, err);
  }
  const postCommitEffects: PublishPostCommitEffect[] = [
    {
      name: 'published-reconciliation-resolve',
      run: () => {
        resolveContentPublishReconciliation({ workspaceId, postId, collectionId, itemId });
      },
    },
    {
      name: 'activity',
      run: () => {
        addActivity(
          workspaceId,
          'content_published',
          activitySource === 'auto-publish'
            ? `Auto-published "${post.title}" to Webflow CMS on approval`
            : `${isUpdate ? 'Updated' : 'Published'} "${post.title}" to Webflow CMS`,
          `Collection: ${collectionName} · Slug: ${slug}`,
          { postId, itemId, collectionId, slug, isUpdate, source: activitySource },
        );
      },
    },
    {
      // Outcome tracking — the dedup guard prevents double-recording when a post is re-published
      // (re-deploy after a content edit) or a job is retried.
      name: 'outcome-action',
      run: () => {
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
            // R6 (B11): the published post's title is its identity — snapshot it so the "We
            // Called It" win reads the real headline even if the post is later edited/deleted.
            ...(post.title?.trim()
              ? { source: { label: post.title.trim(), snapshot: { title: post.title.trim(), type: 'post', page: publishedPagePath ?? undefined } } }
              : {}),
          });
          if (publishedPagePath) {
            void captureBaselineFromGsc(postAction.id, workspaceId, publishedPagePath).catch(err => {
              log.warn(
                { err, workspaceId, postId, effect: 'outcome-baseline' },
                'content publish post-commit effect failed',
              );
            });
          }
        }
      },
    },
    {
      name: 'intelligence-cache',
      run: () => {
        invalidateContentPipelineIntelligence(workspaceId);
      },
    },
    {
      name: 'published-broadcast',
      run: () => {
        broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_PUBLISHED, {
          postId,
          itemId,
          slug,
          title: post.title,
          isUpdate,
        });
      },
    },
    {
      // D2 (audit #11): resolve content-gap recommendations matching the published post's
      // target keyword — the "create content for X" rec completes the moment X goes live.
      name: 'recommendation-resolution',
      run: () => {
        resolveContentRecommendationsForPublishedPost(workspaceId, post.targetKeyword ?? null);
      },
    },
    {
      // A content publish changes the live page inventory, so both publish paths regenerate
      // follow-ons. A failure here must never undo or fail the committed publish.
      name: 'recommendation-regeneration',
      run: () => {
        queueKeywordStrategyPostUpdateFollowOns({ workspaceId });
      },
    },
  ];
  const runPostCommitEffects = createPublishPostCommitRunner(
    workspaceId,
    postId,
    postCommitEffects,
  );
  const result: PublishPostToWebflowResult = { itemId, slug, isUpdate, post: updatedPost };

  if (opts.deferPostCommitEffects) {
    return { ...result, runPostCommitEffects };
  }
  runPostCommitEffects();
  return result;
}
