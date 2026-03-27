/**
 * webflow-schema routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccessFromQuery } from '../auth.js';
const router = Router();

import { addActivity } from '../activity-log.js';
import { validate, z } from '../middleware/validate.js';
import { buildSchemaContext } from '../helpers.js';
import { getCachedArchitecture } from '../site-architecture.js';
import { getSchemaSnapshot, getOrSeedSiteTemplate, patchSiteTemplate, saveSiteTemplate, updatePageSchemaInSnapshot, getSchemaPlan, updateSchemaPlanStatus, updateSchemaPlanRoles, deleteSchemaPlan, deleteSchemaSnapshot, removePageFromSnapshot, getPageTypes, savePageType, recordSchemaPublish, getSchemaPublishHistory, getSchemaPublishEntry, getPublishDatesForSite } from '../schema-store.js';
import { generateSchemaSuggestions, generateSchemaForPage, generateCmsTemplateSchema } from '../schema-suggester.js';
import { generateSchemaPlan } from '../schema-plan.js';
import { deleteBatch } from '../approvals.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.ts';
import { broadcastToWorkspace } from '../broadcast.js';
import { notifyApprovalReady } from '../email.js';
import {
  listCollections,
  listPages,
  publishSite,
  publishSchemaToPage,
  publishRawSchemaToPage,
  retractSchemaFromPage,
} from '../webflow.js';
import { listWorkspaces, getTokenForSite, updatePageState, getWorkspace, getClientPortalUrl } from '../workspaces.js';
import { queueLlmsTxtRegeneration } from '../llms-txt-generator.js';
import { recordSeoChange } from '../seo-change-tracker.js';
import { listPendingSchemas } from '../schema-queue.js';
import { createLogger } from '../logger.js';
import {
  validateForGoogleRichResults,
  validateEntityConsistency,
  upsertValidation,
  getValidation,
  getValidations,
  deleteValidation,
} from '../schema-validator.js';

const log = createLogger('webflow-schema');

router.get('/api/webflow/schema-suggestions/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const { ctx, pageKeywordMap, gscMap, ga4Map } = await buildSchemaContext(req.params.siteId, { includeAnalytics: true });
    // Enrich with architecture tree (best-effort — don't block if unavailable)
    if (ctx.workspaceId) {
      try {
        const arch = await getCachedArchitecture(ctx.workspaceId);
        ctx._architectureTree = arch.tree;
      } catch { /* architecture not available — proceed without */ }
    }
    const result = await generateSchemaSuggestions(req.params.siteId, token, ctx, pageKeywordMap, undefined, undefined, gscMap, ga4Map);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Schema suggester error');
    res.status(500).json({ error: `Schema suggestion failed: ${msg}` });
  }
});

// Load previously saved schema results from disk, annotated with publish dates
router.get('/api/webflow/schema-snapshot/:siteId', requireWorkspaceAccessFromQuery(), (req, res) => {
  const snapshot = getSchemaSnapshot(req.params.siteId);
  if (!snapshot) return res.json(null);
  // Annotate each page result with its last publish date (for stale schema detection)
  const publishDates = getPublishDatesForSite(req.params.siteId);
  for (const result of snapshot.results) {
    (result as Record<string, unknown>).lastPublishedAt = publishDates[result.pageId] || null;
  }
  res.json(snapshot);
});

// ── Page Type Persistence ──

router.get('/api/webflow/schema-page-types/:siteId', requireWorkspaceAccessFromQuery(), (req, res) => {
  res.json({ pageTypes: getPageTypes(req.params.siteId) });
});

const pageTypeSchema = z.object({
  pageId: z.string().min(1),
  pageType: z.string().min(1),
});

router.put('/api/webflow/schema-page-types/:siteId', requireWorkspaceAccessFromQuery(), validate(pageTypeSchema), (req, res) => {
  const { pageId, pageType } = req.body;
  savePageType(req.params.siteId, pageId, pageType);
  res.json({ ok: true });
});

router.post('/api/webflow/schema-suggestions/:siteId/page', requireWorkspaceAccessFromQuery(), async (req, res) => {
  const { pageId, pageType } = req.body;
  if (!pageId) return res.status(400).json({ error: 'pageId required' });
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const { ctx, gscMap, ga4Map } = await buildSchemaContext(req.params.siteId, { includeAnalytics: true });
    // Use explicitly-passed pageType, fall back to persisted type for this page
    const resolvedPageType = pageType || getPageTypes(req.params.siteId)[pageId];
    if (resolvedPageType) ctx.pageType = resolvedPageType;
    // Enrich with architecture tree for deterministic breadcrumbs
    if (ctx.workspaceId) {
      try {
        const arch = await getCachedArchitecture(ctx.workspaceId);
        ctx._architectureTree = arch.tree;
      } catch { /* proceed without architecture */ }
    }
    const result = await generateSchemaForPage(req.params.siteId, pageId, token, ctx, gscMap, ga4Map);
    if (!result) return res.status(404).json({ error: 'Page not found' });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Single-page schema error');
    res.status(500).json({ error: `Schema generation failed: ${msg}` });
  }
});

