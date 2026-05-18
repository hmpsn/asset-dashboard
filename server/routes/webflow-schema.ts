/**
 * webflow-schema routes — extracted from server/index.ts
 *
 * @reads workspaces, schema_snapshots, schema_templates, schema_plans, schema_validations, schema_publish_history, schema_cms_field_mappings, workspace_pages, pending_schemas, webflow_api
 * @writes schema_snapshots, schema_templates, schema_plans, schema_validations, schema_publish_history, schema_cms_field_mappings, pending_schemas, approvals, outcome_actions, seo_changes, activities
 */
import { Router } from 'express';
import { createHash } from 'node:crypto';

import { requireWorkspaceAccess, requireWorkspaceSiteAccessFromQuery } from '../auth.js';
import { requireClientPortalAuth } from '../middleware.js';
import { addActivity } from '../activity-log.js';
import { validate, z } from '../middleware/validate.js';
import { buildSchemaContext, normalizePageUrl } from '../helpers.js';
import { getCachedArchitecture } from '../site-architecture.js';
import { prepareBulkSchemaGenerationContext, prepareSinglePageSchemaGenerationContext } from '../schema-generation-context.js';
import { getSchemaSnapshot, getSiteTemplate, getOrSeedSiteTemplate, patchSiteTemplate, saveSiteTemplate, updatePageSchemaInSnapshot, getSchemaPlan, updateSchemaPlanStatus, updateSchemaPlanRoles, deleteSchemaPlan, deleteSchemaSnapshot, removePageFromSnapshot, getPageTypes, savePageType, recordSchemaPublish, getSchemaPublishHistory, getSchemaPublishEntry, getPublishDatesForSite, getSchemaCmsFieldMappings, saveSchemaCmsFieldMapping } from '../schema-store.js';
import { generateSchemaSuggestions, generateSchemaForPage } from '../schema-suggester.js';
import { generateSchemaPlan } from '../schema-plan.js';
import { deleteBatch } from '../approvals.js';
import { SCHEMA_ROLE_LABELS, type SchemaPageRole, type SchemaSitePlan } from '../../shared/types/schema-plan.ts';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { notifyApprovalReady } from '../email.js';
import {
  listCollections,
  getCollectionSchema,
  getCollectionItem,
  updateCollectionItem,
  publishCollectionItems,
  publishSite,
  publishSchemaToPage,
  retractSchemaFromPage,
} from '../webflow.js';
import { buildSiteInventory, detectSchemaFieldTarget, getRecommendedSchemaFieldSlug } from '../schema/site-inventory.js';
import type { SchemaCmsDeliveryStatus, SchemaFieldTarget } from '../../shared/types/site-inventory.ts';
import { listWorkspaces, getTokenForSite, updatePageState, getWorkspace, getClientPortalUrl } from '../workspaces.js';
import { getWorkspaceAllPages } from '../workspace-data.js';
import { queueLlmsTxtRegeneration } from '../llms-txt-generator.js';
import { recordSeoChange } from '../seo-change-tracker.js';
import { recordAction, getActionByWorkspaceAndSource } from '../outcome-tracking.js';
import { captureBaselineFromGsc } from '../outcome-measurement.js';
import { listPendingSchemas } from '../schema-queue.js';
import { createLogger } from '../logger.js';
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

const router = Router();
const log = createLogger('webflow-schema');

const schemaPlanFeedbackSchema = z.object({
  action: z.enum(['approve', 'request_changes']),
  note: z.string().max(2000).optional(),
}).strict();

function schemaHash(schema: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(schema)).digest('hex').slice(0, 16);
}

function sanitizeSchemaJsonForCms(schema: Record<string, unknown>): string {
  return JSON.stringify(schema).replace(/<\/script/gi, '<\\/script');
}

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

