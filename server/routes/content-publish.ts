/**
 * Content publish routes — publish generated posts to Webflow CMS.
 */
import { Router } from 'express';
import { getPost, updatePostField } from '../content-posts.js';
import { getBrief } from '../content-brief.js';
import { getWorkspace, getTokenForSite } from '../workspaces.js';
import {
  createCollectionItem,
  updateCollectionItem,
  publishCollectionItems,
  getCollectionSchema,
  listCollections,
} from '../webflow.js';
import { assemblePostHtml, generateSlug } from '../html-to-richtext.js';
import { generateFeaturedImage } from '../content-image.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { callAI } from '../ai.js';
import { WS_EVENTS } from '../ws-events.js';
import { createLogger } from '../logger.js';
import { validate, z } from '../middleware/validate.js';
import { requireWorkspaceAccess, requireWorkspaceSiteAccess, requireWorkspaceSiteAccessFromQuery } from '../auth.js';
import { invalidateContentPipelineIntelligence } from '../intelligence-freshness.js';
import { queueKeywordStrategyPostUpdateFollowOns } from '../keyword-strategy-follow-ons.js';
import { recordAction, getActionByWorkspaceAndSource } from '../outcome-tracking.js';
import { captureBaselineFromGsc } from '../outcome-measurement.js';
import { normalizePageUrl } from '../helpers.js';
import { parseWebflowFieldMapping, type AiWebflowFieldMapping } from '../schemas/ai-content-publish.js';

const log = createLogger('content-publish');
const router = Router();

const publishContentPostSchema = z.object({
  generateImage: z.boolean().optional(),
}).strict().default({});

const FIELD_MAPPING_KEYS = [
  'title',
  'slug',
  'body',
  'metaTitle',
  'metaDescription',
  'summary',
  'featuredImage',
  'author',
  'publishDate',
  'category',
] as const satisfies readonly (keyof AiWebflowFieldMapping)[];

function keepKnownFieldSlugs(
  mapping: AiWebflowFieldMapping,
  validSlugs: ReadonlySet<string>,
): AiWebflowFieldMapping {
  const sanitized: AiWebflowFieldMapping = {};
  for (const key of FIELD_MAPPING_KEYS) {
    const value = mapping[key];
    sanitized[key] = value && validSlugs.has(value) ? value : null;
  }
  return sanitized;
}

