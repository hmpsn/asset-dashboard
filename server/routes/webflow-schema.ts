/**
 * webflow-schema routes — extracted from server/index.ts
 *
 * @reads workspaces, schema_snapshots, schema_templates, schema_plans, schema_validations, schema_publish_history, schema_cms_field_mappings, workspace_pages, pending_schemas, webflow_api
 * @writes schema_snapshots, schema_templates, schema_plans, schema_validations, schema_publish_history, schema_cms_field_mappings, pending_schemas, approvals, outcome_actions, seo_changes, activities
 */
import { Router } from 'express';

import { requireWorkspaceSiteAccessFromQuery } from '../auth.js';
import { requireClientPortalAuth } from '../middleware.js';
import { addActivity } from '../activity-log.js';
import { validate, z } from '../middleware/validate.js';
import { buildSchemaContext } from '../schema/context-builder.js';
import { prepareBulkSchemaGenerationContext, prepareSinglePageSchemaGenerationContext } from '../schema-generation-context.js';
import { buildSchemaIntelligence } from '../schema-intelligence.js';
import { getSchemaSnapshot, getSiteTemplate, getOrSeedSiteTemplate, patchSiteTemplate, saveSiteTemplate, updatePageSchemaInSnapshot, upsertPageResultInSnapshot, getSchemaPlan, removePageFromSnapshot, getPageTypes, savePageType, recordSchemaPublish, getSchemaPublishHistory, getSchemaPublishEntry, getPublishDatesForSite, getSchemaCmsFieldMappings, saveSchemaCmsFieldMapping } from '../schema-store.js';
import { generateSchemaSuggestions, generateSchemaForPage } from '../schema-suggester.js';
import { SCHEMA_ROLE_LABELS, type SchemaPageRole } from '../../shared/types/schema-plan.ts';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import {
  listCollections,
  getCollectionSchema,
  publishSite,
  publishSchemaToPage,
  retractSchemaFromPage,
} from '../webflow.js';
import { detectSchemaFieldTarget, getRecommendedSchemaFieldSlug } from '../schema/site-inventory.js';
import type { SchemaFieldTarget } from '../../shared/types/site-inventory.ts';
import { getTokenForSite, getWorkspace, getWorkspaceBySiteId, updatePageState } from '../workspaces.js';
import { publishSchemaToLive } from '../domains/schema/publish-schema-to-live.js';
import { invalidateIntelligenceCache } from '../intelligence/cache-invalidation.js';
import {
  syncSchemaPlanDeliverable,
} from '../domains/inbox/schema-plan-dual-write.js';
import {
  activateSchemaPlanForAdmin,
  deleteSchemaPlanForAdmin,
  respondToSchemaPlanFeedback,
  sendSchemaPlanToClientForReview,
  updateSchemaPlanForAdmin,
} from '../domains/schema/schema-plan-lifecycle.js';
// listPendingSchemas import removed in W6.3 (GET /api/pending-schemas endpoint deleted — no UI consumer)
import { createLogger } from '../logger.js';
import {
  schemaPlanGenerationErrorResponse,
  startSchemaPlanGenerationJob,
} from '../schema-plan-generation-job.js';
import { hasActiveJob } from '../jobs.js';
import {
  validateForGoogleRichResults,
  upsertValidation,
  getValidation,
  getValidations,
  deleteValidation,
} from '../schema-validator.js';
import { validateLeanSchema } from '../schema/validator.js';
import { validateWholeSiteSchemaGraph } from '../schema/whole-site-graph-validator.js';
import { isProgrammingError } from '../errors.js';
import {
  toAdminSchemaSnapshotView,
  toAdminSchemaView,
  toClientSchemaSnapshotView,
  toClientSchemaView,
} from '../serializers/client-safe.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

const router = Router();
const log = createLogger('webflow-schema');

const schemaPlanFeedbackSchema = z.object({
  action: z.enum(['approve', 'request_changes']),
  note: z.string().max(2000).optional(),
}).strict();

function broadcastSchemaSnapshotUpdated(
  siteId: string,
  workspaceId: string | undefined,
  action: 'generated' | 'published' | 'deleted' | 'retracted' | 'rolled_back',
  pageId?: string,
): void {
  if (!workspaceId) return;
  broadcastToWorkspace(workspaceId, WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED, {
    siteId,
    action,
    ...(pageId ? { pageId } : {}),
  });
}