export async function publishSchemaToCmsField(opts: {
  siteId: string;
  pageId: string;
  schema: Record<string, unknown>;
  publishAfter?: boolean;
  token?: string;
}): Promise<SchemaCmsDeliveryStatus | null> {
  const snapshot = getSchemaSnapshot(opts.siteId);
  const page = snapshot?.results.find(r => r.pageId === opts.pageId);
  const collection = page?.generationDiagnostics?.collection;
  if (!collection?.collectionId || !collection.itemId) return null;

  const mappings = getSchemaCmsFieldMappings(opts.siteId);
  const mapping = mappings.find(m => m.collectionId === collection.collectionId);
  const fieldSlug = mapping?.schemaFieldSlug || page?.generationDiagnostics?.cmsDeliveryStatus?.fieldSlug;
  if (!fieldSlug) {
    return {
      mode: 'cms-field',
      status: 'blocked',
      message: `CMS publish blocked: no mapped schema field for collection ${collection.collectionName}.`,
    };
  }
  const collectionSchema = await getCollectionSchema(collection.collectionId, opts.token);
  const mappedField = collectionSchema.fields.find(f => f.slug === fieldSlug);
  if (!mappedField || !['PlainText', 'RichText'].includes(mappedField.type)) {
    return {
      mode: 'cms-field',
      status: 'blocked',
      fieldSlug,
      message: mappedField
        ? `CMS publish blocked: mapped field ${fieldSlug} is ${mappedField.type}, not a text field.`
        : `CMS publish blocked: mapped field ${fieldSlug} was not found on ${collection.collectionName}.`,
    };
  }

  const schemaJson = sanitizeSchemaJsonForCms(opts.schema);
  const hash = schemaHash(opts.schema);
  const currentItem = await getCollectionItem(collection.collectionId, collection.itemId, opts.token);
  const currentFieldData = (currentItem?.fieldData || currentItem || {}) as Record<string, unknown>;
  if (currentFieldData[fieldSlug] === schemaJson) {
    if (opts.publishAfter) {
      const publishResult = await publishCollectionItems(collection.collectionId, [collection.itemId], opts.token);
      if (!publishResult.success) {
        return {
          mode: 'cms-field',
          status: 'failed',
          fieldSlug,
          hash,
          message: publishResult.error || `CMS item publish failed for unchanged ${fieldSlug}.`,
        };
      }
    }
    return {
      mode: 'cms-field',
      status: 'unchanged',
      fieldSlug,
      hash,
      message: opts.publishAfter
        ? `CMS field unchanged: ${fieldSlug}; CMS item published.`
        : `CMS field unchanged: ${fieldSlug}.`,
    };
  }

  const updateResult = await updateCollectionItem(collection.collectionId, collection.itemId, { [fieldSlug]: schemaJson }, opts.token);
  if (!updateResult.success) {
    return {
      mode: 'cms-field',
      status: 'failed',
      fieldSlug,
      hash,
      message: updateResult.error || `CMS field write failed: ${fieldSlug}.`,
    };
  }

  if (opts.publishAfter) {
    const publishResult = await publishCollectionItems(collection.collectionId, [collection.itemId], opts.token);
    if (!publishResult.success) {
      return {
        mode: 'cms-field',
        status: 'failed',
        fieldSlug,
        hash,
        message: publishResult.error || `CMS item publish failed after writing ${fieldSlug}.`,
      };
    }
  }

  return {
    mode: 'cms-field',
    status: 'written',
    fieldSlug,
    hash,
    message: `CMS field written: ${fieldSlug}, hash changed.`,
  };
}

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
    const { ctx } = await buildSchemaContext(siteId);
    const ws = ctx.workspaceId ? getWorkspace(ctx.workspaceId) : listWorkspaces().find(w => w.webflowSiteId === siteId);
    const pages = ws ? await getWorkspaceAllPages(ws.id, siteId) : [];
    const baseUrl = ctx.liveDomain
      ? (ctx.liveDomain.startsWith('http') ? ctx.liveDomain : `https://${ctx.liveDomain}`)
      : '';
    if (!baseUrl) return res.status(400).json({ error: 'No live domain configured' });
    const inventory = await buildSiteInventory({
      siteId,
      baseUrl,
      pages,
      tokenOverride: token,
      businessProfile: ctx._businessProfile ?? null,
    });
    res.json(inventory);
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
  const ws = workspaceId ? getWorkspace(workspaceId) : listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
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
    const cmsDelivery = await publishSchemaToCmsField({
      siteId: req.params.siteId,
      pageId,
      schema,
      publishAfter,
      token,
    });
    if (cmsDelivery) {
      if (cmsDelivery.status === 'blocked' || cmsDelivery.status === 'failed') {
        return res.status(422).json({ success: false, cmsDeliveryStatus: cmsDelivery, error: cmsDelivery.message });
      }
      const cmsWs = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
      const snapshotUpdated = updatePageSchemaInSnapshot(req.params.siteId, pageId, schema);
      if (snapshotUpdated) broadcastSchemaSnapshotUpdated(req.params.siteId, cmsWs?.id, 'published', pageId);
      if (cmsWs) {
        recordSchemaPublish(req.params.siteId, pageId, cmsWs.id || '', schema);
        addActivity(cmsWs.id, 'schema_published', 'Schema written to CMS field', cmsDelivery.message, { pageId });
        updatePageState(cmsWs.id, pageId, { status: 'live', source: 'schema', fields: ['schema'], updatedBy: 'admin' });
        const rawCmsPublishedPath = req.body.publishedPath || req.body.pageSlug || '';
        const cmsPublishedPath = rawCmsPublishedPath ? normalizePageUrl(rawCmsPublishedPath) : '';
        recordSeoChange(cmsWs.id, pageId, cmsPublishedPath, req.body.pageTitle || '', ['schema'], 'schema-cms-field');
      }
      return res.json({ success: true, published: !!publishAfter, cmsDeliveryStatus: cmsDelivery });
    }

    const result = await publishSchemaToPage(req.params.siteId, pageId, schema, token);
    if (result.delivery.status === 'manual-required') return res.json(result);
    if (!result.success) return res.status(500).json(result);

    // Optionally publish the site so changes go live
    let sitePublished = false;
    if (publishAfter) {
      const pubResult = await publishSite(req.params.siteId, token);
      sitePublished = pubResult.success;
      if (!pubResult.success) {
        log.error({ detail: pubResult.error }, 'Site publish failed');
      }
    }

    // Persist edited schema back to snapshot so it survives reload
    const snapshotUpdated = updatePageSchemaInSnapshot(req.params.siteId, pageId, schema);

    // Record version history for rollback support
    const pubWsForHistory = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    if (snapshotUpdated) broadcastSchemaSnapshotUpdated(req.params.siteId, pubWsForHistory?.id, 'published', pageId);
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
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-schema: programming error'); /* best-effort */ }
    }

    // Log to activity feed + track edit status
    const pubWs = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    const rawPublishedPath = req.body.publishedPath || req.body.pageSlug || '';
    const publishedPath = rawPublishedPath ? normalizePageUrl(rawPublishedPath) : '';
    if (pubWs) {
      addActivity(pubWs.id, 'schema_published', 'Schema published to Webflow', `Page ${pageId.slice(0, 8)}… — ${sitePublished ? 'site published' : 'saved as draft'}`, { pageId });
      updatePageState(pubWs.id, pageId, { status: 'live', source: 'schema', fields: ['schema'], updatedBy: 'admin' });
      recordSeoChange(pubWs.id, pageId, publishedPath, req.body.pageTitle || '', ['schema'], 'schema');
    }

    res.json({ ...result, success: true, published: result.published ?? true, sitePublished });

    // Record for outcome tracking (only when workspace is known).
    // Idempotency guard: skip if this page already has a tracked schema action in this workspace.
    // Prevents duplicate entries when the same page is re-published in quick succession (retries,
    // double-clicks). Intentional re-deployments with schema changes are tracked via external
    // detection when GSC metrics change rather than as new tracked_actions entries.
    try {
      if (!pubWs) throw new Error('no workspace');
      if (getActionByWorkspaceAndSource(pubWs.id, 'schema', pageId)) throw new Error('already tracked');
      const schemaAction = recordAction({ // recordAction-ok: pubWs guaranteed non-null by throw guard at line 206
        workspaceId: pubWs.id,
        actionType: 'schema_deployed',
        sourceType: 'schema',
        sourceId: pageId,
        pageUrl: publishedPath || null,
        targetKeyword: null,
        baselineSnapshot: {
          captured_at: new Date().toISOString(),
          rich_result_eligible: true,
          rich_result_appearing: false,
        },
        attribution: 'platform_executed',
      });
      if (publishedPath) void captureBaselineFromGsc(schemaAction.id, pubWs.id, publishedPath);
    } catch (err) {
      log.warn({ err, pageId }, 'Failed to record outcome action for schema deployment');
    }

    // Trigger background llms.txt regeneration after schema publish
    try {
      const llmsWs = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
      if (llmsWs) queueLlmsTxtRegeneration(llmsWs.id, 'schema_published');
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-schema: programming error'); /* non-critical — response already sent */ }
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
    const { ctx } = await buildSchemaContext(req.params.siteId);
    const ws = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    if (!ws) return res.status(404).json({ error: 'No workspace found for this site' });

    // Load architecture tree to avoid duplicate Webflow API + sitemap calls
    let architectureResult;
    try {
      architectureResult = await getCachedArchitecture(ws.id);
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'webflow-schema: POST /api/webflow/schema-plan/:siteId: programming error'); /* proceed without — plan will fall back to direct API calls */ }

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
router.get('/api/webflow/schema-plan/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const plan = getSchemaPlan(req.params.siteId);
  if (!plan) return res.json(null);
  res.json(toAdminSchemaView(plan));
});

