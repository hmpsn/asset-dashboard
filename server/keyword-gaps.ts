/**
 * keyword-gaps — CRUD for the keyword_gaps table.
 *
 * Normalizes keywordStrategy.keywordGaps[] out of the workspace JSON blob into
 * indexed SQLite rows.
 */
import db from './db/index.js';
import type { KeywordGapItem } from '../shared/types/workspace.js';
import { createLogger } from './logger.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';

const log = createLogger('keyword-gaps');

interface KeywordGapRow {
  workspace_id: string;
  keyword: string;
  volume: number;
  difficulty: number;
  competitor_position: number;
  competitor_domain: string;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeKeywordGap(raw: unknown): KeywordGapItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const keyword = nonEmptyString(candidate.keyword);
  const competitorDomain = nonEmptyString(candidate.competitorDomain);
  const volume = finiteNumber(candidate.volume);
  const difficulty = finiteNumber(candidate.difficulty);
  const competitorPosition = finiteNumber(candidate.competitorPosition);
  if (!keyword || !competitorDomain || volume == null || difficulty == null || competitorPosition == null) {
    return null;
  }
  return {
    keyword,
    volume,
    difficulty,
    competitorPosition,
    competitorDomain,
  };
}

function rowToModel(row: KeywordGapRow): KeywordGapItem {
  return {
    keyword: row.keyword,
    volume: row.volume,
    difficulty: row.difficulty,
    competitorPosition: row.competitor_position,
    competitorDomain: row.competitor_domain,
  };
}

function modelToParams(workspaceId: string, gap: KeywordGapItem) {
  return {
    workspace_id: workspaceId,
    keyword: gap.keyword,
    volume: gap.volume,
    difficulty: gap.difficulty,
    competitor_position: gap.competitorPosition,
    competitor_domain: gap.competitorDomain,
  };
}

function dedupeByKeyword(gaps: KeywordGapItem[]): KeywordGapItem[] {
  const byKeyword = new Map<string, KeywordGapItem>();
  for (const gap of gaps) {
    byKeyword.set(gap.keyword.toLowerCase(), gap);
  }
  return [...byKeyword.values()];
}

const stmts = createStmtCache(() => ({
  listByWs: db.prepare<[workspaceId: string]>(
    'SELECT * FROM keyword_gaps WHERE workspace_id = ? ORDER BY volume DESC, difficulty ASC, keyword ASC',
  ),
  insert: db.prepare(`
    INSERT INTO keyword_gaps (
      workspace_id, keyword, volume, difficulty, competitor_position, competitor_domain
    ) VALUES (
      @workspace_id, @keyword, @volume, @difficulty, @competitor_position, @competitor_domain
    )
  `),
  deleteAll: db.prepare<[workspaceId: string]>(
    'DELETE FROM keyword_gaps WHERE workspace_id = ?',
  ),
  countByWs: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) as cnt FROM keyword_gaps WHERE workspace_id = ?',
  ),
}));

export function listKeywordGaps(workspaceId: string): KeywordGapItem[] {
  const rows = stmts().listByWs.all(workspaceId) as KeywordGapRow[];
  return rows.map(rowToModel);
}

export function replaceAllKeywordGaps(workspaceId: string, gaps: KeywordGapItem[]): void {
  const run = db.transaction(() => {
    stmts().deleteAll.run(workspaceId);
    const normalized = gaps
      .map((gap) => normalizeKeywordGap(gap))
      .filter((gap): gap is KeywordGapItem => gap != null);
    if (normalized.length !== gaps.length) {
      log.warn({ workspaceId, total: gaps.length, kept: normalized.length }, 'Skipping invalid keyword-gap payload(s)');
    }
    const normalizedGaps = dedupeByKeyword(normalized);
    const stmt = stmts().insert;
    for (const gap of normalizedGaps) {
      stmt.run(modelToParams(workspaceId, gap));
    }
  });
  run();
}

export function deleteAllKeywordGaps(workspaceId: string): void {
  stmts().deleteAll.run(workspaceId);
}

export function countKeywordGaps(workspaceId: string): number {
  return (stmts().countByWs.get(workspaceId) as { cnt: number }).cnt;
}

/**
 * Migrate keywordStrategy.keywordGaps from the workspace JSON blob into keyword_gaps.
 * Idempotent — skips workspaces that already have keyword_gaps rows.
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
      const keywordGaps = strategy.keywordGaps;
      if (!Array.isArray(keywordGaps) || keywordGaps.length === 0) continue;

      const normalized = dedupeByKeyword(keywordGaps
        .map((gap) => normalizeKeywordGap(gap))
        .filter((gap): gap is KeywordGapItem => gap != null));
      if (normalized.length === 0) continue;

      delete strategy.keywordGaps;
      const migrateOne = db.transaction((): 'migrated' | 'already-migrated' | 'concurrent-update' => {
        if (countKeywordGaps(row.id) > 0) return 'already-migrated';
        const write = db.prepare(`
          UPDATE workspaces
          SET keyword_strategy = ?
          WHERE id = ? AND keyword_strategy = ?
        `).run(JSON.stringify(strategy), row.id, row.keyword_strategy);
        if (write.changes === 0) return 'concurrent-update';
        const insert = stmts().insert;
        for (const gap of normalized) {
          insert.run(modelToParams(row.id, gap));
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
        log.warn({ workspaceId: row.id }, 'Skipped keywordGaps blob cleanup due to concurrent keyword_strategy update');
        continue;
      }

      migrated++;
      log.info({ workspaceId: row.id, keywordGaps: normalized.length }, 'Migrated keywordGaps to keyword_gaps table');
    } catch (err) {
      log.error({ err, workspaceId: row.id }, 'Failed to migrate keywordGaps');
    }
  }

  if (migrated > 0 || skipped > 0) {
    log.info({ migrated, skipped }, 'keywordGaps migration complete');
  }
}
