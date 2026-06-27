import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { DecayAnalysis } from '../shared/types/content-decay.js';

interface DecayRow {
  workspace_id: string;
  analyzed_at: string;
  total_pages: number;
  decaying_pages: string;
  summary: string;
}

const stmts = createStmtCache(() => ({
  select: db.prepare(
    `SELECT * FROM decay_analyses WHERE workspace_id = ?`,
  ),
}));

export function loadDecayAnalysis(workspaceId: string): DecayAnalysis | null {
  const row = stmts().select.get(workspaceId) as DecayRow | undefined;
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    analyzedAt: row.analyzed_at,
    totalPages: row.total_pages,
    decayingPages: parseJsonFallback(row.decaying_pages, []),
    summary: parseJsonFallback(row.summary, { critical: 0, warning: 0, watch: 0, totalDecaying: 0, avgDeclinePct: 0 }),
  };
}
