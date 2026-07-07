import db from './db/index.js';
import { parseJsonSafe } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import { z } from './middleware/validate.js';
import type { AdminMoneyFrame } from '../shared/types/outcome-tracking.js';

const CACHE_KEY = 'admin-money-frame:v1';
const TTL_SECONDS = 30 * 24 * 60 * 60;

const finiteMoneySchema = z.number().refine(Number.isFinite, 'Expected a finite number');

const adminMoneyFrameSchema: z.ZodType<AdminMoneyFrame> = z.object({
  valueAtStake: finiteMoneySchema,
  recoveredSoFar: finiteMoneySchema,
  provenance: z.enum(['estimate_ga4', 'measured_action', 'actual_reconciled']),
  precomputedAt: z.string().min(1),
});

interface CacheRow {
  data: string;
}

const stmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT INTO intelligence_sub_cache (workspace_id, cache_key, ttl_seconds, cached_at, data)
    VALUES (@workspace_id, @cache_key, @ttl_seconds, @cached_at, @data)
    ON CONFLICT(workspace_id, cache_key) DO UPDATE SET
      data = excluded.data,
      ttl_seconds = excluded.ttl_seconds,
      cached_at = excluded.cached_at,
      invalidated_at = NULL
  `),
  get: db.prepare(`
    SELECT data
    FROM intelligence_sub_cache
    WHERE workspace_id = ? AND cache_key = ? AND invalidated_at IS NULL
  `),
  clear: db.prepare(`
    DELETE FROM intelligence_sub_cache
    WHERE workspace_id = ? AND cache_key = ?
  `),
}));

export function saveAdminMoneyFrame(workspaceId: string, frame: AdminMoneyFrame): void {
  stmts().upsert.run({
    workspace_id: workspaceId,
    cache_key: CACHE_KEY,
    ttl_seconds: TTL_SECONDS,
    cached_at: frame.precomputedAt,
    data: JSON.stringify(frame),
  });
}

export function loadAdminMoneyFrame(workspaceId: string): AdminMoneyFrame | null {
  const row = stmts().get.get(workspaceId, CACHE_KEY) as CacheRow | undefined;
  return parseJsonSafe(row?.data, adminMoneyFrameSchema, null, {
    workspaceId,
    table: 'intelligence_sub_cache',
    field: CACHE_KEY,
  });
}

export function clearAdminMoneyFrame(workspaceId: string): void {
  stmts().clear.run(workspaceId, CACHE_KEY);
}
