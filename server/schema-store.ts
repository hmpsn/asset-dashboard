/**
 * Persistent storage for schema generation results.
 * Saves per-site schema snapshots to SQLite.
 */
import type { SchemaPageSuggestion } from './schema-suggester.js';
import db from './db/index.js';

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
    _getBySite = db.prepare(`SELECT * FROM schema_snapshots WHERE site_id = ?`);
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
  console.log(`[schema-store] Saved ${results.length} page schemas for site ${siteId}`);
  return snapshot;
}

export function getSchemaSnapshot(siteId: string): SchemaSnapshot | null {
  const row = getBySiteStmt().get(siteId) as SchemaRow | undefined;
  return row ? rowToSnapshot(row) : null;
}
