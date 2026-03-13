/**
 * webflow-schema routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { addActivity } from '../activity-log.js';
import { buildSchemaContext } from '../helpers.js';
import { getSchemaSnapshot } from '../schema-store.js';
import { generateSchemaSuggestions, generateSchemaForPage, generateCmsTemplateSchema } from '../schema-suggester.js';
import {
  listCollections,
  listPages,
  publishSite,
  publishSchemaToPage,
  publishRawSchemaToPage,
} from '../webflow.js';
import { listWorkspaces, getTokenForSite, updatePageState } from '../workspaces.js';
import { recordSeoChange } from '../seo-change-tracker.js';
import { createLogger } from '../logger.js';

const log = createLogger('webflow-schema');

router.get('/api/webflow/schema-suggestions/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const { ctx, pageKeywordMap } = buildSchemaContext(req.params.siteId);
    const result = await generateSchemaSuggestions(req.params.siteId, token, ctx, pageKeywordMap);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Schema suggester error:', msg, err);
    res.status(500).json({ error: `Schema suggestion failed: ${msg}` });
  }
});

// Load previously saved schema results from disk
router.get('/api/webflow/schema-snapshot/:siteId', (req, res) => {
  const snapshot = getSchemaSnapshot(req.params.siteId);
  if (!snapshot) return res.json(null);
  res.json(snapshot);
});

router.post('/api/webflow/schema-suggestions/:siteId/page', async (req, res) => {
  const { pageId } = req.body;
  if (!pageId) return res.status(400).json({ error: 'pageId required' });
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const { ctx } = buildSchemaContext(req.params.siteId);
    const result = await generateSchemaForPage(req.params.siteId, pageId, token, ctx);
    if (!result) return res.status(404).json({ error: 'Page not found' });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Single-page schema error:', msg, err);
    res.status(500).json({ error: `Schema generation failed: ${msg}` });
  }
});

// --- Publish Schema to Webflow Page ---
router.post('/api/webflow/schema-publish/:siteId', async (req, res) => {
  const { pageId, schema, publishAfter } = req.body;
  if (!pageId || !schema) return res.status(400).json({ error: 'pageId and schema required' });
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const result = await publishSchemaToPage(req.params.siteId, pageId, schema, token);
    if (!result.success) return res.status(500).json(result);

    // Optionally publish the site so changes go live
    let published = false;
    if (publishAfter) {
      const pubResult = await publishSite(req.params.siteId, token);
      published = pubResult.success;
      if (!pubResult.success) {
        log.error('Site publish failed:', pubResult.error);
      }
    }

    // Log to activity feed + track edit status
    const pubWs = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    if (pubWs) {
      addActivity(pubWs.id, 'schema_published', 'Schema published to Webflow', `Page ${pageId.slice(0, 8)}… — ${published ? 'site published' : 'saved as draft'}`, { pageId });
      updatePageState(pubWs.id, pageId, { status: 'live', source: 'schema', fields: ['schema'], updatedBy: 'admin' });
      recordSeoChange(pubWs.id, pageId, req.body.pageSlug || '', req.body.pageTitle || '', ['schema'], 'schema');
    }

    res.json({ success: true, published });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Schema publish error:', msg, err);
    res.status(500).json({ error: `Schema publish failed: ${msg}` });
  }
});

// --- CMS Template Schema ---
router.post('/api/webflow/schema-cms-template/:siteId', async (req, res) => {
  const { collectionId } = req.body;
  if (!collectionId) return res.status(400).json({ error: 'collectionId required' });
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const { ctx } = buildSchemaContext(req.params.siteId);
    const result = await generateCmsTemplateSchema(req.params.siteId, collectionId, token, ctx);
    if (!result) return res.status(500).json({ error: 'Failed to generate CMS template schema' });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('CMS template schema error:', msg, err);
    res.status(500).json({ error: `CMS template schema failed: ${msg}` });
  }
});

router.post('/api/webflow/schema-cms-template/:siteId/publish', async (req, res) => {
  const { pageId, templateString, publishAfter } = req.body;
  if (!pageId || !templateString) return res.status(400).json({ error: 'pageId and templateString required' });
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const result = await publishRawSchemaToPage(req.params.siteId, pageId, templateString, token);
    if (!result.success) return res.status(500).json(result);

    let published = false;
    if (publishAfter) {
      const pubResult = await publishSite(req.params.siteId, token);
      published = pubResult.success;
    }

    // Track schema change
    const cmsWs = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    if (cmsWs) {
      updatePageState(cmsWs.id, pageId, { status: 'live', source: 'schema', fields: ['schema'], updatedBy: 'admin' });
      recordSeoChange(cmsWs.id, pageId, req.body.pageSlug || '', req.body.pageTitle || '', ['schema'], 'schema-template');
    }

    res.json({ success: true, published });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('CMS template publish error:', msg, err);
    res.status(500).json({ error: `CMS template publish failed: ${msg}` });
  }
});

// --- List CMS template pages (pages with collectionId) ---
router.get('/api/webflow/cms-template-pages/:siteId', async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const allPages = await listPages(req.params.siteId, token);
    const collections = await listCollections(req.params.siteId, token);
    const collMap = new Map(collections.map(c => [c.id, c]));

    const templatePages = allPages
      .filter(p => p.collectionId)
      .map(p => ({
        pageId: p.id,
        pageTitle: p.title,
        slug: p.slug,
        collectionId: p.collectionId,
        collectionName: collMap.get(p.collectionId!)?.displayName || '',
        collectionSlug: collMap.get(p.collectionId!)?.slug || '',
      }));

    res.json(templatePages);
  } catch (err) {
    log.error('CMS template pages error:', err);
    res.json([]);
  }
});

export default router;
