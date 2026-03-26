/**
 * Persistent storage for schema generation results.
 * Saves per-site schema snapshots to SQLite.
 */
import type { SchemaPageSuggestion } from './schema-suggester.js';
import type { SchemaSitePlan, CanonicalEntity, PageRoleAssignment } from '../shared/types/schema-plan.ts';
import db from './db/index.js';
import { createLogger } from './logger.js';

const log = createLogger('schema-store');

export interface SchemaSnapshot {
  id: string;
  siteId: string;
  workspaceId: string;
  createdAt: string;
  results: SchemaPageSuggestion[];
  pageCount: number;
}

// ── Prepared statements (lazy) ──

let _upsert: ReturnType<typeof db.prepare> | null = null;
function upsertStmt() {
  if (!_upsert) {
    _upsert = db.prepare(`
      INSERT OR REPLACE INTO schema_snapshots
        (id, site_id, workspace_id, created_at, results, page_count)
      VALUES (@id, @site_id, @workspace_id, @created_at, @results, @page_count)
    `);
  }
  return _upsert;
}

let _getBySite: ReturnType<typeof db.prepare> | null = null;
function getBySiteStmt() {
  if (!_getBySite) {
    _getBySite = db.prepare(`SELECT * FROM schema_snapshots WHERE site_id = ? ORDER BY created_at DESC LIMIT 1`);
  }
  return _getBySite;
}

interface SchemaRow {
  id: string;
  site_id: string;
  workspace_id: string;
  created_at: string;
  results: string;
  page_count: number;
}

function rowToSnapshot(row: SchemaRow): SchemaSnapshot {
  return {
    id: row.id,
    siteId: row.site_id,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
    results: JSON.parse(row.results),
    pageCount: row.page_count,
  };
}

export function saveSchemaSnapshot(siteId: string, workspaceId: string, results: SchemaPageSuggestion[]): SchemaSnapshot {
  const snapshot: SchemaSnapshot = {
    id: `schema-${siteId}-${Date.now()}`,
    siteId,
    workspaceId,
    createdAt: new Date().toISOString(),
    results,
    pageCount: results.length,
  };
  upsertStmt().run({
    id: snapshot.id,
    site_id: siteId,
    workspace_id: workspaceId,
    created_at: snapshot.createdAt,
    results: JSON.stringify(results),
    page_count: results.length,
  });
  log.info(`Saved ${results.length} page schemas for site ${siteId}`);
  return snapshot;
}

export function getSchemaSnapshot(siteId: string): SchemaSnapshot | null {
  const row = getBySiteStmt().get(siteId) as SchemaRow | undefined;
  return row ? rowToSnapshot(row) : null;
}

/**
 * Update a single page's schema within an existing snapshot.
 * Used when user edits a schema and publishes — persists the edit so it
 * appears on reload and is used by auto-seed template extraction.
 */
export function updatePageSchemaInSnapshot(
  siteId: string,
  pageId: string,
  updatedSchema: Record<string, unknown>,
): boolean {
  const snapshot = getSchemaSnapshot(siteId);
  if (!snapshot) return false;

  const pageIdx = snapshot.results.findIndex(r => r.pageId === pageId);
  if (pageIdx < 0) return false;

  // Update the first suggested schema's template
  if (snapshot.results[pageIdx].suggestedSchemas?.[0]) {
    snapshot.results[pageIdx].suggestedSchemas[0].template = updatedSchema;
  }

  // Re-save the full snapshot with updated results
  const row = getBySiteStmt().get(siteId) as SchemaRow | undefined;
  if (!row) return false;

  upsertStmt().run({
    id: row.id,
    site_id: siteId,
    workspace_id: row.workspace_id,
    created_at: row.created_at,
    results: JSON.stringify(snapshot.results),
    page_count: snapshot.results.length,
  });
  log.info(`Updated schema for page ${pageId} in snapshot for site ${siteId}`);
  return true;
}

// ── Site template: canonical Organization + WebSite nodes ──

