/**
 * Content Matrices — CRUD operations for bulk content planning grids.
 *
 * A matrix connects a template to concrete cells (one per variable combination),
 * each with a keyword, planned URL, and brief/post tracking.
 */
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import type {
  ContentMatrix,
  MatrixCell,
  MatrixCellStatus,
  MatrixDimension,
} from '../shared/types/content.ts';
import { createLogger } from './logger.js';
import { PAGE_TYPE_SCHEMA_MAP, type SchemaPageType } from './schema-suggester.js';
import { queueSchemaPreGeneration, markSchemaStale } from './schema-queue.js';

/**
 * Resolve the combined primary + secondary Schema.org types for a template's pageType.
 * Used by D2 (template→schema binding) and downstream D7 (pre-generation).
 */
export function getSchemaTypesForTemplate(templatePageType: string): string[] {
  const mapped = PAGE_TYPE_SCHEMA_MAP[templatePageType as SchemaPageType];
  if (!mapped) return [];
  return [...mapped.primary, ...mapped.secondary];
}

const log = createLogger('content-matrices');

// ── SQLite row shape ──

interface MatrixRow {
  id: string;
  workspace_id: string;
  name: string;
  template_id: string;
  dimensions: string;
  url_pattern: string;
  keyword_pattern: string;
  cells: string;
  stats: string;
  created_at: string;
  updated_at: string;
}

// ── Prepared statements (lazy) ──

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO content_matrices
           (id, workspace_id, name, template_id, dimensions, url_pattern,
            keyword_pattern, cells, stats, created_at, updated_at)
         VALUES
           (@id, @workspace_id, @name, @template_id, @dimensions, @url_pattern,
            @keyword_pattern, @cells, @stats, @created_at, @updated_at)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM content_matrices WHERE workspace_id = ? ORDER BY updated_at DESC`,
  ),
  selectById: db.prepare(
    `SELECT * FROM content_matrices WHERE id = ? AND workspace_id = ?`,
  ),
  update: db.prepare(
    `UPDATE content_matrices SET
           name = @name, template_id = @template_id, dimensions = @dimensions,
           url_pattern = @url_pattern, keyword_pattern = @keyword_pattern,
           cells = @cells, stats = @stats, updated_at = @updated_at
         WHERE id = @id AND workspace_id = @workspace_id`,
  ),
  deleteById: db.prepare(
    `DELETE FROM content_matrices WHERE id = ? AND workspace_id = ?`,
  ),
}));

// ── Helpers ──

function computeStats(cells: MatrixCell[]): ContentMatrix['stats'] {
  const stats = { total: cells.length, planned: 0, briefGenerated: 0, drafted: 0, reviewed: 0, published: 0 };
  for (const c of cells) {
    switch (c.status) {
      case 'planned':
      case 'keyword_validated':
        stats.planned++;
        break;
      case 'brief_generated':
        stats.briefGenerated++;
        break;
      case 'draft':
        stats.drafted++;
        break;
      case 'review':
      case 'approved':
        stats.reviewed++;
        break;
      case 'published':
        stats.published++;
        break;
    }
  }
  return stats;
}

function rowToMatrix(row: MatrixRow): ContentMatrix {
  const cells = parseJsonFallback<MatrixCell[]>(row.cells, []);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    templateId: row.template_id,
    dimensions: parseJsonFallback<MatrixDimension[]>(row.dimensions, []),
    urlPattern: row.url_pattern,
    keywordPattern: row.keyword_pattern,
    cells,
    stats: computeStats(cells),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Generate cells from dimensions by computing the cartesian product of all
 * dimension values, then applying URL and keyword patterns.
 */
function generateCells(
  dimensions: MatrixDimension[],
  urlPattern: string,
  keywordPattern: string,
  expectedSchemaTypes?: string[],
): MatrixCell[] {
  if (!dimensions.length) return [];

  // Cartesian product of all dimension values
  const combos: Record<string, string>[] = [{}];
  for (const dim of dimensions) {
    const next: Record<string, string>[] = [];
    for (const existing of combos) {
      for (const val of dim.values) {
        next.push({ ...existing, [dim.variableName]: val });
      }
    }
    combos.length = 0;
    combos.push(...next);
  }

  return combos.map<MatrixCell>((variableValues) => {
    // Substitute variable placeholders in patterns
    let url = urlPattern;
    let keyword = keywordPattern;
    for (const [key, val] of Object.entries(variableValues)) {
      const slug = val.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      url = url.replace(new RegExp(`\\{${key}\\}`, 'gi'), slug);
      keyword = keyword.replace(new RegExp(`\\{${key}\\}`, 'gi'), val);
    }
    return {
      id: `cell_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      variableValues,
      targetKeyword: keyword,
      plannedUrl: url,
      status: 'planned' as MatrixCellStatus,
      ...(expectedSchemaTypes?.length ? { expectedSchemaTypes } : {}),
    } as MatrixCell;
  });
}

// ── CRUD ──

export function listMatrices(workspaceId: string): ContentMatrix[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as MatrixRow[];
  return rows.map(rowToMatrix);
}

export function getMatrix(workspaceId: string, matrixId: string): ContentMatrix | undefined {
  const row = stmts().selectById.get(matrixId, workspaceId) as MatrixRow | undefined;
  return row ? rowToMatrix(row) : undefined;
}