// `publishSchemaToCmsField` moved to server/domains/schema/publish-schema-to-cms-field.ts
// (it formerly lived here and the MCP tool imported it FROM this route — a
// tool→route smell). Re-exported for backward compatibility with existing
// importers (tests, etc.); new code should import it from the schema domain.
export { publishSchemaToCmsField } from '../domains/schema/publish-schema-to-cms-field.js';

router.get('/api/webflow/schema-suggestions/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const { ctx } = await prepareBulkSchemaGenerationContext(req.params.siteId);
    const result = await generateSchemaSuggestions(req.params.siteId, token, ctx);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Schema suggester error');
    res.status(500).json({ error: `Schema suggestion failed: ${msg}` });
  }
});

// Load previously saved schema results from disk, annotated with publish dates
router.get('/api/webflow/schema-snapshot/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const snapshot = getSchemaSnapshot(req.params.siteId);
  if (!snapshot) return res.json(null);
  const publishDates = getPublishDatesForSite(req.params.siteId);
  res.json(toAdminSchemaSnapshotView(snapshot, publishDates));
});

// ── Page Type Persistence ──

router.get('/api/webflow/schema-page-types/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  res.json({ pageTypes: getPageTypes(req.params.siteId) });
});

const pageTypeSchema = z.object({
  pageId: z.string().min(1),
  pageType: z.string().min(1),
});

router.put('/api/webflow/schema-page-types/:siteId', requireWorkspaceSiteAccessFromQuery(), validate(pageTypeSchema), (req, res) => {
  const { pageId, pageType } = req.body;
  savePageType(req.params.siteId, pageId, pageType);
  res.json({ ok: true });
});

// ── Collection-aware schema inventory and CMS delivery mapping ──

router.get('/api/webflow/schema-site-inventory/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  try {
    const siteId = req.params.siteId;
    const token = getTokenForSite(siteId) || undefined;
    const schemaIntel = await buildSchemaIntelligence({
      siteId,
      tokenOverride: token,
      includeSiteInventory: true,
    });
    if (!schemaIntel?.baseUrl) return res.status(400).json({ error: 'No live domain configured' });
    if (!schemaIntel.siteInventory) return res.status(404).json({ error: 'No workspace found for this site' });
    res.json(schemaIntel.siteInventory);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Schema site inventory error');
    res.status(500).json({ error: `Schema site inventory failed: ${msg}` });
  }
});

router.get('/api/webflow/schema-cms-field-mappings/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  try {
    const siteId = req.params.siteId;
    const token = getTokenForSite(siteId) || undefined;
    const mappings = getSchemaCmsFieldMappings(siteId);
    const collections = await listCollections(siteId, token);
    const detected = await Promise.all(collections.map(async collection => {
      const schema = await getCollectionSchema(collection.id, token);
      const fields = schema.fields.map(field => ({
        ...field,
        target: detectSchemaFieldTarget({
          id: field.id,
          slug: field.slug,
          displayName: field.displayName,
          type: field.type,
        }),
      }));
      const mapped = mappings.find(m => m.collectionId === collection.id);
      const recommended = fields.find(f => f.slug === getRecommendedSchemaFieldSlug())
        ?? fields.find(f => /schema|json-?ld/i.test(`${f.slug} ${f.displayName}`));
      return {
        collectionId: collection.id,
        collectionName: collection.displayName,
        collectionSlug: collection.slug,
        fields,
        recommendedFieldSlug: recommended?.slug,
        mapping: mapped ?? null,
      };
    }));
    res.json({ mappings, collections: detected });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Schema CMS field mappings error');
    res.status(500).json({ error: `Schema CMS field mappings failed: ${msg}` });
  }
});

const cmsFieldMappingSchema = z.object({
  collectionId: z.string().min(1),
  collectionName: z.string().min(1),
  collectionSlug: z.string().optional().default(''),
  schemaFieldSlug: z.string().optional(),
  fieldMappings: z.record(z.string(), z.string()).optional(),
  collectionRole: z.string().optional().refine(
    role => !role || role in SCHEMA_ROLE_LABELS,
    'collectionRole must be a supported schema role',
  ),
});

