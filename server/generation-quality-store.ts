/**
 * generation-quality-store — CRUD for the generation_quality table (F1 #7a).
 *
 * Durably persists the keyword-strategy generation-quality telemetry that the
 * generation pipeline computes on every run (poolSize, aiReturnedCount,
 * suppressedCount, backfilledCount, floorHit). Before F1 the record was log-only;
 * now `recordGenerationQuality` writes ONE row per run so quality can be queried and
 * trended.
 *
 * Append-only history: a workspace re-generates many times and each run is a distinct
 * observation, so there is no UNIQUE on workspace_id. Reads use the
 * (workspace_id, created_at DESC) index.
 *
 * DB patterns: lazy prepared statements via createStmtCache/stmts(), rowToX mapper at
 * the read boundary, INTEGER 0/1 <-> boolean for floor_hit, workspace_id scoping on
 * every statement. The table is internal-only — never serialized on a public route.
 */
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type { GenerationQuality, StoredGenerationQuality } from '../shared/types/generation-quality.js';

// ── Row <-> Model mapping ──

interface GenerationQualityRow {
  id: number;
  workspace_id: string;
  pool_size: number;
  ai_returned_count: number;
  suppressed_count: number;
  backfilled_count: number;
  floor_hit: number; // 0/1
  created_at: string;
}

function rowToStoredGenerationQuality(row: GenerationQualityRow): StoredGenerationQuality {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    poolSize: row.pool_size,
    aiReturnedCount: row.ai_returned_count,
    suppressedCount: row.suppressed_count,
    backfilledCount: row.backfilled_count,
    floorHit: row.floor_hit === 1,
    createdAt: row.created_at,
  };
}

// ── Lazy prepared statements ──

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO generation_quality (
      workspace_id, pool_size, ai_returned_count, suppressed_count,
      backfilled_count, floor_hit, created_at
    ) VALUES (
      @workspace_id, @pool_size, @ai_returned_count, @suppressed_count,
      @backfilled_count, @floor_hit, @created_at
    )
  `),
  listByWs: db.prepare<[workspaceId: string]>(
    'SELECT * FROM generation_quality WHERE workspace_id = ? ORDER BY created_at DESC, id DESC',
  ),
  latestByWs: db.prepare<[workspaceId: string]>(
    'SELECT * FROM generation_quality WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
  ),
}));

// ── Public API ──

/**
 * Persist one generation-quality row for a run. Returns the stored record.
 * `createdAt` defaults to now (ISO) — pass an explicit value only for backfills/tests.
 */
export function recordGenerationQuality(
  quality: GenerationQuality,
  createdAt: string = new Date().toISOString(),
): StoredGenerationQuality {
  const info = stmts().insert.run({
    workspace_id: quality.workspaceId,
    pool_size: quality.poolSize,
    ai_returned_count: quality.aiReturnedCount,
    suppressed_count: quality.suppressedCount,
    backfilled_count: quality.backfilledCount,
    floor_hit: quality.floorHit ? 1 : 0,
    created_at: createdAt,
  });
  return {
    id: Number(info.lastInsertRowid),
    ...quality,
    createdAt,
  };
}

/** All generation-quality rows for a workspace, newest first. */
export function listGenerationQuality(workspaceId: string): StoredGenerationQuality[] {
  const rows = stmts().listByWs.all(workspaceId) as GenerationQualityRow[];
  return rows.map(rowToStoredGenerationQuality);
}

/** The most recent generation-quality row for a workspace, or null if none. */
export function getLatestGenerationQuality(workspaceId: string): StoredGenerationQuality | null {
  const row = stmts().latestByWs.get(workspaceId) as GenerationQualityRow | undefined;
  return row ? rowToStoredGenerationQuality(row) : null;
}
