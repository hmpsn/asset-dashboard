/**
 * Content publish routes — publish generated posts to Webflow CMS.
 */
import { Router } from 'express';
import { getTokenForSite } from '../workspaces.js';
import {
  getCollectionSchema,
  listCollections,
} from '../webflow.js';
import { callAI } from '../ai.js';
import { createLogger } from '../logger.js';
import { validate, z } from '../middleware/validate.js';
import { requireWorkspaceAccess, requireWorkspaceSiteAccess, requireWorkspaceSiteAccessFromQuery } from '../auth.js';
import { parseWebflowFieldMapping, type AiWebflowFieldMapping } from '../schemas/ai-content-publish.js';
import { PublishPostError } from '../domains/content/publish-post-to-webflow.js';
import { publishPostToWebflowWithClaim } from '../content-publish-job.js';
import { ActiveJobResourceConflict } from '../jobs.js';

const log = createLogger('content-publish');
const router = Router();

const publishContentPostSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  generateImage: z.boolean().optional(),
}).strict();

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
//
// Synchronous foreground publish: the operator UI awaits this call and expects the inline
// `{ success, itemId, slug, isUpdate, post }` result (image-generation toggle + immediate row
// refresh). The shared `publishPostToWebflow()` service owns the field map, broadcast, activity,
// outcome tracking, and rec-regen follow-on — the SAME service the auto-publish job calls, so the
// two paths can no longer drift. Auto-publish is the one that runs as a background job; manual
// publish stays inline (see docs/superpowers/plans/2026-06-10-c3-publish-service.md).
router.post('/api/content-posts/:workspaceId/:postId/publish-to-webflow', requireWorkspaceAccess('workspaceId'), validate(publishContentPostSchema), async (req, res) => {
  const { workspaceId, postId } = req.params;
  const { generateImage, expectedRevision } = req.body as {
    generateImage?: boolean;
    expectedRevision: number;
  };

  try {
    const { result } = await publishPostToWebflowWithClaim({
      workspaceId,
      postId,
      expectedRevision,
      generateImage,
      activitySource: 'manual',
    });
    res.json({
      success: true,
      itemId: result.itemId,
      slug: result.slug,
      isUpdate: result.isUpdate,
      post: result.post,
    });
  } catch (err) {
    if (err instanceof ActiveJobResourceConflict) {
      return res.status(409).json({
        error: 'A publish or generation job is already active for this post',
        code: err.code,
        jobId: err.jobId,
      });
    }
    if (err instanceof PublishPostError) {
      return res.status(err.httpStatus).json({
        error: err.message,
        code: err.code,
        ...(err.reconciliation ? { reconciliation: err.reconciliation } : {}),
      });
    }
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
