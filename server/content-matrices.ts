/**
 * Content Matrices — CRUD operations for bulk content planning grids.
 *
 * A matrix connects a template to concrete cells (one per variable combination),
 * each with a keyword, planned URL, and brief/post tracking.
 */
import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type {
  ContentMatrix,
  MatrixCell,
  MatrixCellStatus,
  MatrixDimension,
} from '../shared/types/content.ts';
import { createLogger } from './logger.js';
import { queueSchemaPreGeneration, markSchemaStale } from './schema-queue.js';
import { validateTransition, MATRIX_CELL_TRANSITIONS } from './state-machines.js';
import { computeStats, getMatrix } from './content-matrix-read-model.js';
import {
  ContentTemplateRevisionConflictError,
  getTemplate,
} from './content-templates.js';
import { canonicalGenerationFingerprint } from './domains/content/matrix-generation/fingerprint.js';
import {
  getMatrixGenerationSourceCensus,
  matrixGenerationSourceIsComplete,
} from './domains/content/matrix-generation/source-integrity.js';
import {
  renderMatrixPattern,
  validateRenderedMatrixPath,
  type MatrixPathIssueCode,
  type MatrixPatternIssue,
  type MatrixRenderMode,
} from './domains/content/matrix-generation/renderer.js';
import {
  assertContentMatrixGenerationSourceWithinLimits,
  assertMatrixCellGenerationSourceWithinLimits,
  assertMatrixGenerationDefinitionWithinLimits,
  normalizeMatrixGenerationSchemaTypes,
} from '../shared/types/matrix-generation.js';
export { getSchemaTypesForTemplate } from './schema/template-schema-types.js';
export { computeStats, getMatrix, listMatrices } from './content-matrix-read-model.js';

const log = createLogger('content-matrices');

// ── SQLite row shape ──