export function createMatrix(
  workspaceId: string,
  data: {
    name: string;
    templateId: string;
    dimensions: MatrixDimension[];
    urlPattern: string;
    keywordPattern: string;
    expectedSchemaTypes?: string[];
  },
): ContentMatrix {
  const id = `mtx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const cells = generateCells(data.dimensions, data.urlPattern, data.keywordPattern, data.expectedSchemaTypes);
  const stats = computeStats(cells);

  stmts().insert.run({
    id,
    workspace_id: workspaceId,
    name: data.name,
    template_id: data.templateId,
    dimensions: JSON.stringify(data.dimensions),
    url_pattern: data.urlPattern,
    keyword_pattern: data.keywordPattern,
    cells: JSON.stringify(cells),
    stats: JSON.stringify(stats),
    created_at: now,
    updated_at: now,
  });

  log.info({ matrixId: id, workspaceId, cellCount: cells.length }, 'Matrix created');

  return {
    id,
    workspaceId,
    name: data.name,
    templateId: data.templateId,
    dimensions: data.dimensions,
    urlPattern: data.urlPattern,
    keywordPattern: data.keywordPattern,
    cells,
    stats,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateMatrix(
  workspaceId: string,
  matrixId: string,
  updates: Partial<Pick<ContentMatrix, 'name' | 'dimensions' | 'urlPattern' | 'keywordPattern' | 'cells'>>,
): ContentMatrix | undefined {
  const existing = getMatrix(workspaceId, matrixId);
  if (!existing) return undefined;

  const name = updates.name ?? existing.name;
  const dimensions = updates.dimensions ?? existing.dimensions;
  const urlPattern = updates.urlPattern ?? existing.urlPattern;
  const keywordPattern = updates.keywordPattern ?? existing.keywordPattern;

  // If dimensions changed, regenerate cells (preserving status of existing ones by keyword match)
  let cells: MatrixCell[];
  if (updates.dimensions && JSON.stringify(updates.dimensions) !== JSON.stringify(existing.dimensions)) {
    const newCells = generateCells(dimensions, urlPattern, keywordPattern);
    const existingByKw = new Map(existing.cells.map(c => [c.targetKeyword.toLowerCase(), c])); // map-dup-ok
    cells = newCells.map(nc => {
      const match = existingByKw.get(nc.targetKeyword.toLowerCase());
      if (match) {
        return { ...nc, status: match.status, briefId: match.briefId, postId: match.postId, keywordValidation: match.keywordValidation };
      }
      return nc;
    });
  } else if (updates.cells) {
    cells = updates.cells;
  } else {
    cells = existing.cells;
  }

  const now = new Date().toISOString();
  const stats = computeStats(cells);

  stmts().update.run({
    id: matrixId,
    workspace_id: workspaceId,
    name,
    template_id: existing.templateId,
    dimensions: JSON.stringify(dimensions),
    url_pattern: urlPattern,
    keyword_pattern: keywordPattern,
    cells: JSON.stringify(cells),
    stats: JSON.stringify(stats),
    updated_at: now,
  });

  return {
    ...existing,
    name,
    dimensions,
    urlPattern,
    keywordPattern,
    cells,
    stats,
    updatedAt: now,
  };
}

/**
 * Update a single cell within a matrix (e.g., change keyword, status, link to brief).
 */
export function updateMatrixCell(
  workspaceId: string,
  matrixId: string,
  cellId: string,
  updates: Partial<Pick<MatrixCell, 'targetKeyword' | 'customKeyword' | 'status' | 'statusHistory' | 'briefId' | 'postId' | 'keywordValidation' | 'keywordCandidates' | 'recommendedKeyword' | 'clientFlag' | 'clientFlaggedAt'>>,
): ContentMatrix | undefined {
  const existing = getMatrix(workspaceId, matrixId);
  if (!existing) return undefined;

  const cellIdx = existing.cells.findIndex(c => c.id === cellId);
  if (cellIdx === -1) return undefined;

  const cell = existing.cells[cellIdx];

  // Record status transition in history
  if (updates.status && updates.status !== cell.status) {
    const history = cell.statusHistory || [];
    history.push({ from: cell.status, to: updates.status, at: new Date().toISOString() });
    updates = { ...updates, statusHistory: history } as typeof updates;
  }

  existing.cells[cellIdx] = { ...cell, ...updates };

  // Save to DB first so async reads see updated data
  const result = updateMatrix(workspaceId, matrixId, { cells: existing.cells });

  // D7: Mark pending schemas as stale if keyword changes after pre-generation
  if (updates.targetKeyword && updates.targetKeyword !== cell.targetKeyword) {
    markSchemaStale(workspaceId, cellId);
  }
  if (updates.customKeyword && updates.customKeyword !== cell.customKeyword) {
    markSchemaStale(workspaceId, cellId);
  }

  // D7: Queue schema pre-generation on status transition to brief_generated or approved
  // Runs after DB save so the async function reads correct cell data
  if (updates.status === 'brief_generated' || updates.status === 'approved') {
    void queueSchemaPreGeneration(workspaceId, matrixId, cellId);
  }

  return result;
}

export function deleteMatrix(workspaceId: string, matrixId: string): boolean {
  const result = stmts().deleteById.run(matrixId, workspaceId);
  return result.changes > 0;
}