export interface SchemaSiteTemplate {
  siteId: string;
  workspaceId: string;
  organizationNode: Record<string, unknown>;
  websiteNode: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface TemplateRow {
  site_id: string;
  workspace_id: string;
  organization_node: string;
  website_node: string;
  created_at: string;
  updated_at: string;
}

let _upsertTemplate: ReturnType<typeof db.prepare> | null = null;
function upsertTemplateStmt() {
  if (!_upsertTemplate) {
    _upsertTemplate = db.prepare(`
      INSERT OR REPLACE INTO schema_site_templates
        (site_id, workspace_id, organization_node, website_node, created_at, updated_at)
      VALUES (@site_id, @workspace_id, @organization_node, @website_node, @created_at, @updated_at)
    `);
  }
  return _upsertTemplate;
}

let _getTemplate: ReturnType<typeof db.prepare> | null = null;
function getTemplateStmt() {
  if (!_getTemplate) {
    _getTemplate = db.prepare(`SELECT * FROM schema_site_templates WHERE site_id = ?`);
  }
  return _getTemplate;
}

export function saveSiteTemplate(
  siteId: string,
  workspaceId: string,
  organizationNode: Record<string, unknown>,
  websiteNode: Record<string, unknown>,
): SchemaSiteTemplate {
  const now = new Date().toISOString();
  const existing = getTemplateStmt().get(siteId) as TemplateRow | undefined;
  upsertTemplateStmt().run({
    site_id: siteId,
    workspace_id: workspaceId,
    organization_node: JSON.stringify(organizationNode),
    website_node: JSON.stringify(websiteNode),
    created_at: existing?.created_at || now,
    updated_at: now,
  });
  log.info(`Saved site template for ${siteId}`);
  return {
    siteId,
    workspaceId,
    organizationNode,
    websiteNode,
    createdAt: existing?.created_at || now,
    updatedAt: now,
  };
}

export function getSiteTemplate(siteId: string): SchemaSiteTemplate | null {
  const row = getTemplateStmt().get(siteId) as TemplateRow | undefined;
  if (!row) return null;
  return {
    siteId: row.site_id,
    workspaceId: row.workspace_id,
    organizationNode: JSON.parse(row.organization_node),
    websiteNode: JSON.parse(row.website_node),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get site template, auto-seeding from the latest homepage schema snapshot if none saved.
 * This allows previously-generated schemas to populate the template without regeneration.
 */
export function getOrSeedSiteTemplate(siteId: string, workspaceId?: string): SchemaSiteTemplate | null {
  const existing = getSiteTemplate(siteId);
  if (existing) return existing;

  // Try to extract from latest schema snapshot
  const snapshot = getSchemaSnapshot(siteId);
  if (!snapshot || !snapshot.results.length) return null;

  // Find homepage result (slug is empty, 'index', 'home', or '/')
  const homepage = snapshot.results.find(r =>
    !r.slug || r.slug === '/' || r.slug === 'index' || r.slug === 'home'
  );
  if (!homepage?.suggestedSchemas?.[0]?.template) return null;

  // Parse the schema and extract Organization + WebSite nodes
  try {
    const schemaObj = typeof homepage.suggestedSchemas[0].template === 'string'
      ? JSON.parse(homepage.suggestedSchemas[0].template as unknown as string)
      : homepage.suggestedSchemas[0].template;
    const graph = schemaObj?.['@graph'] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(graph)) return null;

    const orgNode = graph.find(n => n['@type'] === 'Organization');
    const wsNode = graph.find(n => n['@type'] === 'WebSite');
    if (!orgNode) return null;

    const websiteNode = wsNode || {
      '@type': 'WebSite',
      '@id': `${(orgNode['url'] as string) || ''}/#website`,
      'url': orgNode['url'] || '',
      'name': orgNode['name'] || '',
      'publisher': { '@id': `${(orgNode['url'] as string) || ''}/#organization` },
    };

    const wsId = workspaceId || snapshot.workspaceId;
    log.info(`Auto-seeded site template from existing homepage snapshot for site ${siteId}`);
    return saveSiteTemplate(siteId, wsId, orgNode, websiteNode as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * Update specific fields on the site template (e.g. logo URL).
 * Merges the provided patches into the existing Organization and WebSite nodes.
 */
// ── Schema Site Plan storage ──

interface PlanRow {
  id: string;
  site_id: string;
  workspace_id: string;
  site_url: string;
  canonical_entities: string;
  page_roles: string;
  status: string;
  client_preview_batch_id: string | null;
  generated_at: string;
  updated_at: string;
}

let _planUpsert: ReturnType<typeof db.prepare> | null = null;
function planUpsertStmt() {
  if (!_planUpsert) {
    _planUpsert = db.prepare(`
      INSERT OR REPLACE INTO schema_site_plans
        (id, site_id, workspace_id, site_url, canonical_entities, page_roles, status, client_preview_batch_id, generated_at, updated_at)
      VALUES (@id, @site_id, @workspace_id, @site_url, @canonical_entities, @page_roles, @status, @client_preview_batch_id, @generated_at, @updated_at)
    `);
  }
  return _planUpsert;
}

let _planGetBySite: ReturnType<typeof db.prepare> | null = null;
function planGetBySiteStmt() {
  if (!_planGetBySite) {
    _planGetBySite = db.prepare('SELECT * FROM schema_site_plans WHERE site_id = ? ORDER BY updated_at DESC LIMIT 1');
  }
  return _planGetBySite;
}

function rowToPlan(row: PlanRow): SchemaSitePlan {
  return {
    id: row.id,
    siteId: row.site_id,
    workspaceId: row.workspace_id,
    siteUrl: row.site_url,
    canonicalEntities: JSON.parse(row.canonical_entities) as CanonicalEntity[],
    pageRoles: JSON.parse(row.page_roles) as PageRoleAssignment[],
    status: row.status as SchemaSitePlan['status'],
    clientPreviewBatchId: row.client_preview_batch_id || undefined,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
  };
}

export function saveSchemaPlan(plan: SchemaSitePlan): SchemaSitePlan {
  planUpsertStmt().run({
    id: plan.id,
    site_id: plan.siteId,
    workspace_id: plan.workspaceId,
    site_url: plan.siteUrl,
    canonical_entities: JSON.stringify(plan.canonicalEntities),
    page_roles: JSON.stringify(plan.pageRoles),
    status: plan.status,
    client_preview_batch_id: plan.clientPreviewBatchId || null,
    generated_at: plan.generatedAt,
    updated_at: plan.updatedAt,
  });
  log.info(`Saved schema plan ${plan.id} for site ${plan.siteId} (${plan.pageRoles.length} pages, ${plan.canonicalEntities.length} entities)`);
  return plan;
}

export function getSchemaPlan(siteId: string): SchemaSitePlan | null {
  const row = planGetBySiteStmt().get(siteId) as PlanRow | undefined;
  if (!row) return null;
  return rowToPlan(row);
}

export function updateSchemaPlanStatus(
  siteId: string,
  status: SchemaSitePlan['status'],
  clientPreviewBatchId?: string,
): SchemaSitePlan | null {
  const plan = getSchemaPlan(siteId);
  if (!plan) return null;
  plan.status = status;
  if (clientPreviewBatchId) plan.clientPreviewBatchId = clientPreviewBatchId;
  plan.updatedAt = new Date().toISOString();
  return saveSchemaPlan(plan);
}

let _planDeleteBySite: ReturnType<typeof db.prepare> | null = null;
function planDeleteBySiteStmt() {
  if (!_planDeleteBySite) {
    _planDeleteBySite = db.prepare('DELETE FROM schema_site_plans WHERE site_id = ?');
  }
  return _planDeleteBySite;
}

export function deleteSchemaPlan(siteId: string): boolean {
  const result = planDeleteBySiteStmt().run(siteId);
  log.info(`Deleted schema plan for site ${siteId} (${result.changes} rows)`);
  return result.changes > 0;
}

let _snapshotDeleteBySite: ReturnType<typeof db.prepare> | null = null;
function snapshotDeleteBySiteStmt() {
  if (!_snapshotDeleteBySite) {
    _snapshotDeleteBySite = db.prepare('DELETE FROM schema_snapshots WHERE site_id = ?');
  }
  return _snapshotDeleteBySite;
}

export function deleteSchemaSnapshot(siteId: string): boolean {
  const result = snapshotDeleteBySiteStmt().run(siteId);
  log.info(`Deleted schema snapshot for site ${siteId} (${result.changes} rows)`);
  return result.changes > 0;
}

export function removePageFromSnapshot(siteId: string, pageId: string): boolean {
  const snapshot = getSchemaSnapshot(siteId);
  if (!snapshot) return false;

  const filtered = snapshot.results.filter(r => r.pageId !== pageId);
  if (filtered.length === snapshot.results.length) return false;

  const row = getBySiteStmt().get(siteId) as SchemaRow | undefined;
  if (!row) return false;

  upsertStmt().run({
    id: row.id,
    site_id: siteId,
    workspace_id: row.workspace_id,
    created_at: row.created_at,
    results: JSON.stringify(filtered),
    page_count: filtered.length,
  });
  log.info(`Removed page ${pageId} from schema snapshot for site ${siteId}`);
  return true;
}

export function updateSchemaPlanRoles(
  siteId: string,
  pageRoles: PageRoleAssignment[],
  canonicalEntities?: CanonicalEntity[],
): SchemaSitePlan | null {
  const plan = getSchemaPlan(siteId);
  if (!plan) return null;
  plan.pageRoles = pageRoles;
  if (canonicalEntities) plan.canonicalEntities = canonicalEntities;
  plan.updatedAt = new Date().toISOString();
  return saveSchemaPlan(plan);
}

// ── Schema Page Types persistence ──

let _pageTypeUpsert: ReturnType<typeof db.prepare> | null = null;
function pageTypeUpsertStmt() {
  if (!_pageTypeUpsert) {
    _pageTypeUpsert = db.prepare(`
      INSERT OR REPLACE INTO schema_page_types (site_id, page_id, page_type, updated_at)
      VALUES (@site_id, @page_id, @page_type, @updated_at)
    `);
  }
  return _pageTypeUpsert;
}

let _pageTypeGetBySite: ReturnType<typeof db.prepare> | null = null;
function pageTypeGetBySiteStmt() {
  if (!_pageTypeGetBySite) {
    _pageTypeGetBySite = db.prepare('SELECT page_id, page_type FROM schema_page_types WHERE site_id = ?');
  }
  return _pageTypeGetBySite;
}

/** Persist a single page type selection for a site. */
export function savePageType(siteId: string, pageId: string, pageType: string): void {
  pageTypeUpsertStmt().run({
    site_id: siteId,
    page_id: pageId,
    page_type: pageType,
    updated_at: new Date().toISOString(),
  });
}

/** Get all persisted page types for a site as a pageId → pageType map. */
export function getPageTypes(siteId: string): Record<string, string> {
  const rows = pageTypeGetBySiteStmt().all(siteId) as Array<{ page_id: string; page_type: string }>;
  return Object.fromEntries(rows.map(r => [r.page_id, r.page_type]));
}

/** Bulk-upsert page types from a Record<pageId, pageType> map. */
export function savePageTypes(siteId: string, updates: Record<string, string>): void {
  const now = new Date().toISOString();
  const upsert = pageTypeUpsertStmt();
  const entries = Object.entries(updates);
  if (entries.length === 0) return;
  const runMany = db.transaction(() => {
    for (const [pageId, pageType] of entries) {
      upsert.run({ site_id: siteId, page_id: pageId, page_type: pageType, updated_at: now });
    }
  });
  runMany();
}

// ── Schema Publish History (version tracking) ──

export interface SchemaPublishEntry {
  id: string;
  siteId: string;
  pageId: string;
  workspaceId: string;
  schemaJson: Record<string, unknown>;
  publishedAt: string;
}

interface PublishHistoryRow {
  id: string;
  site_id: string;
  page_id: string;
  workspace_id: string;
  schema_json: string;
  published_at: string;
}

let _historyInsert: ReturnType<typeof db.prepare> | null = null;
function historyInsertStmt() {
  if (!_historyInsert) {
    _historyInsert = db.prepare(`
      INSERT INTO schema_publish_history (id, site_id, page_id, workspace_id, schema_json, published_at)
      VALUES (@id, @site_id, @page_id, @workspace_id, @schema_json, @published_at)
    `);
  }
  return _historyInsert;
}

let _historyByPage: ReturnType<typeof db.prepare> | null = null;
function historyByPageStmt() {
  if (!_historyByPage) {
    _historyByPage = db.prepare(`
      SELECT * FROM schema_publish_history
      WHERE site_id = ? AND page_id = ?
      ORDER BY published_at DESC
      LIMIT ?
    `);
  }
  return _historyByPage;
}

let _historyById: ReturnType<typeof db.prepare> | null = null;
function historyByIdStmt() {
  if (!_historyById) {
    _historyById = db.prepare('SELECT * FROM schema_publish_history WHERE id = ?');
  }
  return _historyById;
}

let _latestPublishDates: ReturnType<typeof db.prepare> | null = null;
function latestPublishDatesStmt() {
  if (!_latestPublishDates) {
    _latestPublishDates = db.prepare(`
      SELECT page_id, MAX(published_at) as published_at
      FROM schema_publish_history
      WHERE site_id = ?
      GROUP BY page_id
    `);
  }
  return _latestPublishDates;
}

function rowToPublishEntry(row: PublishHistoryRow): SchemaPublishEntry {
  return {
    id: row.id,
    siteId: row.site_id,
    pageId: row.page_id,
    workspaceId: row.workspace_id,
    schemaJson: JSON.parse(row.schema_json),
    publishedAt: row.published_at,
  };
}

/** Record a schema publish event (creates a version history entry). */
export function recordSchemaPublish(
  siteId: string, pageId: string, workspaceId: string,
  schema: Record<string, unknown>,
): SchemaPublishEntry {
  const entry: SchemaPublishEntry = {
    id: `sph-${siteId}-${pageId}-${Date.now()}`,
    siteId,
    pageId,
    workspaceId,
    schemaJson: schema,
    publishedAt: new Date().toISOString(),
  };
  historyInsertStmt().run({
    id: entry.id,
    site_id: siteId,
    page_id: pageId,
    workspace_id: workspaceId,
    schema_json: JSON.stringify(schema),
    published_at: entry.publishedAt,
  });
  log.info(`Recorded schema publish for page ${pageId} on site ${siteId}`);
  return entry;
}

/** Get version history for a specific page (newest first). */
export function getSchemaPublishHistory(siteId: string, pageId: string, limit = 10): SchemaPublishEntry[] {
  const rows = historyByPageStmt().all(siteId, pageId, limit) as PublishHistoryRow[];
  return rows.map(rowToPublishEntry);
}

/** Get a specific publish entry by ID. */
export function getSchemaPublishEntry(id: string): SchemaPublishEntry | null {
  const row = historyByIdStmt().get(id) as PublishHistoryRow | undefined;
  return row ? rowToPublishEntry(row) : null;
}

/** Get latest publish date per page for a site (for stale schema detection). */
export function getPublishDatesForSite(siteId: string): Record<string, string> {
  const rows = latestPublishDatesStmt().all(siteId) as Array<{ page_id: string; published_at: string }>;
  return Object.fromEntries(rows.map(r => [r.page_id, r.published_at]));
}

export function patchSiteTemplate(
  siteId: string,
  orgPatch?: Record<string, unknown>,
  wsPatch?: Record<string, unknown>,
): SchemaSiteTemplate | null {
  const existing = getSiteTemplate(siteId);
  if (!existing) return null;

  const updatedOrg = orgPatch
    ? { ...existing.organizationNode, ...orgPatch }
    : existing.organizationNode;
  const updatedWs = wsPatch
    ? { ...existing.websiteNode, ...wsPatch }
    : existing.websiteNode;

  return saveSiteTemplate(siteId, existing.workspaceId, updatedOrg, updatedWs);
}