// ── Prepared statements (lazy) ──

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO content_matrices
         (id, workspace_id, name, template_id, dimensions, url_pattern,
            keyword_pattern, cells, stats, revision, created_at, updated_at)
         VALUES
           (@id, @workspace_id, @name, @template_id, @dimensions, @url_pattern,
            @keyword_pattern, @cells, @stats, @revision, @created_at, @updated_at)`,
  ),
  update: db.prepare(
    `UPDATE content_matrices SET
           name = @name, template_id = @template_id, dimensions = @dimensions,
           url_pattern = @url_pattern, keyword_pattern = @keyword_pattern,
           cells = @cells, stats = @stats, revision = @revision,
           updated_at = @updated_at
         WHERE id = @id AND workspace_id = @workspace_id
           AND revision = @expected_revision`,
  ),
  deleteById: db.prepare(
    `DELETE FROM content_matrices WHERE id = ? AND workspace_id = ?`,
  ),
}));

// ── Helpers ──

export class ContentMatrixRevisionConflictError extends Error {
  readonly matrixId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(matrixId: string, expectedRevision: number, actualRevision: number) {
    super('Content matrix changed since it was read');
    this.name = 'ContentMatrixRevisionConflictError';
    this.matrixId = matrixId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class ContentMatrixRevisionRequiredError extends Error {
  constructor() {
    super('expectedMatrixRevision is required for generation-effective matrix changes');
    this.name = 'ContentMatrixRevisionRequiredError';
  }
}

export class MatrixCellRevisionConflictError extends Error {
  readonly cellId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(cellId: string, expectedRevision: number, actualRevision: number) {
    super('Content matrix cell changed since it was read');
    this.name = 'MatrixCellRevisionConflictError';
    this.cellId = cellId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class MatrixCellRevisionRequiredError extends Error {
  constructor() {
    super('expectedCellRevision is required for a matrix cell write');
    this.name = 'MatrixCellRevisionRequiredError';
  }
}

export class ContentMatrixBulkCellWriteUnsupportedError extends Error {
  constructor() {
    super('Wholesale matrix cell writes are unsupported; update one cell with its expected revision');
    this.name = 'ContentMatrixBulkCellWriteUnsupportedError';
  }
}

export class ContentMatrixSourceIntegrityError extends Error {
  constructor() {
    super('Content matrix source arrays are malformed; refusing to rewrite stored data');
    this.name = 'ContentMatrixSourceIntegrityError';
  }
}

export class MatrixTemplateIntegrityError extends Error {
  constructor() {
    super('Template not found in this workspace');
    this.name = 'MatrixTemplateIntegrityError';
  }
}

export type ContentMatrixPatternField = 'urlPattern' | 'keywordPattern';
export type ContentMatrixPatternIssue = MatrixPatternIssue | { code: MatrixPathIssueCode };

export class ContentMatrixPatternRenderError extends Error {
  readonly field: ContentMatrixPatternField;
  readonly issues: readonly ContentMatrixPatternIssue[];

  constructor(field: ContentMatrixPatternField, issues: readonly ContentMatrixPatternIssue[]) {
    const details = issues
      .map(issue => `${issue.code}${'variableName' in issue && issue.variableName ? ` (${issue.variableName})` : ''}`)
      .join(', ');
    super(`Content matrix ${field} cannot generate deterministic cells: ${details}`);
    this.name = 'ContentMatrixPatternRenderError';
    this.field = field;
    this.issues = issues;
  }
}

function variableTupleKey(values: Record<string, string>): string {
  return JSON.stringify(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
}

function withoutRevision(cell: MatrixCell): Omit<MatrixCell, 'revision'> {
  const { revision: _revision, ...rest } = cell;
  return rest;
}

function cellChanged(before: MatrixCell, after: MatrixCell): boolean {
  return canonicalGenerationFingerprint(withoutRevision(before))
    !== canonicalGenerationFingerprint(withoutRevision(after));
}

function generationTargetChanged(
  before: MatrixCell,
  after: MatrixCell,
  templateChanged: boolean,
): boolean {
  if (templateChanged) return true;
  const projection = (cell: MatrixCell) => ({
    variableValues: cell.variableValues,
    targetKeyword: cell.targetKeyword,
    plannedUrl: cell.plannedUrl,
    expectedSchemaTypes: cell.expectedSchemaTypes,
  });
  return canonicalGenerationFingerprint(projection(before))
    !== canonicalGenerationFingerprint(projection(after));
}

function regenerateMatchedCell(
  existing: MatrixCell,
  generated: MatrixCell,
  templateChanged: boolean,
): MatrixCell {
  const generatedTarget: MatrixCell = {
    ...existing,
    variableValues: generated.variableValues,
    targetKeyword: generated.targetKeyword,
    plannedUrl: generated.plannedUrl,
    expectedSchemaTypes: generated.expectedSchemaTypes,
  };
  const targetChanged = generationTargetChanged(existing, generatedTarget, templateChanged);
  if (!targetChanged) return generatedTarget;

  // Research remains useful input for the same durable tuple. Lifecycle,
  // review, and artifact linkage describe the old rendered target and must reset.
  const regenerated: MatrixCell = {
    id: existing.id,
    revision: existing.revision ?? 0,
    variableValues: generated.variableValues,
    targetKeyword: generated.targetKeyword,
    plannedUrl: generated.plannedUrl,
    status: 'planned',
    ...(existing.customKeyword !== undefined ? { customKeyword: existing.customKeyword } : {}),
    ...(existing.recommendedKeyword !== undefined
      ? { recommendedKeyword: existing.recommendedKeyword }
      : {}),
    ...(existing.keywordValidation !== undefined
      && generated.targetKeyword === existing.targetKeyword
      ? { keywordValidation: existing.keywordValidation }
      : {}),
    ...(existing.keywordCandidates !== undefined
      ? { keywordCandidates: existing.keywordCandidates }
      : {}),
    ...(generated.expectedSchemaTypes !== undefined
      ? { expectedSchemaTypes: generated.expectedSchemaTypes }
      : {}),
  };
  return regenerated;
}

function assertUniqueCellIds(cells: MatrixCell[]): void {
  if (new Set(cells.map(cell => cell.id)).size !== cells.length) {
    throw new Error('Content matrix cells must have unique IDs');
  }
}

function renderGeneratedCellPattern(
  field: ContentMatrixPatternField,
  pattern: string,
  variableValues: Readonly<Record<string, string>>,
  mode: MatrixRenderMode,
  allowedVariableNames: readonly string[],
): string {
  const rendered = renderMatrixPattern(
    pattern,
    variableValues,
    mode,
    allowedVariableNames,
  );
  if (rendered.status === 'blocked') {
    throw new ContentMatrixPatternRenderError(field, rendered.issues);
  }
  return rendered.value;
}

/**
 * Generate cells from dimensions by computing the cartesian product of all
 * dimension values, then applying URL and keyword patterns.
 */
export function generateCells(
  dimensions: MatrixDimension[],
  urlPattern: string,
  keywordPattern: string,
  expectedSchemaTypes?: string[],
): MatrixCell[] {
  const normalizedSchemaTypes = expectedSchemaTypes
    ? normalizeMatrixGenerationSchemaTypes(expectedSchemaTypes, 'expectedSchemaTypes')
    : undefined;
  assertMatrixGenerationDefinitionWithinLimits({
    dimensions,
    urlPattern,
    keywordPattern,
    expectedSchemaTypes: normalizedSchemaTypes,
  });
  if (!dimensions.length) return [];
  const variableNames = dimensions.map(dimension => dimension.variableName);

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
    const url = renderGeneratedCellPattern(
      'urlPattern',
      urlPattern,
      variableValues,
      'slug',
      variableNames,
    );
    const pathValidation = validateRenderedMatrixPath(url);
    if (pathValidation.status === 'blocked') {
      throw new ContentMatrixPatternRenderError('urlPattern', [{ code: pathValidation.code }]);
    }
    const keyword = renderGeneratedCellPattern(
      'keywordPattern',
      keywordPattern,
      variableValues,
      'prose',
      variableNames,
    );
    return {
      id: `cell_${randomUUID()}`,
      revision: 1,
      variableValues,
      targetKeyword: keyword,
      plannedUrl: url,
      status: 'planned' as MatrixCellStatus,
      ...(normalizedSchemaTypes?.length ? { expectedSchemaTypes: normalizedSchemaTypes } : {}),
    } as MatrixCell;
  });
}

// ── CRUD ──

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
  options: { validateTemplate?: boolean } = {},
): ContentMatrix {
  const template = getTemplate(workspaceId, data.templateId);
  if (options.validateTemplate && !template) {
    throw new MatrixTemplateIntegrityError();
  }
  const expectedSchemaTypes = data.expectedSchemaTypes ?? template?.schemaTypes;
  const normalizedSchemaTypes = expectedSchemaTypes
    ? normalizeMatrixGenerationSchemaTypes(expectedSchemaTypes, 'expectedSchemaTypes')
    : undefined;
  assertMatrixGenerationDefinitionWithinLimits({
    name: data.name,
    templateId: data.templateId,
    dimensions: data.dimensions,
    urlPattern: data.urlPattern,
    keywordPattern: data.keywordPattern,
    expectedSchemaTypes: normalizedSchemaTypes,
  });
  const id = `mtx_${randomUUID()}`;
  const now = new Date().toISOString();
  const cells = generateCells(
    data.dimensions,
    data.urlPattern,
    data.keywordPattern,
    normalizedSchemaTypes,
  );
  const stats = computeStats(cells);
  const matrix: ContentMatrix = {
    id,
    workspaceId,
    revision: 1,
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
  assertContentMatrixGenerationSourceWithinLimits(matrix);

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
    revision: 1,
    created_at: now,
    updated_at: now,
  });

  log.info({ matrixId: id, workspaceId, cellCount: cells.length }, 'Matrix created');

  return matrix;
}

export function updateMatrix(
  workspaceId: string,
  matrixId: string,
  updates: Partial<Pick<ContentMatrix, 'name' | 'templateId' | 'dimensions' | 'urlPattern' | 'keywordPattern'>>,
  options: { expectedMatrixRevision?: number } = {},
): ContentMatrix | undefined {
  const write = db.transaction((): ContentMatrix | undefined => {
    const existing = getMatrix(workspaceId, matrixId);
    if (!existing) return undefined;
    const sourceIntegrity = matrixGenerationSourceIsComplete(
      getMatrixGenerationSourceCensus(workspaceId, matrixId),
      existing,
      null,
    );
    if (!sourceIntegrity.matrixComplete) {
      throw new ContentMatrixSourceIntegrityError();
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'cells')) {
      throw new ContentMatrixBulkCellWriteUnsupportedError();
    }
    const currentRevision = existing.revision ?? 0;

    const name = updates.name ?? existing.name;
    const templateId = updates.templateId ?? existing.templateId;
    const dimensions = updates.dimensions ?? existing.dimensions;
    const urlPattern = updates.urlPattern ?? existing.urlPattern;
    const keywordPattern = updates.keywordPattern ?? existing.keywordPattern;
    const definitionFieldsChanged = templateId !== existing.templateId
      || canonicalGenerationFingerprint(dimensions)
        !== canonicalGenerationFingerprint(existing.dimensions)
      || urlPattern !== existing.urlPattern
      || keywordPattern !== existing.keywordPattern;

    if (definitionFieldsChanged && options.expectedMatrixRevision === undefined) {
      throw new ContentMatrixRevisionRequiredError();
    }
    const expectedRevision = options.expectedMatrixRevision ?? currentRevision;
    if (expectedRevision !== currentRevision) {
      throw new ContentMatrixRevisionConflictError(matrixId, expectedRevision, currentRevision);
    }
    let cells: MatrixCell[];
    if (definitionFieldsChanged) {
      const template = getTemplate(workspaceId, templateId);
      if (!template) throw new MatrixTemplateIntegrityError();
      const generated = generateCells(
        dimensions,
        urlPattern,
        keywordPattern,
        template.schemaTypes,
      );
      const existingByTuple = new Map<string, MatrixCell[]>(); // map-dup-ok: duplicate tuples retain ordered queues
      for (const cell of existing.cells) {
        const key = variableTupleKey(cell.variableValues);
        const matches = existingByTuple.get(key) ?? [];
        matches.push(cell);
        existingByTuple.set(key, matches);
      }
      cells = generated.map(generatedCell => {
        const match = existingByTuple.get(variableTupleKey(generatedCell.variableValues))?.shift();
        if (!match) return generatedCell;
        const templateChanged = templateId !== existing.templateId;
        const candidate = regenerateMatchedCell(match, generatedCell, templateChanged);
        const targetChanged = generationTargetChanged(match, candidate, templateChanged);
        return {
          ...candidate,
          revision: targetChanged || cellChanged(match, candidate)
            ? (match.revision ?? 0) + 1
            : (match.revision ?? 0),
        };
      });
    } else {
      cells = existing.cells;
    }

    assertUniqueCellIds(cells);
    const revision = definitionFieldsChanged ? currentRevision + 1 : currentRevision;
    const now = new Date().toISOString();
    const stats = computeStats(cells);
    const merged: ContentMatrix = {
      ...existing,
      revision,
      name,
      templateId,
      dimensions,
      urlPattern,
      keywordPattern,
      cells,
      stats,
      updatedAt: now,
    };
    assertContentMatrixGenerationSourceWithinLimits(merged);

    const result = stmts().update.run({
      id: matrixId,
      workspace_id: workspaceId,
      name,
      template_id: templateId,
      dimensions: JSON.stringify(dimensions),
      url_pattern: urlPattern,
      keyword_pattern: keywordPattern,
      cells: JSON.stringify(cells),
      stats: JSON.stringify(stats),
      revision,
      expected_revision: expectedRevision,
      updated_at: now,
    });
    if (result.changes !== 1) {
      const actualRevision = getMatrix(workspaceId, matrixId)?.revision ?? currentRevision;
      throw new ContentMatrixRevisionConflictError(matrixId, expectedRevision, actualRevision);
    }

    return merged;
  });
  return write.immediate();
}

/**
 * Update a single cell within a matrix (e.g., change keyword, status, link to brief).
 */
export function updateMatrixCell(
  workspaceId: string,
  matrixId: string,
  cellId: string,
  updates: Partial<Omit<MatrixCell, 'id' | 'revision'>>,
  options: {
    expectedCellRevision?: number;
    expectedMatrixRevision?: number;
    expectedTemplateRevision?: number;
    requireExpectedCellRevision?: boolean;
    /** Domain-owned revision advance for a normalized evidence mutation. */
    revisionReason?: 'evidence_resolution';
    /** A surrounding transaction will queue schema generation after it commits. */
    skipSchemaPreGeneration?: boolean;
  } = {},
): ContentMatrix | undefined {
  if (options.requireExpectedCellRevision && options.expectedCellRevision === undefined) {
    throw new MatrixCellRevisionRequiredError();
  }

  const write = db.transaction((): { matrix: ContentMatrix; previousCell: MatrixCell; changed: boolean } | undefined => {
    const existing = getMatrix(workspaceId, matrixId);
    if (!existing) return undefined;
    const sourceIntegrity = matrixGenerationSourceIsComplete(
      getMatrixGenerationSourceCensus(workspaceId, matrixId),
      existing,
      null,
    );
    if (!sourceIntegrity.matrixComplete) {
      throw new ContentMatrixSourceIntegrityError();
    }
    const matrixRevision = existing.revision ?? 0;
    if (options.expectedMatrixRevision !== undefined
      && options.expectedMatrixRevision !== matrixRevision) {
      throw new ContentMatrixRevisionConflictError(
        matrixId,
        options.expectedMatrixRevision,
        matrixRevision,
      );
    }

    if (options.expectedTemplateRevision !== undefined) {
      const template = getTemplate(workspaceId, existing.templateId);
      if (!template) throw new MatrixTemplateIntegrityError();
      const templateRevision = template.revision ?? 0;
      if (options.expectedTemplateRevision !== templateRevision) {
        throw new ContentTemplateRevisionConflictError(
          existing.templateId,
          options.expectedTemplateRevision,
          templateRevision,
        );
      }
    }

    const cellIdx = existing.cells.findIndex(cell => cell.id === cellId);
    if (cellIdx === -1) return undefined;
    const cell = existing.cells[cellIdx];
    const cellRevision = cell.revision ?? 0;
    if (options.expectedCellRevision !== undefined
      && options.expectedCellRevision !== cellRevision) {
      throw new MatrixCellRevisionConflictError(
        cellId,
        options.expectedCellRevision,
        cellRevision,
      );
    }

    let effectiveUpdates = updates;
    if (updates.expectedSchemaTypes !== undefined) {
      effectiveUpdates = {
        ...effectiveUpdates,
        expectedSchemaTypes: normalizeMatrixGenerationSchemaTypes(
          updates.expectedSchemaTypes,
          'expectedSchemaTypes',
        ),
      };
    }
    if (updates.status && updates.status !== cell.status) {
      validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, cell.status, updates.status);
      effectiveUpdates = {
        ...effectiveUpdates,
        statusHistory: [
          ...(cell.statusHistory ?? []),
          { from: cell.status, to: updates.status, at: new Date().toISOString() },
        ],
      };
    }

    const candidate: MatrixCell = {
      ...cell,
      ...effectiveUpdates,
      id: cell.id,
      revision: cellRevision,
    };
    const changed = cellChanged(cell, candidate) || options.revisionReason === 'evidence_resolution';
    if (!changed) return { matrix: existing, previousCell: cell, changed: false };

    const nextCell: MatrixCell = { ...candidate, revision: cellRevision + 1 };
    assertMatrixCellGenerationSourceWithinLimits(nextCell);
    const cells = existing.cells.map((stored, index) => index === cellIdx ? nextCell : stored);
    const now = new Date().toISOString();
    const stats = computeStats(cells);
    const merged: ContentMatrix = { ...existing, cells, stats, updatedAt: now };
    assertContentMatrixGenerationSourceWithinLimits(merged);
    const result = stmts().update.run({
      id: matrixId,
      workspace_id: workspaceId,
      name: existing.name,
      template_id: existing.templateId,
      dimensions: JSON.stringify(existing.dimensions),
      url_pattern: existing.urlPattern,
      keyword_pattern: existing.keywordPattern,
      cells: JSON.stringify(cells),
      stats: JSON.stringify(stats),
      revision: matrixRevision,
      expected_revision: matrixRevision,
      updated_at: now,
    });
    if (result.changes !== 1) {
      const actualRevision = getMatrix(workspaceId, matrixId)?.revision ?? matrixRevision;
      throw new ContentMatrixRevisionConflictError(matrixId, matrixRevision, actualRevision);
    }
    return {
      matrix: merged,
      previousCell: cell,
      changed: true,
    };
  });
  const result = write.immediate();
  if (!result) return undefined;
  const { matrix, previousCell: cell, changed } = result;
  if (!changed) return matrix;

  // D7: Mark pending schemas as stale if keyword changes after pre-generation
  if (updates.targetKeyword !== undefined && updates.targetKeyword !== cell.targetKeyword) {
    markSchemaStale(workspaceId, cellId);
  }
  if (updates.customKeyword !== undefined && updates.customKeyword !== cell.customKeyword) {
    markSchemaStale(workspaceId, cellId);
  }

  // D7: Queue schema pre-generation on status transition to brief_generated or approved
  // Runs after DB save so the async function reads correct cell data
  if (!options.skipSchemaPreGeneration
    && (updates.status === 'brief_generated' || updates.status === 'approved')) {
    void queueSchemaPreGeneration(workspaceId, matrixId, cellId);
  }

  return matrix;
}

export function deleteMatrix(workspaceId: string, matrixId: string): boolean {
  const result = stmts().deleteById.run(matrixId, workspaceId);
  return result.changes > 0;
}