const VALID_SCHEMA_FIELD_TARGETS = new Set<SchemaFieldTarget>([
  'title',
  'description',
  'author',
  'datePublished',
  'dateModified',
  'image',
  'locationName',
  'streetAddress',
  'addressLocality',
  'addressRegion',
  'postalCode',
  'addressCountry',
  'phone',
  'email',
  'openingHours',
  'serviceName',
  'serviceType',
  'areaServed',
  'teamRole',
  'credentials',
  'price',
  'priceCurrency',
  'videoUrl',
  'schemaJsonLd',
]);

function normalizeFieldMappings(raw: Record<string, string> | undefined): Partial<Record<SchemaFieldTarget, string>> | undefined {
  if (!raw) return undefined;
  const out: Partial<Record<SchemaFieldTarget, string>> = {};
  for (const [target, slug] of Object.entries(raw)) {
    if (!VALID_SCHEMA_FIELD_TARGETS.has(target as SchemaFieldTarget)) continue;
    if (typeof slug === 'string' && slug.trim()) out[target as SchemaFieldTarget] = slug.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

router.put('/api/webflow/schema-cms-field-mappings/:siteId', requireWorkspaceSiteAccessFromQuery(), validate(cmsFieldMappingSchema), (req, res) => {
  const mapping = saveSchemaCmsFieldMapping({
    siteId: req.params.siteId,
    collectionId: req.body.collectionId,
    collectionName: req.body.collectionName,
    collectionSlug: req.body.collectionSlug || '',
    schemaFieldSlug: req.body.schemaFieldSlug || undefined,
    collectionRole: (req.body.collectionRole || undefined) as SchemaPageRole | undefined,
    fieldMappings: normalizeFieldMappings(req.body.fieldMappings),
  });
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  const ws = workspaceId ? getWorkspace(workspaceId) : getWorkspaceBySiteId(req.params.siteId);
  if (ws) {
    broadcastToWorkspace(ws.id, WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED, {
      siteId: req.params.siteId,
      collectionId: mapping.collectionId,
      collectionName: mapping.collectionName,
    });
    addActivity(
      ws.id,
      'schema_mapping_updated',
      `Updated schema field mapping for ${mapping.collectionName}`,
      mapping.schemaFieldSlug
        ? `Schema JSON field: ${mapping.schemaFieldSlug}`
        : 'Collection schema field mapping updated',
      { siteId: req.params.siteId, collectionId: mapping.collectionId },
    );
  }
  res.json(mapping);
});

router.post('/api/webflow/schema-suggestions/:siteId/page', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  const { pageId, pageType } = req.body;
  if (!pageId) return res.status(400).json({ error: 'pageId required' });
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const { ctx } = await prepareSinglePageSchemaGenerationContext(req.params.siteId, pageId, pageType);
    const result = await generateSchemaForPage(req.params.siteId, pageId, token, ctx);
    if (!result) return res.status(404).json({ error: 'Page not found' });

    // Persist the freshly-generated page result so it survives reload and a
    // SCHEMA_SNAPSHOT_UPDATED refetch does not clobber it. Insert-if-missing
    // (the page may not yet exist in the snapshot for an "Add Page" generation).
    const ws = getWorkspaceBySiteId(req.params.siteId)
      || (ctx.workspaceId ? getWorkspace(ctx.workspaceId) : undefined);
    upsertPageResultInSnapshot(req.params.siteId, ws?.id || ctx.workspaceId || '', result);
    broadcastSchemaSnapshotUpdated(req.params.siteId, ws?.id, 'generated', pageId);

    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Single-page schema error');
    res.status(500).json({ error: `Schema generation failed: ${msg}` });
  }
});

