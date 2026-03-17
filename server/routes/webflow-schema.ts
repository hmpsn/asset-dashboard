/**
 * webflow-schema routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { addActivity } from '../activity-log.js';
import { buildSchemaContext } from '../helpers.js';
import { getSchemaSnapshot, getOrSeedSiteTemplate, patchSiteTemplate, saveSiteTemplate } from '../schema-store.js';
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
    log.error({ detail: msg, err }, 'Schema suggester error');
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
  const { pageId, pageType } = req.body;
  if (!pageId) return res.status(400).json({ error: 'pageId required' });
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const { ctx } = buildSchemaContext(req.params.siteId);
    if (pageType) ctx.pageType = pageType;
    const result = await generateSchemaForPage(req.params.siteId, pageId, token, ctx);
    if (!result) return res.status(404).json({ error: 'Page not found' });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Single-page schema error');
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
        log.error({ detail: pubResult.error }, 'Site publish failed');
      }
    }

    // Auto-save site template if this is a homepage publish
    const isHomepage = req.body.isHomepage || false;
    if (isHomepage && schema?.['@graph']) {
      try {
        const graph = schema['@graph'] as Record<string, unknown>[];
        const orgNode = graph.find((n: Record<string, unknown>) => n['@type'] === 'Organization');
        const wsNode = graph.find((n: Record<string, unknown>) => n['@type'] === 'WebSite');
        if (orgNode) {
          const { ctx } = buildSchemaContext(req.params.siteId);
          const websiteNode = wsNode || {
            '@type': 'WebSite', '@id': `${orgNode['url']}/#website`,
            'url': orgNode['url'], 'name': orgNode['name'],
            'publisher': { '@id': `${orgNode['url']}/#organization` },
          };
          saveSiteTemplate(req.params.siteId, ctx.workspaceId || '', orgNode, websiteNode);
          log.info('Auto-saved site template from homepage publish');
        }
      } catch { /* best-effort */ }
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
    log.error({ detail: msg, err }, 'Schema publish error');
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
    log.error({ detail: msg, err }, 'CMS template schema error');
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
    log.error({ detail: msg, err }, 'CMS template publish error');
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
    log.error({ err: err }, 'CMS template pages error');
    res.json([]);
  }
});

// ── Site template endpoints ──

// GET: retrieve the site template (auto-seeds from existing snapshot if needed)
router.get('/api/webflow/schema-template/:siteId', (req, res) => {
  try {
    const { ctx } = buildSchemaContext(req.params.siteId);
    const template = getOrSeedSiteTemplate(req.params.siteId, ctx.workspaceId);
    if (!template) {
      res.status(404).json({ error: 'No site template found. Generate the homepage schema first.' });
      return;
    }
    res.json(template);
  } catch (err) {
    log.error({ err }, 'Get site template error');
    res.status(500).json({ error: 'Failed to get site template' });
  }
});

// PUT: replace the full site template (Organization + WebSite nodes)
router.put('/api/webflow/schema-template/:siteId', (req, res) => {
  try {
    const { organizationNode, websiteNode } = req.body;
    if (!organizationNode || !websiteNode) {
      res.status(400).json({ error: 'Both organizationNode and websiteNode are required' });
      return;
    }
    const { ctx } = buildSchemaContext(req.params.siteId);
    const template = saveSiteTemplate(req.params.siteId, ctx.workspaceId || '', organizationNode, websiteNode);
    res.json(template);
  } catch (err) {
    log.error({ err }, 'Save site template error');
    res.status(500).json({ error: 'Failed to save site template' });
  }
});

// PATCH: update specific fields on the template (e.g. logo URL)
router.patch('/api/webflow/schema-template/:siteId', (req, res) => {
  try {
    const { organizationNode, websiteNode } = req.body;
    // Auto-seed first if no template exists
    const { ctx } = buildSchemaContext(req.params.siteId);
    const existing = getOrSeedSiteTemplate(req.params.siteId, ctx.workspaceId);
    if (!existing) {
      res.status(404).json({ error: 'No site template found to patch. Generate the homepage schema first.' });
      return;
    }
    const template = patchSiteTemplate(req.params.siteId, organizationNode, websiteNode);
    res.json(template);
  } catch (err) {
    log.error({ err }, 'Patch site template error');
    res.status(500).json({ error: 'Failed to patch site template' });
  }
});

export default router;