// --- Publish Schema to Webflow Page ---
router.post('/api/webflow/schema-publish/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  const { pageId, schema, publishAfter, skipValidation } = req.body;
  if (!pageId || !schema) return res.status(400).json({ error: 'pageId and schema required' });

  try {
    // Validation gate: validate before publishing (unless explicitly skipped)
    if (!skipValidation) {
      const validation = validateForGoogleRichResults(schema);
      const ws = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
      const workspaceId = ws?.id || req.params.siteId;
      upsertValidation({
        workspaceId,
        pageId,
        status: validation.status,
        richResults: validation.richResults,
        errors: validation.errors.map(e => ({ type: e.type, message: e.message })),
        warnings: validation.warnings.map(e => ({ type: e.type, message: e.message })),
      });
      if (validation.status === 'errors') {
        return res.status(422).json({
          error: 'Schema has validation errors — fix before publishing',
          validation,
        });
      }
    }

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

    // Persist edited schema back to snapshot so it survives reload
    updatePageSchemaInSnapshot(req.params.siteId, pageId, schema);

    // Record version history for rollback support
    const pubWsForHistory = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    recordSchemaPublish(req.params.siteId, pageId, pubWsForHistory?.id || '', schema);

    // Auto-save site template if this is a homepage publish
    const isHomepage = req.body.isHomepage || false;
    if (isHomepage && schema?.['@graph']) {
      try {
        const graph = schema['@graph'] as Record<string, unknown>[];
        const orgNode = graph.find((n: Record<string, unknown>) => n['@type'] === 'Organization');
        const wsNode = graph.find((n: Record<string, unknown>) => n['@type'] === 'WebSite');
        if (orgNode) {
          const { ctx } = await buildSchemaContext(req.params.siteId);
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

    // Trigger background llms.txt regeneration after schema publish
    try {
      const llmsWs = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
      if (llmsWs) queueLlmsTxtRegeneration(llmsWs.id, 'schema_published');
    } catch { /* non-critical — response already sent */ }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Schema publish error');
    res.status(500).json({ error: `Schema publish failed: ${msg}` });
  }
});

// --- CMS Template Schema ---
router.post('/api/webflow/schema-cms-template/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  const { collectionId } = req.body;
  if (!collectionId) return res.status(400).json({ error: 'collectionId required' });
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const { ctx } = await buildSchemaContext(req.params.siteId);
    const result = await generateCmsTemplateSchema(req.params.siteId, collectionId, token, ctx);
    if (!result) return res.status(500).json({ error: 'Failed to generate CMS template schema' });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'CMS template schema error');
    res.status(500).json({ error: `CMS template schema failed: ${msg}` });
  }
});