// --- Publish Schema to Webflow Page ---
router.post('/api/webflow/schema-publish/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  const { pageId, schema, publishAfter, skipValidation } = req.body;
  if (!pageId || !schema) return res.status(400).json({ error: 'pageId and schema required' });

  try {
    // Validation gate: validate before publishing (unless explicitly skipped)
    if (!skipValidation) {
      const structuralFindings = validateLeanSchema(schema, 'WebPage');
      const structuralErrors = structuralFindings.filter(f => f.severity === 'error');
      if (structuralErrors.length > 0) {
        return res.status(422).json({
          error: 'Schema has structural errors — fix before publishing',
          validation: {
            status: 'errors',
            errors: structuralErrors,
            warnings: structuralFindings.filter(f => f.severity === 'warning'),
          },
        });
      }
      const validation = validateForGoogleRichResults(schema);
      const ws = getWorkspaceBySiteId(req.params.siteId);
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
    const workspaceId = getWorkspaceBySiteId(req.params.siteId)?.id || '';

    // The full publish + canonical follow-on set (CMS-field first, then static
    // custom-code) lives in the shared `publishSchemaToLive` domain service so
    // the admin route and the MCP `publish_schema` tool stay in lockstep.
    const publishResult = await publishSchemaToLive({
      siteId: req.params.siteId,
      pageId,
      schema,
      workspaceId,
      token,
      pageTitle: req.body.pageTitle || '',
      publishedPath: req.body.publishedPath || req.body.pageSlug || '',
      publishAfter,
    });

    if (!publishResult.ok) {
      if (publishResult.kind === 'cms-blocked' || publishResult.kind === 'cms-failed') {
        return res.status(422).json({
          success: false,
          cmsDeliveryStatus: publishResult.cmsDelivery,
          error: publishResult.message,
        });
      }
      if (publishResult.kind === 'manual-required') {
        // Preserve the historical response: echo the full publish result so the
        // admin UI can render the manual-native-schema-field copy instructions.
        return res.json(publishResult.pageResult);
      }
      // Static publish failed (Webflow rejected the schema script).
      return res.status(500).json(publishResult.pageResult);
    }

    if (publishResult.mode === 'cms-field') {
      return res.json({
        success: true,
        published: !!publishAfter,
        cmsDeliveryStatus: publishResult.cmsDelivery,
      });
    }

    // ── Static-page custom-code publish succeeded ──
    // Auto-save site template if this is a homepage publish. This is route-only
    // request-shaping (driven by req.body.isHomepage) so it stays in the adapter.
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
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-schema: programming error'); /* best-effort */ }
    }

    const result = publishResult.pageResult!;
    res.json({ ...result, success: true, published: result.published ?? true, sitePublished: publishResult.sitePublished });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Schema publish error');
    res.status(500).json({ error: `Schema publish failed: ${msg}` });
  }
});

// ── Site template endpoints ──

// GET: retrieve the site template (auto-seeds from existing snapshot if needed)
router.get('/api/webflow/schema-template/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
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
router.put('/api/webflow/schema-template/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
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
router.patch('/api/webflow/schema-template/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
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
router.post('/api/webflow/schema-plan/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
  try {
    const siteId = req.params.siteId;
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
    const started = startSchemaPlanGenerationJob(siteId, workspaceId);
    res.json({ ...started, deprecated: true });
  } catch (err) {
    try {
      const response = schemaPlanGenerationErrorResponse(err);
      res.status(response.status).json(response.body);
    } catch (unexpected) {
      const msg = unexpected instanceof Error ? unexpected.message : String(unexpected);
      log.error({ detail: msg, err: unexpected }, 'Schema plan generation error');
      res.status(500).json({ error: `Schema plan generation failed: ${msg}` });
    }
  }
});

// GET: retrieve the current plan for a site
router.get('/api/webflow/schema-plan/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const plan = getSchemaPlan(req.params.siteId);
  if (!plan) return res.json(null);
  res.json(toAdminSchemaView(plan));
});

// PUT: update page roles / canonical entities on the plan
router.put('/api/webflow/schema-plan/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const { pageRoles, canonicalEntities } = req.body;
  if (!pageRoles) return res.status(400).json({ error: 'pageRoles required' });
  const result = updateSchemaPlanForAdmin(req.params.siteId, pageRoles, canonicalEntities);
  if (!result.ok) return res.status(result.status).json('jobId' in result ? { error: result.error, jobId: result.jobId } : { error: result.error });
  res.json(result.value);
});

// POST: send plan preview to client for review (in dedicated Schema tab, not Inbox)
router.post('/api/webflow/schema-plan/:siteId/send-to-client', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  try {
    const result = sendSchemaPlanToClientForReview(req.params.siteId);
    if (!result.ok) return res.status(result.status).json('jobId' in result ? { error: result.error, jobId: result.jobId } : { error: result.error });
    res.json(result.value);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Send schema plan to client error');
    res.status(500).json({ error: `Failed to send plan: ${msg}` });
  }
});

