/**
 * Persistent storage for redirect scan results.
 * Saves per-site redirect snapshots to SQLite.
 */
import type { RedirectScanResult } from './redirect-scanner.js';
import db from './db/index.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';

const log = createLogger('redirect-store');

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
    // C1 (D3): write workspace_id forward on every snapshot. Migration 167 backfilled it
    // + advertises an FK ON DELETE CASCADE, but the writer only set site_id, so every
    // post-167 row landed with workspace_id NULL and the cascade never fired.
    _upsert = db.prepare(`
      INSERT OR REPLACE INTO redirect_snapshots
        (id, site_id, workspace_id, created_at, result)
      VALUES (@id, @site_id, @workspace_id, @created_at, @result)
    `);
  }
  return _upsert;
}

// C1 (D3): resolve site_id -> workspace_id ONLY on an exact 1:1 (COUNT=1) match; a
// zero-match or ambiguous >1-match resolves to NULL, never a guessed workspace —
// mirrors migration 167's quarantine logic (webflow_site_id has no UNIQUE constraint).
let _resolveWorkspaceIdBySiteId: ReturnType<typeof db.prepare> | null = null;
function resolveWorkspaceIdForSnapshot(siteId: string): string | null {
  if (!siteId) return null;
  if (!_resolveWorkspaceIdBySiteId) {
    _resolveWorkspaceIdBySiteId = db.prepare(
      `SELECT COUNT(*) AS n, MIN(id) AS id FROM workspaces WHERE webflow_site_id = ?`,
    );
  }
  const row = _resolveWorkspaceIdBySiteId.get(siteId) as { n: number; id: string | null } | undefined;
  return row && row.n === 1 ? row.id : null;
}

let _getBySite: ReturnType<typeof db.prepare> | null = null;
function getBySiteStmt() {
  if (!_getBySite) {
    _getBySite = db.prepare(`SELECT * FROM redirect_snapshots WHERE site_id = ? ORDER BY created_at DESC LIMIT 1`);
  }
  return _getBySite;
}

interface RedirectRow {
  id: string;
  site_id: string;
  created_at: string;
  result: string;
}

const EMPTY_REDIRECT_RESULT: RedirectScanResult = {
  chains: [],
  pageStatuses: [],
  summary: { totalPages: 0, healthy: 0, redirecting: 0, notFound: 0, errors: 0, chainsDetected: 0, longestChain: 0 },
  scannedAt: new Date(0).toISOString(),
};

function rowToSnapshot(row: RedirectRow): RedirectSnapshot {
  return {
    id: row.id,
    siteId: row.site_id,
    createdAt: row.created_at,
    result: parseJsonFallback(row.result, EMPTY_REDIRECT_RESULT),
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
    // C1 (D3): thread the 1:1-resolved workspace_id so the FK CASCADE actually fires.
    workspace_id: resolveWorkspaceIdForSnapshot(siteId),
    created_at: snapshot.createdAt,
    result: JSON.stringify(result),
  });
  log.info(`Saved redirect scan for site ${siteId} (${result.summary.totalPages} pages)`);
  return snapshot;
}

export function getRedirectSnapshot(siteId: string): RedirectSnapshot | null {
  const row = getBySiteStmt().get(siteId) as RedirectRow | undefined;
  return row ? rowToSnapshot(row) : null;
}