// PUT: update page roles / canonical entities on the plan
router.put('/api/webflow/schema-plan/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const { pageRoles, canonicalEntities } = req.body;
  if (!pageRoles) return res.status(400).json({ error: 'pageRoles required' });
  const plan = updateSchemaPlanRoles(req.params.siteId, pageRoles, canonicalEntities);
  if (!plan) return res.status(404).json({ error: 'No plan found for this site' });
  res.json(plan);
});

// POST: send plan preview to client for review (in dedicated Schema tab, not Inbox)
router.post('/api/webflow/schema-plan/:siteId/send-to-client', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
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

    broadcastToWorkspace(ws.id, WS_EVENTS.SCHEMA_PLAN_SENT, { siteId: req.params.siteId });
    addActivity(ws.id, 'schema_plan_sent', 'Schema strategy sent to client for review', `${plan.pageRoles.length} pages`);
    res.json({ plan: updated || plan });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg, err }, 'Send schema plan to client error');
    res.status(500).json({ error: `Failed to send plan: ${msg}` });
  }
});

// POST: mark plan as active (approved or admin-confirmed)
router.post('/api/webflow/schema-plan/:siteId/activate', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  const plan = updateSchemaPlanStatus(req.params.siteId, 'active');
  if (!plan) return res.status(404).json({ error: 'No plan found' });
  res.json(plan);
});