// --- Publish a content post to Webflow CMS ---
router.post('/api/content-posts/:workspaceId/:postId/publish-to-webflow', requireWorkspaceAccess('workspaceId'), validate(publishContentPostSchema), async (req, res) => {
  const { workspaceId, postId } = req.params;
  const { generateImage } = req.body as { generateImage?: boolean };

  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (!ws.publishTarget) return res.status(400).json({ error: 'No publish target configured. Set up Publish Settings first.' });
    if (!ws.webflowSiteId) return res.status(400).json({ error: 'No Webflow site linked to this workspace' });

    const token = getTokenForSite(ws.webflowSiteId) || undefined;
    if (!token) return res.status(400).json({ error: 'No Webflow API token configured' });

    const post = getPost(workspaceId, postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // Allow approved posts or admin override (draft/review)
    if (post.status !== 'approved' && post.status !== 'draft' && post.status !== 'review') {
      return res.status(400).json({ error: `Post status "${post.status}" cannot be published` });
    }

    const { collectionId, fieldMap } = ws.publishTarget;

    // Build the body HTML
    const bodyHtml = assemblePostHtml(post);
    const slug = generateSlug(post.title);

    // Build fieldData using the field mapping
    const fieldData: Record<string, unknown> = {};

    if (fieldMap.title) fieldData[fieldMap.title] = post.title;
    if (fieldMap.slug) fieldData[fieldMap.slug] = slug;
    if (fieldMap.body) fieldData[fieldMap.body] = bodyHtml;
    if (fieldMap.metaTitle) fieldData[fieldMap.metaTitle] = post.seoTitle || post.title;
    if (fieldMap.metaDescription) fieldData[fieldMap.metaDescription] = post.seoMetaDescription || post.metaDescription;
    if (fieldMap.publishDate) fieldData[fieldMap.publishDate] = new Date().toISOString();

    // Load brief for summary/excerpt if mapped
    if (fieldMap.summary) {
      const brief = getBrief(workspaceId, post.briefId);
      if (brief?.executiveSummary) {
        fieldData[fieldMap.summary] = brief.executiveSummary;
      }
    }

    // Generate featured image if requested and mapped
    if (generateImage && fieldMap.featuredImage) {
      log.info(`Generating featured image for post ${postId}`);
      const imgResult = await generateFeaturedImage(post, ws.webflowSiteId, token);
      if (imgResult.success && imgResult.hostedUrl) {
        fieldData[fieldMap.featuredImage] = { url: imgResult.hostedUrl };
      } else {
        log.warn(`Featured image generation failed: ${imgResult.error}`);
      }
    }

    let itemId: string | undefined;
    let isUpdate = false;

    // Re-read post to avoid race with auto-publish on approval (which runs
    // in the background and may have completed between our initial read and now)
    const freshPost = getPost(workspaceId, postId) || post;

    // Check if already published (update vs create)
    if (freshPost.webflowItemId && freshPost.webflowCollectionId === collectionId) {
      // Update existing CMS item
      isUpdate = true;
      const updateResult = await updateCollectionItem(collectionId, freshPost.webflowItemId!, fieldData, token);
      if (!updateResult.success) {
        return res.status(500).json({ error: `Failed to update CMS item: ${updateResult.error}` });
      }
      itemId = freshPost.webflowItemId;
    } else {
      // Create new CMS item (live, not draft)
      const createResult = await createCollectionItem(collectionId, fieldData, false, token);
      if (!createResult.success) {
        return res.status(500).json({ error: `Failed to create CMS item: ${createResult.error}` });
      }
      itemId = createResult.itemId;
    }

    if (!itemId) {
      return res.status(500).json({ error: 'No item ID returned from Webflow' });
    }

    // Publish the CMS item to make it live
    const pubResult = await publishCollectionItems(collectionId, [itemId], token);
    if (!pubResult.success) {
      updatePostField(workspaceId, postId, {
        webflowItemId: itemId,
        webflowCollectionId: collectionId,
      });
      return res.status(500).json({ error: `Failed to publish CMS item: ${pubResult.error}` });
    }

    // Update the post record with publish tracking data
    const updatedPost = updatePostField(workspaceId, postId, {
      webflowItemId: itemId,
      webflowCollectionId: collectionId,
      publishedAt: new Date().toISOString(),
      publishedSlug: slug,
    });

    // Log activity
    addActivity(workspaceId, 'content_published',
      `${isUpdate ? 'Updated' : 'Published'} "${post.title}" to Webflow CMS`,
      `Collection: ${ws.publishTarget.collectionName} · Slug: ${slug}`,
      { postId, itemId, collectionId, slug, isUpdate },
    );

    // Record for outcome tracking — guard prevents duplicates if the same post
    // is re-published (e.g. re-deploy after a content edit).
    try {
      if (!getActionByWorkspaceAndSource(workspaceId, 'post', postId)) {
        const publishedPagePath = slug ? normalizePageUrl(slug) : null;
        const postAction = recordAction({ // recordAction-ok: workspaceId from validated route param
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
      log.warn({ err, postId }, 'Failed to record outcome action for manual content publish');
    }

    // Broadcast to workspace
    invalidateContentPipelineIntelligence(workspaceId);
    broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_PUBLISHED, {
      postId,
      itemId,
      slug,
      title: post.title,
      isUpdate,
    });

    res.json({
      success: true,
      itemId,
      slug,
      isUpdate,
      post: updatedPost,
    });

    // Enqueue a recommendation regen after the response is sent — a content
    // publish changes the live page inventory so recommendations should reflect
    // it. Guarded in its own try/catch: the response has already been sent, so a
    // throw here must NOT fall through to the outer catch (which would attempt a
    // second, header-already-sent 500 response). The shared regen scheduler
    // dedupes per-workspace execution.
    try {
      queueKeywordStrategyPostUpdateFollowOns({ workspaceId });
    } catch (err) {
      log.warn({ err, workspaceId }, 'Failed to enqueue recommendation regen after content publish');
    }
  } catch (err) {
    log.error({ err }, 'Publish to Webflow failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Publish failed' });
  }
});

// --- Suggest field mapping for a collection ---
router.post('/api/webflow/suggest-field-mapping/:siteId', requireWorkspaceSiteAccess({
  workspace: { source: 'body', name: 'workspaceId' },
  site: { source: 'params', name: 'siteId' },
}), async (req, res) => {
  const { siteId } = req.params;
  const { collectionId } = req.body as { collectionId: string };

  if (!collectionId) return res.status(400).json({ error: 'collectionId required' });

  try {
    const token = getTokenForSite(siteId) || undefined;
    if (!token) return res.status(400).json({ error: 'No Webflow token for this site' });

    const schema = await getCollectionSchema(collectionId, token);
    if (!schema.fields?.length) {
      return res.status(400).json({ error: 'No fields found for this collection' });
    }

    // Use AI to suggest field mappings
    const fieldsDescription = schema.fields.map(f => `- slug: "${f.slug}", displayName: "${f.displayName}", type: "${f.type}"`).join('\n');

    const result = await callAI({
      operation: 'content-publish-field-mapping',
      messages: [{
        role: 'user',
        content: `Given this Webflow CMS collection schema, suggest which field slugs map to each blog post property. Return ONLY valid JSON.

Collection fields:
${fieldsDescription}

Map to these properties (use the field SLUG values, or null if no match):
{
  "title": "field slug for blog post title (usually 'name')",
  "slug": "field slug for URL slug (usually 'slug')",
  "body": "field slug for rich text body content",
  "metaTitle": "field slug for SEO title or null",
  "metaDescription": "field slug for meta description or null",
  "summary": "field slug for excerpt/summary or null",
  "featuredImage": "field slug for featured image or null",
  "author": "field slug for author or null",
  "publishDate": "field slug for publish date or null",
  "category": "field slug for category/tags or null"
}

Return ONLY the JSON object with the mapping.`,
      }],
      maxTokens: 500,
      temperature: 0.1,
      responseFormat: { type: 'json_object' },
    });

    let mapping: AiWebflowFieldMapping;
    try {
      const parsed = parseWebflowFieldMapping(result.text);
      const validSlugs = new Set(schema.fields.map(field => field.slug));
      mapping = keepKnownFieldSlugs(parsed, validSlugs);
    } catch (err) {
      log.debug({ err }, 'content-publish: expected error — degrading gracefully');
      return res.status(500).json({ error: 'Failed to parse AI suggestion' });
    }

    res.json({ mapping, fields: schema.fields });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Suggestion failed' });
  }
});

// --- Get collections for a site (used by PublishSettings UI) ---
router.get('/api/webflow/publish-collections/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  const { siteId } = req.params;
  try {
    const token = getTokenForSite(siteId) || undefined;
    if (!token) return res.status(400).json({ error: 'No Webflow token' });
    const collections = await listCollections(siteId, token);
    res.json(collections);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch collections' });
  }
});

// --- Get collection schema (used by PublishSettings UI) ---
router.get('/api/webflow/publish-schema/:collectionId', requireWorkspaceSiteAccess({
  workspace: { source: 'query', name: 'workspaceId' },
  site: { source: 'query', name: 'siteId' },
}), async (req, res) => {
  const { collectionId } = req.params;
  const { siteId } = req.query as { siteId?: string };
  try {
    const token = siteId ? (getTokenForSite(siteId) || undefined) : undefined;
    const schema = await getCollectionSchema(collectionId, token);
    res.json(schema);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch schema' });
  }
});

export default router;
