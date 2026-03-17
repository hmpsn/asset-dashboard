/**
 * Persistent storage for schema generation results.
 * Saves per-site schema snapshots to SQLite.
 */
import type { SchemaPageSuggestion } from './schema-suggester.js';
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
  if (!homepage?.suggestedSchemas?.[0]?.schema) return null;

  // Parse the schema and extract Organization + WebSite nodes
  try {
    const schemaObj = typeof homepage.suggestedSchemas[0].schema === 'string'
      ? JSON.parse(homepage.suggestedSchemas[0].schema)
      : homepage.suggestedSchemas[0].schema;
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