// DELETE: retract (delete) the entire schema plan for a site
router.delete('/api/webflow/schema-plan/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
  // Read plan first to grab the approval batch ID before deleting
  const plan = getSchemaPlan(req.params.siteId);
  if (!plan) return res.status(404).json({ error: 'No plan found for this site' });

  deleteSchemaPlan(req.params.siteId);

  // Also clear the schema snapshot so the client dashboard doesn't show stale data
  const snapshotDeleted = deleteSchemaSnapshot(req.params.siteId);
  if (snapshotDeleted) broadcastSchemaSnapshotUpdated(req.params.siteId, plan.workspaceId, 'deleted');

  // Delete the associated approval batch (sent-to-client preview) if one exists
  if (plan.clientPreviewBatchId) {
    deleteBatch(plan.workspaceId, plan.clientPreviewBatchId);
  }

  const ws = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
  if (ws) {
    addActivity(ws.id, 'schema_plan_deleted', 'Schema site plan retracted', 'Plan deleted by admin');
  }
  res.json({ success: true });
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
    const ws = listWorkspaces().find(w => w.webflowSiteId === siteId);
    if (snapshotUpdated) broadcastSchemaSnapshotUpdated(siteId, ws?.id, 'retracted', pageId);
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
    const ws = listWorkspaces().find(w => w.webflowSiteId === req.params.siteId);
    if (snapshotUpdated) broadcastSchemaSnapshotUpdated(req.params.siteId, ws?.id, 'rolled_back', pageId);
    recordSchemaPublish(req.params.siteId, pageId, ws?.id || '', entry.schemaJson);

    // Activity log
    if (ws) {
      addActivity(ws.id, 'schema_published', 'Schema rolled back to previous version',
        `Page ${pageId.slice(0, 8)}… — restored from ${new Date(entry.publishedAt).toLocaleDateString()}`,
        { pageId, historyId });
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

  const newStatus = action === 'approve' ? 'client_approved' : 'client_changes_requested';
  const plan = updateSchemaPlanStatus(ws.webflowSiteId, newStatus as SchemaSitePlan['status']);
  if (!plan) return res.status(404).json({ error: 'No plan found' });

  const label = action === 'approve' ? 'approved' : 'requested changes on';
  addActivity(ws.id, 'changes_requested', `Client ${label} schema plan`, note || undefined);
  broadcastToWorkspace(ws.id, WS_EVENTS.SCHEMA_PLAN_SENT, {
    siteId: ws.webflowSiteId,
    action: 'schema_plan_feedback',
    status: newStatus,
  });
  res.json(toClientSchemaView(plan));
});

// ── Pending Schemas (D7: pre-generated schema skeletons) ──

router.get('/api/pending-schemas/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
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

// Validate a single page schema against Google Rich Results rules
router.post('/api/webflow/schema-validate/:siteId', requireWorkspaceSiteAccessFromQuery(), validate(schemaValidateBody), (req, res) => {
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
router.get('/api/webflow/schema-validations/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
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
router.delete('/api/webflow/schema-validation/:siteId', requireWorkspaceSiteAccessFromQuery(), (req, res) => {
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