router.post('/api/webflow/schema-cms-template/:siteId/publish', requireWorkspaceAccessFromQuery(), async (req, res) => {
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
router.get('/api/webflow/cms-template-pages/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
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
router.get('/api/webflow/schema-template/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const { ctx } = await buildSchemaContext(req.params.siteId);
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
router.put('/api/webflow/schema-template/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const { organizationNode, websiteNode } = req.body;
    if (!organizationNode || !websiteNode) {
      res.status(400).json({ error: 'Both organizationNode and websiteNode are required' });
      return;
    }
    const { ctx } = await buildSchemaContext(req.params.siteId);
    const template = saveSiteTemplate(req.params.siteId, ctx.workspaceId || '', organizationNode, websiteNode);
    res.json(template);
  } catch (err) {
    log.error({ err }, 'Save site template error');
    res.status(500).json({ error: 'Failed to save site template' });
  }
});

// PATCH: update specific fields on the template (e.g. logo URL)
router.patch('/api/webflow/schema-template/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const { organizationNode, websiteNode } = req.body;
    // Auto-seed first if no template exists
    const { ctx } = await buildSchemaContext(req.params.siteId);
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

// ── Schema Site Plan endpoints ──

// POST: generate a new schema plan for the site
router.post('/api/webflow/schema-plan/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const { ctx } = await buildSchemaContext(req.params.siteId);
    const ws = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    if (!ws) return res.status(404).json({ error: 'No workspace found for this site' });

    // Load architecture tree to avoid duplicate Webflow API + sitemap calls
    let architectureResult;
    try {
      architectureResult = await getCachedArchitecture(ws.id);
    } catch { /* proceed without — plan will fall back to direct API calls */ }

    // Gather current schema types from existing snapshot for competitor gap analysis
    const existingSnapshot = getSchemaSnapshot(req.params.siteId);
    const ourSchemaTypes = existingSnapshot
      ? [...new Set(existingSnapshot.results.flatMap(p =>
          p.suggestedSchemas?.flatMap(s => s.type?.split(' + ') || []) || []
        ))]
      : [];

    const plan = await generateSchemaPlan({
      siteId: req.params.siteId,
      workspaceId: ws.id,
      siteUrl: ctx.liveDomain ? `https://${ctx.liveDomain}` : '',
      companyName: ctx.companyName,
      businessContext: ctx.businessContext,
      strategy: ws.keywordStrategy,
      tokenOverride: getTokenForSite(req.params.siteId) || undefined,
      architectureResult,
      competitorDomains: ws.competitorDomains,
      ourSchemaTypes,
    });

    addActivity(ws.id, 'schema_plan_generated', 'Schema site plan generated', `${plan.pageRoles.length} pages, ${plan.canonicalEntities.length} entities`);
    res.json(plan);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Schema plan generation error');
    res.status(500).json({ error: `Schema plan generation failed: ${msg}` });
  }
});

// GET: retrieve the current plan for a site
router.get('/api/webflow/schema-plan/:siteId', requireWorkspaceAccessFromQuery(), (req, res) => {
  const plan = getSchemaPlan(req.params.siteId);
  if (!plan) return res.json(null);
  res.json(plan);
});

// PUT: update page roles / canonical entities on the plan
router.put('/api/webflow/schema-plan/:siteId', requireWorkspaceAccessFromQuery(), (req, res) => {
  const { pageRoles, canonicalEntities } = req.body;
  if (!pageRoles) return res.status(400).json({ error: 'pageRoles required' });
  const plan = updateSchemaPlanRoles(req.params.siteId, pageRoles, canonicalEntities);
  if (!plan) return res.status(404).json({ error: 'No plan found for this site' });
  res.json(plan);
});

// POST: send plan preview to client for review (in dedicated Schema tab, not Inbox)
router.post('/api/webflow/schema-plan/:siteId/send-to-client', requireWorkspaceAccessFromQuery(), (req, res) => {
  try {
    const plan = getSchemaPlan(req.params.siteId);
    if (!plan) return res.status(404).json({ error: 'No plan found. Generate one first.' });

    const ws = getWorkspace(plan.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    // Update plan status — no approval batch; client reviews in the Schema tab
    const updated = updateSchemaPlanStatus(req.params.siteId, 'sent_to_client');

    // Notify client via email, directing to the Schema tab
    if (ws.clientEmail) {
      const dashUrl = getClientPortalUrl(ws);
      notifyApprovalReady({
        clientEmail: ws.clientEmail,
        workspaceName: ws.name,
        workspaceId: ws.id,
        batchName: 'Schema Strategy Review',
        itemCount: plan.pageRoles.length,
        dashboardUrl: dashUrl,
      });
    }

    broadcastToWorkspace(ws.id, 'schema:plan_sent', { siteId: req.params.siteId });
    addActivity(ws.id, 'schema_plan_sent', 'Schema strategy sent to client for review', `${plan.pageRoles.length} pages`);
    res.json({ plan: updated || plan });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Send schema plan to client error');
    res.status(500).json({ error: `Failed to send plan: ${msg}` });
  }
});

// POST: mark plan as active (approved or admin-confirmed)
router.post('/api/webflow/schema-plan/:siteId/activate', requireWorkspaceAccessFromQuery(), (req, res) => {
  const plan = updateSchemaPlanStatus(req.params.siteId, 'active');
  if (!plan) return res.status(404).json({ error: 'No plan found' });
  res.json(plan);
});

// DELETE: retract (delete) the entire schema plan for a site
router.delete('/api/webflow/schema-plan/:siteId', requireWorkspaceAccessFromQuery(), (req, res) => {
  // Read plan first to grab the approval batch ID before deleting
  const plan = getSchemaPlan(req.params.siteId);
  if (!plan) return res.status(404).json({ error: 'No plan found for this site' });

  deleteSchemaPlan(req.params.siteId);

  // Also clear the schema snapshot so the client dashboard doesn't show stale data
  deleteSchemaSnapshot(req.params.siteId);

  // Delete the associated approval batch (sent-to-client preview) if one exists
  if (plan.clientPreviewBatchId) {
    deleteBatch(plan.workspaceId, plan.clientPreviewBatchId);
  }

  const ws = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
  if (ws) {
    addActivity(ws.id, 'schema_plan_generated', 'Schema site plan retracted', 'Plan deleted by admin');
  }
  res.json({ success: true });
});

// DELETE: retract (remove) published schema from a specific page
router.delete('/api/webflow/schema-retract/:siteId/:pageId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  const { siteId, pageId } = req.params;
  try {
    const token = getTokenForSite(siteId) || undefined;
    const result = await retractSchemaFromPage(siteId, pageId, token);
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to retract schema' });
    }

    // Optionally publish the site so the removal goes live
    if (req.query.publish === 'true') {
      await publishSite(siteId, token);
    }

    // Remove from snapshot so it doesn't show as "existing" on reload
    removePageFromSnapshot(siteId, pageId);

    // Update page state + activity
    const ws = listWorkspaces().find(w => w.webflowSiteId === siteId);
    if (ws) {
      addActivity(ws.id, 'schema_published', 'Schema retracted from page', `Page ${pageId.slice(0, 8)}… — ${result.removed} script(s) removed`, { pageId });
      updatePageState(ws.id, pageId, { status: 'clean', source: 'schema', fields: ['schema'], updatedBy: 'admin' });
    }

    res.json({ success: true, removed: result.removed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Schema retract error');
    res.status(500).json({ error: `Schema retract failed: ${msg}` });
  }
});

// ── Schema Version History + Rollback ──

router.get('/api/webflow/schema-history/:siteId/:pageId', requireWorkspaceAccessFromQuery(), (req, res) => {
  const history = getSchemaPublishHistory(req.params.siteId, req.params.pageId, 20);
  res.json({ history });
});

router.post('/api/webflow/schema-rollback/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  const { pageId, historyId } = req.body;
  if (!pageId || !historyId) return res.status(400).json({ error: 'pageId and historyId required' });
  try {
    const entry = getSchemaPublishEntry(historyId);
    if (!entry) return res.status(404).json({ error: 'History entry not found' });
    if (entry.pageId !== pageId || entry.siteId !== req.params.siteId) {
      return res.status(400).json({ error: 'History entry does not match page/site' });
    }

    // Re-publish the old schema to the Webflow page
    const token = getTokenForSite(req.params.siteId) || undefined;
    const result = await publishSchemaToPage(req.params.siteId, pageId, entry.schemaJson, token);
    if (!result.success) return res.status(500).json(result);

    // Update snapshot with restored schema
    updatePageSchemaInSnapshot(req.params.siteId, pageId, entry.schemaJson);

    // Record this rollback as a new publish event
    const ws = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    recordSchemaPublish(req.params.siteId, pageId, ws?.id || '', entry.schemaJson);

    // Activity log
    if (ws) {
      addActivity(ws.id, 'schema_published', 'Schema rolled back to previous version',
        `Page ${pageId.slice(0, 8)}… — restored from ${new Date(entry.publishedAt).toLocaleDateString()}`,
        { pageId, historyId });
    }

    res.json({ success: true, restoredSchema: entry.schemaJson });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Schema rollback error');
    res.status(500).json({ error: `Schema rollback failed: ${msg}` });
  }
});

// ── Public (client-facing) schema endpoints ──

// GET: client-readable schema snapshot (read-only)
router.get('/api/public/schema-snapshot/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId) return res.status(404).json({ error: 'No site linked' });
  const snapshot = getSchemaSnapshot(ws.webflowSiteId);
  if (!snapshot) return res.json(null);
  // Return a simplified view — page titles, slugs, schema types only
  const pages = snapshot.results.map(r => ({
    pageId: r.pageId,
    pageTitle: r.pageTitle,
    slug: r.slug,
    url: r.url,
    existingSchemas: r.existingSchemas || [],
    schemaTypes: (r.suggestedSchemas?.[0]?.template?.['@graph'] as Array<{ '@type'?: string }> || [])
      .map(n => String(n['@type'])).filter(Boolean),
    priority: r.suggestedSchemas?.[0]?.priority || 'medium',
  }));
  res.json({ pages, pageCount: snapshot.pageCount, createdAt: snapshot.createdAt });
});

