/**
 * quick-wins — CRUD for the quick_wins table.
 *
 * Normalizes keywordStrategy.quickWins[] out of the workspace JSON blob into
 * indexed SQLite rows.
 */
import db from './db/index.js';
import type { QuickWin } from '../shared/types/workspace.js';
import { createLogger } from './logger.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';

const log = createLogger('quick-wins');

interface QuickWinRow {
  workspace_id: string;
  page_path: string;
  current_keyword: string | null;
  action: string;
  estimated_impact: string;
  rationale: string;
  roi_score: number | null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function normalizeQuickWin(raw: unknown): QuickWin | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const pagePath = nonEmptyString(candidate.pagePath);
  const action = nonEmptyString(candidate.action);
  if (!pagePath || !action) return null;
  const estimatedImpact = candidate.estimatedImpact === 'high' || candidate.estimatedImpact === 'medium' || candidate.estimatedImpact === 'low'
    ? candidate.estimatedImpact
    : 'medium';
  const rationale = nonEmptyString(candidate.rationale) ?? action;
  const currentKeyword = nonEmptyString(candidate.currentKeyword);
  const roiScore = typeof candidate.roiScore === 'number' && Number.isFinite(candidate.roiScore)
    ? candidate.roiScore
    : undefined;
  return {
    pagePath,
    currentKeyword,
    action,
    estimatedImpact,
    rationale,
    roiScore,
  };
}

function rowToModel(r: QuickWinRow): QuickWin {
  const estimatedImpact = r.estimated_impact === 'high' || r.estimated_impact === 'medium' || r.estimated_impact === 'low'
    ? r.estimated_impact
    : 'medium';
  return {
    pagePath: r.page_path,
    currentKeyword: r.current_keyword ?? undefined,
    action: r.action,
    estimatedImpact,
    rationale: r.rationale,
    roiScore: r.roi_score ?? undefined,
  };
}

function modelToParams(workspaceId: string, m: QuickWin) {
  return {
    workspace_id: workspaceId,
    page_path: m.pagePath,
    current_keyword: m.currentKeyword ?? null,
    action: m.action,
    estimated_impact: m.estimatedImpact,
    rationale: m.rationale,
    roi_score: m.roiScore ?? null,
  };
}

const stmts = createStmtCache(() => ({
  listByWs: db.prepare<[workspaceId: string]>(
    'SELECT * FROM quick_wins WHERE workspace_id = ? ORDER BY roi_score DESC NULLS LAST, page_path ASC, action ASC',
  ),
  insert: db.prepare(`
    INSERT INTO quick_wins (
      workspace_id, page_path, current_keyword, action, estimated_impact, rationale, roi_score
    ) VALUES (
      @workspace_id, @page_path, @current_keyword, @action, @estimated_impact, @rationale, @roi_score
    )
  `),
  deleteAll: db.prepare<[workspaceId: string]>(
    'DELETE FROM quick_wins WHERE workspace_id = ?',
  ),
  countByWs: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) as cnt FROM quick_wins WHERE workspace_id = ?',
  ),
}));

export function listQuickWins(workspaceId: string): QuickWin[] {
  const rows = stmts().listByWs.all(workspaceId) as QuickWinRow[];
  return rows.map(rowToModel);
}

export function replaceAllQuickWins(workspaceId: string, quickWins: QuickWin[]): void {
  const run = db.transaction(() => {
    stmts().deleteAll.run(workspaceId);
    const stmt = stmts().insert;
    for (const quickWin of quickWins) {
      const normalized = normalizeQuickWin(quickWin);
      if (!normalized) {
        log.warn({ workspaceId, quickWin }, 'Skipping invalid quick-win payload');
        continue;
      }
      stmt.run(modelToParams(workspaceId, normalized));
    }
  });
  run();
}

export function deleteAllQuickWins(workspaceId: string): void {
  stmts().deleteAll.run(workspaceId);
}

export function countQuickWins(workspaceId: string): number {
  return (stmts().countByWs.get(workspaceId) as { cnt: number }).cnt;
}

/**
 * Migrate keywordStrategy.quickWins from the workspace JSON blob into quick_wins.
 * Idempotent — skips workspaces that already have quick_wins rows.
 */
export function migrateFromJsonBlob(): void {
  const rows = db.prepare(`
    SELECT id, keyword_strategy FROM workspaces
    WHERE keyword_strategy IS NOT NULL AND keyword_strategy != ''
  `).all() as { id: string; keyword_strategy: string }[];

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const strategy = parseJsonFallback<Record<string, unknown> | null>(row.keyword_strategy, null);
      if (!strategy) continue;
      const quickWins = strategy.quickWins;
      if (!Array.isArray(quickWins) || quickWins.length === 0) continue;

      const normalized = quickWins
        .map((quickWin) => normalizeQuickWin(quickWin))
        .filter((quickWin): quickWin is QuickWin => quickWin != null);
      if (normalized.length === 0) continue;
      delete strategy.quickWins;
      const migrateOne = db.transaction((): 'migrated' | 'already-migrated' | 'concurrent-update' => {
        if (countQuickWins(row.id) > 0) return 'already-migrated';
        const write = db.prepare(`
          UPDATE workspaces
          SET keyword_strategy = ?
          WHERE id = ? AND keyword_strategy = ?
        `).run(JSON.stringify(strategy), row.id, row.keyword_strategy);
        if (write.changes === 0) return 'concurrent-update';
        const insert = stmts().insert;
        for (const quickWin of normalized) {
          insert.run(modelToParams(row.id, quickWin));
        }
        return 'migrated';
      });
      const outcome = migrateOne();
      if (outcome === 'already-migrated') {
        skipped++;
        continue;
      }
      if (outcome === 'concurrent-update') {
        skipped++;
        log.warn({ workspaceId: row.id }, 'Skipped quickWins blob cleanup due to concurrent keyword_strategy update');
        continue;
      }

      migrated++;
      log.info({ workspaceId: row.id, quickWins: normalized.length }, 'Migrated quickWins to quick_wins table');
    } catch (err) {
      log.error({ err, workspaceId: row.id }, 'Failed to migrate quickWins');
    }
  }

  if (migrated > 0 || skipped > 0) {
    log.info({ migrated, skipped }, 'quickWins migration complete');
  }
}