// POST: mark plan as active (approved or admin-confirmed)
router.post('/api/webflow/schema-plan/:siteId/activate', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const result = activateSchemaPlanForAdmin(req.params.siteId);
  if (!result.ok) return res.status(result.status).json('jobId' in result ? { error: result.error, jobId: result.jobId } : { error: result.error });
  res.json(result.value);
});

// DELETE: retract (delete) the entire schema plan for a site
router.delete('/api/webflow/schema-plan/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const result = deleteSchemaPlanForAdmin(req.params.siteId);
  if (!result.ok) return res.status(result.status).json('jobId' in result ? { error: result.error, jobId: result.jobId } : { error: result.error });
  res.json(result.value);
});

// DELETE: retract (remove) published schema from a specific page
router.delete('/api/webflow/schema-retract/:siteId/:pageId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
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
    const snapshotUpdated = removePageFromSnapshot(siteId, pageId);

    // Update page state + activity
    const ws = getWorkspaceBySiteId(siteId);
    if (snapshotUpdated) broadcastSchemaSnapshotUpdated(siteId, ws?.id, 'retracted', pageId);
    if (ws) {
      addActivity(ws.id, 'schema_published', 'Schema retracted from page', `Page ${pageId.slice(0, 8)}… — ${result.removed} script(s) removed`, { pageId });
      updatePageState(ws.id, pageId, { status: 'clean', source: 'schema', fields: ['schema'], updatedBy: 'admin' });
      invalidateIntelligenceCache(ws.id);
    }

    res.json({ success: true, removed: result.removed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Schema retract error');
    res.status(500).json({ error: `Schema retract failed: ${msg}` });
  }
});

// ── Schema Version History + Rollback ──

router.get('/api/webflow/schema-history/:siteId/:pageId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const history = getSchemaPublishHistory(req.params.siteId, req.params.pageId, 20);
  res.json({ history });
});

router.post('/api/webflow/schema-rollback/:siteId', requireWorkspaceSiteAccessFromQuery(), async (req, res) => {
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
    if (result.delivery.status === 'manual-required') return res.status(409).json(result);
    if (!result.success) return res.status(500).json(result);

    // Update snapshot with restored schema
    const snapshotUpdated = updatePageSchemaInSnapshot(req.params.siteId, pageId, entry.schemaJson);

    // Record this rollback as a new publish event
    const ws = getWorkspaceBySiteId(req.params.siteId);
    if (snapshotUpdated) broadcastSchemaSnapshotUpdated(req.params.siteId, ws?.id, 'rolled_back', pageId);
    recordSchemaPublish(req.params.siteId, pageId, ws?.id || '', entry.schemaJson);

    // Activity log
    if (ws) {
      addActivity(ws.id, 'schema_published', 'Schema rolled back to previous version',
        `Page ${pageId.slice(0, 8)}… — restored from ${new Date(entry.publishedAt).toLocaleDateString()}`,
        { pageId, historyId });
      invalidateIntelligenceCache(ws.id);
    }

    res.json({ ...result, success: true, restoredSchema: entry.schemaJson });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Schema rollback error');
    res.status(500).json({ error: `Schema rollback failed: ${msg}` });
  }
});

// ── Public (client-facing) schema endpoints ──

// GET: client-readable schema snapshot (read-only)
router.get('/api/public/schema-snapshot/:workspaceId', requireClientPortalAuth(), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId) return res.status(404).json({ error: 'No site linked' });
  const snapshot = getSchemaSnapshot(ws.webflowSiteId);
  if (!snapshot) return res.json(null);
  res.json(toClientSchemaSnapshotView(snapshot));
});

// GET: client-readable schema plan (read-only)
router.get('/api/public/schema-plan/:workspaceId', requireClientPortalAuth(), (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId) return res.status(404).json({ error: 'No site linked' });
  const plan = getSchemaPlan(ws.webflowSiteId);
  if (!plan) return res.json(null);
  if (!['sent_to_client', 'client_approved', 'client_changes_requested', 'active'].includes(plan.status)) return res.json(null);
  res.json(toClientSchemaView(plan));
});