// GET: client-readable schema plan (read-only)
router.get('/api/public/schema-plan/:workspaceId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId) return res.status(404).json({ error: 'No site linked' });
  const plan = getSchemaPlan(ws.webflowSiteId);
  if (!plan) return res.json(null);
  res.json(plan);
});

// POST: client feedback on schema plan (approve / request changes)
router.post('/api/public/schema-plan/:workspaceId/feedback', (req, res) => {
  const { action, note } = req.body;
  if (!action || !['approve', 'request_changes'].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve" or "request_changes"' });
  }
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId) return res.status(404).json({ error: 'No site linked' });

  const newStatus = action === 'approve' ? 'client_approved' : 'client_changes_requested';
  const plan = updateSchemaPlanStatus(ws.webflowSiteId, newStatus as SchemaSitePlan['status']);
  if (!plan) return res.status(404).json({ error: 'No plan found' });

  const label = action === 'approve' ? 'approved' : 'requested changes on';
  addActivity(ws.id, 'changes_requested', `Client ${label} schema plan`, note || undefined);
  broadcastToWorkspace(ws.id, 'approval:update', { action: 'schema_plan_feedback', status: newStatus });
  res.json(plan);
});

// ── Pending Schemas (D7: pre-generated schema skeletons) ──

router.get('/api/pending-schemas/:workspaceId', (req, res) => {
  try {
    const pendingSchemas = listPendingSchemas(req.params.workspaceId);
    res.json({ pendingSchemas });
  } catch (err) {
    log.error({ err }, 'Pending schemas error');
    res.status(500).json({ error: 'Failed to list pending schemas' });
  }
});

