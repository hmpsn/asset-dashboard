/**
 * Persistent storage for redirect scan results.
 * Saves per-site redirect snapshots to SQLite.
 */
import type { RedirectScanResult } from './redirect-scanner.js';
import db from './db/index.js';

export interface RedirectSnapshot {
  id: string;
  siteId: string;
  createdAt: string;
  result: RedirectScanResult;
}

// ── Prepared statements (lazy) ──

let _upsert: ReturnType<typeof db.prepare> | null = null;
function upsertStmt() {
  if (!_upsert) {
    _upsert = db.prepare(`
      INSERT OR REPLACE INTO redirect_snapshots
        (id, site_id, created_at, result)
      VALUES (@id, @site_id, @created_at, @result)
    `);
  }
  return _upsert;
}

let _getBySite: ReturnType<typeof db.prepare> | null = null;
function getBySiteStmt() {
  if (!_getBySite) {
    _getBySite = db.prepare(`SELECT * FROM redirect_snapshots WHERE site_id = ?`);
  }
  return _getBySite;
}

interface RedirectRow {
  id: string;
  site_id: string;
  created_at: string;
  result: string;
}

function rowToSnapshot(row: RedirectRow): RedirectSnapshot {
  return {
    id: row.id,
    siteId: row.site_id,
    createdAt: row.created_at,
    result: JSON.parse(row.result),
  };
}

export function saveRedirectSnapshot(siteId: string, result: RedirectScanResult): RedirectSnapshot {
  const snapshot: RedirectSnapshot = {
    id: `redirect-${siteId}-${Date.now()}`,
    siteId,
    createdAt: new Date().toISOString(),
    result,
  };
  upsertStmt().run({
    id: snapshot.id,
    site_id: siteId,
    created_at: snapshot.createdAt,
    result: JSON.stringify(result),
  });
  console.log(`[redirect-store] Saved redirect scan for site ${siteId} (${result.summary.totalPages} pages)`);
  return snapshot;
}

export function getRedirectSnapshot(siteId: string): RedirectSnapshot | null {
  const row = getBySiteStmt().get(siteId) as RedirectRow | undefined;
  return row ? rowToSnapshot(row) : null;
}
