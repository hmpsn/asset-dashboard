/**
 * page_elements table CRUD. Per audit §2.5 (page_* migration conventions):
 * - createStmtCache for lazy prepared statements
 * - parseJsonSafe at the read boundary (with EMPTY_CATALOG fallback)
 * - workspace_id always in WHERE clause
 * - ISO 8601 timestamps as TEXT
 */
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe } from './db/json-validation.js';
import { pageElementCatalogSchema, EMPTY_CATALOG } from './schemas/page-elements-schema.js';
import type { PageElementCatalog } from '../shared/types/page-elements.js';
import { createLogger } from './logger.js';

const log = createLogger('page-elements-store');

interface PageElementsRow {
  workspace_id: string;
  page_path: string;
  catalog_json: string;
  source_published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageElementsRecord {
  workspaceId: string;
  pagePath: string;
  catalog: PageElementCatalog;
  sourcePublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const stmts = createStmtCache(() => ({
  get: db.prepare<[workspaceId: string, pagePath: string]>(
    'SELECT * FROM page_elements WHERE workspace_id = ? AND page_path = ?',
  ),
  upsert: db.prepare(`
    INSERT INTO page_elements (workspace_id, page_path, catalog_json, source_published_at, created_at, updated_at)
    VALUES (@workspace_id, @page_path, @catalog_json, @source_published_at, @created_at, @updated_at)
    ON CONFLICT(workspace_id, page_path) DO UPDATE SET
      catalog_json = excluded.catalog_json,
      source_published_at = excluded.source_published_at,
      updated_at = excluded.updated_at
  `),
  deleteOne: db.prepare<[workspaceId: string, pagePath: string]>(
    'DELETE FROM page_elements WHERE workspace_id = ? AND page_path = ?',
  ),
  deleteAll: db.prepare<[workspaceId: string]>(
    'DELETE FROM page_elements WHERE workspace_id = ?',
  ),
}));

function rowToRecord(row: PageElementsRow): PageElementsRecord {
  return {
    workspaceId: row.workspace_id,
    pagePath: row.page_path,
    // parseJsonSafe signature: (raw, schema, fallback, context?) — returns T | F.
    // EMPTY_CATALOG is the fallback so the function never returns null;
    // no `?? EMPTY_CATALOG` needed at the call site.
    catalog: parseJsonSafe(
      row.catalog_json,
      pageElementCatalogSchema,
      EMPTY_CATALOG,
      { workspaceId: row.workspace_id, field: 'catalog_json', table: 'page_elements' },
    ),
    sourcePublishedAt: row.source_published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getPageElements(workspaceId: string, pagePath: string): PageElementsRecord | null {
  const row = stmts().get.get(workspaceId, pagePath) as PageElementsRow | undefined;
  if (!row) return null;
  return rowToRecord(row);
}

export function upsertPageElements(
  workspaceId: string,
  pagePath: string,
  catalog: PageElementCatalog,
): void {
  const now = new Date().toISOString();
  try {
    stmts().upsert.run({
      workspace_id: workspaceId,
      page_path: pagePath,
      catalog_json: JSON.stringify(catalog),
      source_published_at: catalog.sourcePublishedAt,
      created_at: now,
      updated_at: now,
    });
  } catch (err) { /* catch-ok: log and re-throw — caller may roll back */
    log.error({ err, workspaceId, pagePath }, 'page-elements upsert failed');
    throw err;
  }
}

export function deletePageElements(workspaceId: string, pagePath: string): void {
  stmts().deleteOne.run(workspaceId, pagePath);
}

export function deleteAllPageElementsForWorkspace(workspaceId: string): void {
  stmts().deleteAll.run(workspaceId);
}