// ── Schema Validation ────────────────────────────────────────────

const schemaValidateBody = z.object({
  pageId: z.string().min(1),
  schema: z.record(z.unknown()),
});

const schemaConsistencyBody = z.object({
  schemas: z.array(z.object({
    pageId: z.string().min(1),
    schema: z.record(z.unknown()),
  })).min(1),
});

// Validate a single page schema against Google Rich Results rules
router.post('/api/webflow/schema-validate/:siteId', requireWorkspaceAccessFromQuery(), validate(schemaValidateBody), (req, res) => {
  try {
    const { pageId, schema } = req.body as { pageId: string; schema: Record<string, unknown> };
    const ws = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    const workspaceId = ws?.id || req.params.siteId;

    const result = validateForGoogleRichResults(schema);
    upsertValidation({
      workspaceId,
      pageId,
      status: result.status,
      richResults: result.richResults,
      errors: result.errors.map(e => ({ type: e.type, message: e.message })),
      warnings: result.warnings.map(e => ({ type: e.type, message: e.message })),
    });

    res.json(result);
  } catch (err) {
    log.error({ err }, 'Schema validate error');
    res.status(500).json({ error: 'Schema validation failed' });
  }
});

// Batch validate all schemas for entity consistency across a workspace
router.post('/api/webflow/schema-validate-consistency/:siteId', requireWorkspaceAccessFromQuery(), validate(schemaConsistencyBody), (req, res) => {
  try {
    const { schemas } = req.body as { schemas: Array<{ pageId: string; schema: Record<string, unknown> }> };
    const result = validateEntityConsistency(schemas);
    res.json(result);
  } catch (err) {
    log.error({ err }, 'Schema consistency validate error');
    res.status(500).json({ error: 'Entity consistency check failed' });
  }
});

// Get validation status for a single page
router.get('/api/webflow/schema-validation/:siteId', requireWorkspaceAccessFromQuery(), (req, res) => {
  try {
    const pageId = req.query.pageId as string;
    if (!pageId) return res.status(400).json({ error: 'pageId query param required' });

    const ws = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    const workspaceId = ws?.id || req.params.siteId;

    const validation = getValidation(workspaceId, pageId);
    res.json(validation);
  } catch (err) {
    log.error({ err }, 'Get validation error');
    res.status(500).json({ error: 'Failed to get validation' });
  }
});

// Get all validations for a workspace
router.get('/api/webflow/schema-validations/:siteId', requireWorkspaceAccessFromQuery(), (req, res) => {
  try {
    const ws = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    const workspaceId = ws?.id || req.params.siteId;

    const validations = getValidations(workspaceId);
    res.json(validations);
  } catch (err) {
    log.error({ err }, 'Get validations error');
    res.status(500).json({ error: 'Failed to get validations' });
  }
});

// Delete a validation record
router.delete('/api/webflow/schema-validation/:siteId', requireWorkspaceAccessFromQuery(), (req, res) => {
  try {
    const pageId = req.query.pageId as string;
    if (!pageId) return res.status(400).json({ error: 'pageId query param required' });

    const ws = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    const workspaceId = ws?.id || req.params.siteId;

    const deleted = deleteValidation(workspaceId, pageId);
    res.json({ deleted });
  } catch (err) {
    log.error({ err }, 'Delete validation error');
    res.status(500).json({ error: 'Failed to delete validation' });
  }
});

export default router;
