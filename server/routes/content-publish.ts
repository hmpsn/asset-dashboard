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
import { callOpenAI } from '../openai-helpers.js';
import { WS_EVENTS } from '../ws-events.js';
import { createLogger } from '../logger.js';
import { requireWorkspaceAccess } from '../auth.js';

const log = createLogger('content-publish');
const router = Router();

// --- Publish a content post to Webflow CMS ---
router.post('/api/content-posts/:workspaceId/:postId/publish-to-webflow', requireWorkspaceAccess('workspaceId'), async (req, res) => {
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
      log.warn(`CMS publish warning for ${itemId}: ${pubResult.error}`);
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

    // Broadcast to workspace
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
  } catch (err) {
    log.error({ err }, 'Publish to Webflow failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Publish failed' });
  }
});

// --- Suggest field mapping for a collection ---
router.post('/api/webflow/suggest-field-mapping/:siteId', async (req, res) => {
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

    const result = await callOpenAI({
      model: 'gpt-4.1-nano',
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
      feature: 'suggest-field-mapping',
    });

    let mapping: Record<string, string | null>;
    try {
      const cleaned = result.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      mapping = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI suggestion' });
    }

    res.json({ mapping, fields: schema.fields });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Suggestion failed' });
  }
});

// --- Get collections for a site (used by PublishSettings UI) ---
router.get('/api/webflow/publish-collections/:siteId', async (req, res) => {
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
router.get('/api/webflow/publish-schema/:collectionId', async (req, res) => {
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