// POST: client feedback on schema plan (approve / request changes)
router.post('/api/public/schema-plan/:workspaceId/feedback', requireClientPortalAuth(), validate(schemaPlanFeedbackSchema), (req, res) => {
  const { action, note } = req.body;
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws?.webflowSiteId) return res.status(404).json({ error: 'No site linked' });
  const existing = getSchemaPlan(ws.webflowSiteId);
  if (!existing) return res.status(404).json({ error: 'No plan found' });
  if (existing.status !== 'sent_to_client') return res.status(409).json({ error: 'Schema plan is not ready for client feedback' });
  const activeJob = hasActiveJob(BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION, ws.id);
  if (activeJob) {
    return res.status(409).json({
      error: 'Schema plan generation is in progress. Wait for it to finish before responding to this plan.',
      jobId: activeJob.id,
    });
  }

  // Delegate to the shared respondToSchemaPlanFeedback service (R2) so this route and the
  // unified-inbox respond propagation drive the SAME source write (no divergence).
  const result = respondToSchemaPlanFeedback(ws.id, ws.webflowSiteId, action, note);
  if (!result) return res.status(404).json({ error: 'No plan found' });
  syncSchemaPlanDeliverable(result.plan);
  res.json(toClientSchemaView(result.plan));
});

// GET /api/pending-schemas/:workspaceId was removed in W6.3.
// The endpoint had no UI consumer. The pending_schemas table is still populated by
// queueSchemaPreGeneration and read by the content-pipeline intelligence slice.
// See server/schema-queue.ts for the comment trail on markSchemaApplied removal.

// ── Schema Validation ────────────────────────────────────────────

const schemaValidateBody = z.object({
  pageId: z.string().min(1),
  schema: z.record(z.unknown()),
});

// Validate a single page schema against Google Rich Results rules
router.post('/api/webflow/schema-validate/:siteId', requireWorkspaceSiteAccessFromQuery(), validate(schemaValidateBody), (req, res) => {
  try {
    const { pageId, schema } = req.body as { pageId: string; schema: Record<string, unknown> };
    const ws = getWorkspaceBySiteId(req.params.siteId);
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

// Validate the latest generated snapshot as one whole-site JSON-LD graph.
router.get('/api/webflow/schema-graph-validation/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  try {
    const snapshot = getSchemaSnapshot(req.params.siteId);
    const plan = getSchemaPlan(req.params.siteId);
    const result = validateWholeSiteSchemaGraph({
      pages: snapshot?.results ?? [],
      siteTemplate: getSiteTemplate(req.params.siteId),
      activePlan: plan?.status === 'active' ? plan : null,
    });
    res.json(result);
  } catch (err) {
    log.error({ err }, 'Schema graph validation error');
    res.status(500).json({ error: 'Schema graph validation failed' });
  }
});

// Get validation status for a single page
router.get('/api/webflow/schema-validation/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  try {
    const pageId = req.query.pageId as string;
    if (!pageId) return res.status(400).json({ error: 'pageId query param required' });

    const ws = getWorkspaceBySiteId(req.params.siteId);
    const workspaceId = ws?.id || req.params.siteId;

    const validation = getValidation(workspaceId, pageId);
    res.json(validation);
  } catch (err) {
    log.error({ err }, 'Get validation error');
    res.status(500).json({ error: 'Failed to get validation' });
  }
});

// Get all validations for a workspace
router.get('/api/webflow/schema-validations/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  try {
    const ws = getWorkspaceBySiteId(req.params.siteId);
    const workspaceId = ws?.id || req.params.siteId;

    const validations = getValidations(workspaceId);
    res.json(validations);
  } catch (err) {
    log.error({ err }, 'Get validations error');
    res.status(500).json({ error: 'Failed to get validations' });
  }
});

// Delete a validation record
router.delete('/api/webflow/schema-validation/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  try {
    const pageId = req.query.pageId as string;
    if (!pageId) return res.status(400).json({ error: 'pageId query param required' });

    const ws = getWorkspaceBySiteId(req.params.siteId);
    const workspaceId = ws?.id || req.params.siteId;

    const deleted = deleteValidation(workspaceId, pageId);
    res.json({ deleted });
  } catch (err) {
    log.error({ err }, 'Delete validation error');
    res.status(500).json({ error: 'Failed to delete validation' });
  }
});

export default router;
