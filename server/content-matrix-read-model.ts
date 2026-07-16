import db from './db/index.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import { z } from './middleware/validate.js';
import type {
  ContentMatrix,
  MatrixCell,
  MatrixDimension,
} from '../shared/types/content.ts';

const matrixCellStatusSchema = z.enum([
  'planned',
  'keyword_validated',
  'brief_generated',
  'draft',
  'review',
  'flagged',
  'approved',
  'published',
]);

export const matrixDimensionSchema = z.object({
  variableName: z.string().min(1),
  values: z.array(z.string()),
});

const statusHistoryEntrySchema = z.object({
  from: matrixCellStatusSchema,
  to: matrixCellStatusSchema,
  at: z.string().min(1),
});

const keywordCandidateSchema = z.object({
  keyword: z.string(),
  volume: z.number(),
  difficulty: z.number(),
  cpc: z.number(),
  source: z.enum(['pattern', 'semrush_related', 'ai_suggested', 'gsc']),
  isRecommended: z.boolean(),
  authorityAssessment: z.object({
    posture: z.enum([
      'authority_unknown',
      'within_current_authority_range',
      'requires_authority_building',
    ]),
    note: z.string(),
    referringDomains: z.number().optional(),
  }).optional(),
});

/** Stored cell JSON schema. Legacy rows without a revision read as revision 0. */
export const matrixCellSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().nonnegative().optional().default(0),
  variableValues: z.record(z.string()),
  targetKeyword: z.string(),
  customKeyword: z.string().optional(),
  plannedUrl: z.string(),
  plannedUrlOverridden: z.boolean().optional(),
  expectedSchemaTypesOverridden: z.boolean().optional(),
  briefId: z.string().optional(),
  postId: z.string().optional(),
  status: matrixCellStatusSchema,
  statusHistory: z.array(statusHistoryEntrySchema).optional(),
  keywordValidation: z.object({
    volume: z.number(),
    difficulty: z.number(),
    cpc: z.number(),
    validatedAt: z.string().min(1),
  }).optional(),
  keywordCandidates: z.array(keywordCandidateSchema).optional(),
  recommendedKeyword: z.string().optional(),
  clientFlag: z.string().optional(),
  clientFlaggedAt: z.string().optional(),
  expectedSchemaTypes: z.array(z.string()).optional(),
});

interface MatrixRow {
  id: string;
  workspace_id: string;
  name: string;
  template_id: string;
  dimensions: string;
  url_pattern: string;
  keyword_pattern: string;
  cells: string;
  revision?: number | null;
  created_at: string;
  updated_at: string;
}

const stmts = createStmtCache(() => ({
  selectByWorkspace: db.prepare(
    `SELECT * FROM content_matrices WHERE workspace_id = ? ORDER BY updated_at DESC, id ASC`,
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

export function rowToMatrix(row: MatrixRow): ContentMatrix {
  const context = { workspaceId: row.workspace_id, table: 'content_matrices' };
  const cells = parseJsonSafeArray(row.cells, matrixCellSchema, {
    ...context,
    field: 'cells',
  }) as MatrixCell[];
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    revision: row.revision ?? 0,
    name: row.name,
    templateId: row.template_id,
    dimensions: parseJsonSafeArray(row.dimensions, matrixDimensionSchema, {
      ...context,
      field: 'dimensions',
    }) as MatrixDimension[],
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
