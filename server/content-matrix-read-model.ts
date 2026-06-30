import db from './db/index.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import type {
  ContentMatrix,
  MatrixCell,
  MatrixDimension,
} from '../shared/types/content.ts';

interface MatrixRow {
  id: string;
  workspace_id: string;
  name: string;
  template_id: string;
  dimensions: string;
  url_pattern: string;
  keyword_pattern: string;
  cells: string;
  created_at: string;
  updated_at: string;
}

const stmts = createStmtCache(() => ({
  selectByWorkspace: db.prepare(
    `SELECT * FROM content_matrices WHERE workspace_id = ? ORDER BY updated_at DESC`,
  ),
  selectById: db.prepare(
    `SELECT * FROM content_matrices WHERE id = ? AND workspace_id = ?`,
  ),
}));

export function computeStats(cells: MatrixCell[]): ContentMatrix['stats'] {
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
      case 'flagged':
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

export function listMatrices(workspaceId: string): ContentMatrix[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as MatrixRow[];
  return rows.map(rowToMatrix);
}

export function getMatrix(workspaceId: string, matrixId: string): ContentMatrix | undefined {
  const row = stmts().selectById.get(matrixId, workspaceId) as MatrixRow | undefined;
  return row ? rowToMatrix(row) : undefined;
}
