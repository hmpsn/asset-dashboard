import db from '../../../db/index.js';
import { parseJsonFallback } from '../../../db/json-validation.js';
import {
  createMatrix,
  getMatrix,
  listMatrices,
  ContentMatrixPatternRenderError,
} from '../../../content-matrices.js';
import { getTemplate } from '../../../content-templates.js';
import { hasExactMatrixKeywordConflict } from '../../../cannibalization-detection.js';
import { getEntry, listBlueprints, updateEntry } from '../../../page-strategy.js';
import type { ContentMatrix, ContentTemplate, MatrixDimension } from '../../../../shared/types/content.js';
import type {
  BlueprintEntry,
  CreatePseoMatrixFromPlanInput,
  PseoMatrixMaterializationResult,
  PseoMatrixPlanResult,
  ListPseoBlueprintEntriesResult,
} from '../../../../shared/types/page-strategy.js';
import { MATRIX_READ_LIMITS } from '../../../../shared/types/matrix-generation.js';
import {
  MatrixGenerationSchemaTypeContractError,
  MatrixGenerationSourceLimitError,
} from '../../../../shared/types/matrix-generation.js';
import { canonicalGenerationFingerprint } from './fingerprint.js';
import { canonicalizeMatrixPath } from './renderer.js';

export type PseoMatrixBridgeErrorReason =
  | 'source_not_found'
  | 'entry_not_collection'
  | 'template_not_linked'
  | 'page_type_mismatch'
  | 'dimension_mismatch'
  | 'source_changed'
  | 'linked_matrix_missing'
  | 'linked_matrix_changed'
  | 'url_collision'
  | 'keyword_cannibalization'
  | 'invalid_matrix_definition';

export class PseoMatrixBridgeError extends Error {
  readonly code: 'not_found' | 'conflict' | 'precondition_failed';
  readonly reason: PseoMatrixBridgeErrorReason;

  constructor(
    code: 'not_found' | 'conflict' | 'precondition_failed',
    reason: PseoMatrixBridgeErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'PseoMatrixBridgeError';
    this.code = code;
    this.reason = reason;
  }
}

interface PreparedPlan {
  entry: BlueprintEntry;
  template: ContentTemplate;
  dimensions: MatrixDimension[];
  replay?: PseoMatrixMaterializationResult;
}

interface PseoPlanSource {
  entry: BlueprintEntry;
  template: ContentTemplate;
}

interface BlueprintEntryCursor {
  version: 1;
  workspaceId: string;
  offset: number;
}

function encodeBlueprintEntryCursor(cursor: BlueprintEntryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeBlueprintEntryCursor(workspaceId: string, cursor?: string): number {
  if (!cursor) return 0;
  const parsed = parseJsonFallback<Partial<BlueprintEntryCursor> | null>(
    Buffer.from(cursor, 'base64url').toString('utf8'),
    null,
  );
  if (
    parsed?.version !== 1
    || parsed.workspaceId !== workspaceId
    || !Number.isSafeInteger(parsed.offset)
    || (parsed.offset ?? -1) < 0
  ) {
    throw new PseoMatrixBridgeError(
      'precondition_failed',
      'invalid_matrix_definition',
      'The blueprint entry cursor is invalid for this workspace.',
    );
  }
  return parsed.offset as number;
}

export function listPseoBlueprintEntries(input: {
  workspaceId: string;
  cursor?: string;
  limit?: number;
}): ListPseoBlueprintEntriesResult {
  const limit = Math.min(
    Math.max(input.limit ?? MATRIX_READ_LIMITS.defaultPageSize, 1),
    MATRIX_READ_LIMITS.maxPageSize,
  );
  const offset = decodeBlueprintEntryCursor(input.workspaceId, input.cursor);
  const items = listBlueprints(input.workspaceId)
    .flatMap(blueprint => (blueprint.entries ?? [])
      .filter(entry => entry.isCollection)
      .map(entry => ({
        blueprintId: blueprint.id,
        blueprintName: blueprint.name,
        blueprintStatus: blueprint.status,
        blueprintUpdatedAt: blueprint.updatedAt,
        entryId: entry.id,
        entryName: entry.name,
        entryUpdatedAt: entry.updatedAt,
        pageType: entry.pageType,
        templateId: entry.templateId ?? null,
        matrixId: entry.matrixId ?? null,
      })))
    .sort((left, right) => left.blueprintId.localeCompare(right.blueprintId)
      || left.entryId.localeCompare(right.entryId));
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor: nextOffset < items.length
      ? encodeBlueprintEntryCursor({ version: 1, workspaceId: input.workspaceId, offset: nextOffset })
      : null,
  };
}

function normalizedValueKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

function normalizeDimensions(
  template: ContentTemplate,
  dimensions: readonly MatrixDimension[],
): MatrixDimension[] {
  const templateNames = template.variables.map(variable => variable.name);
  if (
    templateNames.length === 0
    || new Set(templateNames).size !== templateNames.length
    || templateNames.some(name => name.trim().length === 0)
  ) {
    throw new PseoMatrixBridgeError(
      'precondition_failed',
      'dimension_mismatch',
      'The linked template must declare a unique non-empty variable for every matrix dimension.',
    );
  }

  const byName = new Map<string, MatrixDimension>();
  for (const dimension of dimensions) {
    const variableName = dimension.variableName.trim();
    if (!templateNames.includes(variableName) || byName.has(variableName)) {
      throw new PseoMatrixBridgeError(
        'precondition_failed',
        'dimension_mismatch',
        `Matrix dimensions must match the linked template variables exactly; check "${variableName || 'blank'}".`,
      );
    }
    const values = dimension.values.map(value => value.trim());
    const normalizedValues = values.map(normalizedValueKey);
    if (
      values.length === 0
      || normalizedValues.some(value => value.length === 0)
      || new Set(normalizedValues).size !== normalizedValues.length
    ) {
      throw new PseoMatrixBridgeError(
        'precondition_failed',
        'dimension_mismatch',
        `Matrix dimension "${variableName}" must contain unique non-empty values.`,
      );
    }
    byName.set(variableName, { variableName, values });
  }

  if (byName.size !== templateNames.length) {
    const missing = templateNames.filter(name => !byName.has(name));
    throw new PseoMatrixBridgeError(
      'precondition_failed',
      'dimension_mismatch',
      `Matrix dimensions are missing linked template variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
    );
  }

  return templateNames.map(name => byName.get(name)!);
}

function materializationResult(
  input: Pick<CreatePseoMatrixFromPlanInput, 'workspaceId' | 'blueprintId' | 'entryId'>,
  entry: BlueprintEntry,
  template: ContentTemplate,
  matrix: ContentMatrix,
  replayed: boolean,
): PseoMatrixMaterializationResult {
  return {
    replayed,
    source: {
      workspaceId: input.workspaceId,
      blueprintId: input.blueprintId,
      entryId: input.entryId,
      entryUpdatedAt: entry.updatedAt,
      templateId: template.id,
      templateRevision: template.revision ?? 0,
      matrixId: matrix.id,
    },
    matrix: {
      id: matrix.id,
      name: matrix.name,
      revision: matrix.revision ?? 0,
      templateRevision: template.revision ?? 0,
      cellCount: matrix.cells.length,
      createdAt: matrix.createdAt,
      updatedAt: matrix.updatedAt,
    },
  };
}

function loadPlanSource(
  input: Pick<CreatePseoMatrixFromPlanInput, 'workspaceId' | 'blueprintId' | 'entryId'>,
): PseoPlanSource {
  const entry = getEntry(input.workspaceId, input.blueprintId, input.entryId);
  if (!entry) {
    throw new PseoMatrixBridgeError(
      'not_found',
      'source_not_found',
      'The requested blueprint entry was not found in this workspace.',
    );
  }
  if (!entry.isCollection) {
    throw new PseoMatrixBridgeError(
      'precondition_failed',
      'entry_not_collection',
      'Only a blueprint entry marked as a collection can materialize a content matrix.',
    );
  }
  if (!entry.templateId) {
    throw new PseoMatrixBridgeError(
      'precondition_failed',
      'template_not_linked',
      'Link a content template to the blueprint entry before materializing its matrix.',
    );
  }
  const template = getTemplate(input.workspaceId, entry.templateId);
  if (!template) {
    throw new PseoMatrixBridgeError(
      'not_found',
      'template_not_linked',
      'The blueprint entry\'s linked content template was not found in this workspace.',
    );
  }
  if (entry.pageType !== template.pageType) {
    throw new PseoMatrixBridgeError(
      'precondition_failed',
      'page_type_mismatch',
      'The blueprint entry and linked template must use the same page type.',
    );
  }
  if (!template.urlPattern.trim() || !template.keywordPattern.trim()) {
    throw new PseoMatrixBridgeError(
      'precondition_failed',
      'invalid_matrix_definition',
      'The linked template must define non-empty URL and keyword patterns.',
    );
  }
  return { entry, template };
}

export function getPseoMatrixPlan(
  input: Pick<CreatePseoMatrixFromPlanInput, 'workspaceId' | 'blueprintId' | 'entryId'>,
): PseoMatrixPlanResult {
  const { entry, template } = loadPlanSource(input);
  if (entry.matrixId && !getMatrix(input.workspaceId, entry.matrixId)) {
    throw new PseoMatrixBridgeError(
      'conflict',
      'linked_matrix_missing',
      'The blueprint entry points to a matrix that is missing or belongs to another workspace.',
    );
  }
  return {
    source: {
      workspaceId: input.workspaceId,
      blueprintId: input.blueprintId,
      entryId: input.entryId,
      entryUpdatedAt: entry.updatedAt,
      templateId: template.id,
      templateRevision: template.revision ?? 0,
      ...(entry.matrixId ? { matrixId: entry.matrixId } : {}),
    },
    entry: {
      name: entry.name,
      pageType: entry.pageType,
      isCollection: entry.isCollection,
    },
    template: {
      name: template.name,
      pageType: template.pageType,
      variables: template.variables,
      urlPattern: template.urlPattern,
      keywordPattern: template.keywordPattern,
    },
  };
}

function preparePlan(input: CreatePseoMatrixFromPlanInput): PreparedPlan {
  const { entry, template } = loadPlanSource(input);
  const currentTemplateRevision = template.revision ?? 0;
  if (
    input.expectedSourceRevision.templateId !== template.id
    || input.expectedSourceRevision.templateRevision !== currentTemplateRevision
  ) {
    throw new PseoMatrixBridgeError(
      'conflict',
      'source_changed',
      'The blueprint entry or linked template changed; re-read the pSEO matrix plan before retrying.',
    );
  }
  if (!entry.matrixId && input.expectedSourceRevision.entryUpdatedAt !== entry.updatedAt) {
    throw new PseoMatrixBridgeError(
      'conflict',
      'source_changed',
      'The blueprint entry changed; re-read the pSEO matrix plan before retrying.',
    );
  }

  const dimensions = normalizeDimensions(template, input.dimensions);
  if (!entry.matrixId) return { entry, template, dimensions };

  const matrix = getMatrix(input.workspaceId, entry.matrixId);
  if (!matrix) {
    throw new PseoMatrixBridgeError(
      'conflict',
      'linked_matrix_missing',
      'The blueprint entry points to a matrix that is missing or belongs to another workspace.',
    );
  }
  const expectedDefinition = {
    templateId: template.id,
    dimensions,
    urlPattern: template.urlPattern,
    keywordPattern: template.keywordPattern,
  };
  const storedDefinition = {
    templateId: matrix.templateId,
    dimensions: matrix.dimensions,
    urlPattern: matrix.urlPattern,
    keywordPattern: matrix.keywordPattern,
  };
  if (
    canonicalGenerationFingerprint(expectedDefinition)
      !== canonicalGenerationFingerprint(storedDefinition)
  ) {
    throw new PseoMatrixBridgeError(
      'conflict',
      'linked_matrix_changed',
      'The linked matrix or template changed; inspect the existing matrix before retrying.',
    );
  }
  return {
    entry,
    template,
    dimensions,
    replay: materializationResult(input, entry, template, matrix, true),
  };
}

function assertUniquePlannedUrls(
  workspaceId: string,
  matrix: ContentMatrix,
): void {
  const occupied = new Set<string>();
  for (const existing of listMatrices(workspaceId)) {
    if (existing.id === matrix.id) continue;
    for (const cell of existing.cells) {
      const canonical = canonicalizeMatrixPath(cell.plannedUrl);
      if (canonical) occupied.add(canonical);
    }
  }

  const planned = new Set<string>();
  for (const cell of matrix.cells) {
    const canonical = canonicalizeMatrixPath(cell.plannedUrl);
    if (!canonical || occupied.has(canonical) || planned.has(canonical)) {
      throw new PseoMatrixBridgeError(
        'precondition_failed',
        'url_collision',
        `Planned URL collision detected for "${cell.plannedUrl}".`,
      );
    }
    planned.add(canonical);
  }
}

function assertNoBlockingCannibalization(workspaceId: string, matrixId: string): void {
  if (!hasExactMatrixKeywordConflict(workspaceId, matrixId)) return;
  throw new PseoMatrixBridgeError(
    'precondition_failed',
    'keyword_cannibalization',
    'Exact keyword cannibalization blocks this planned matrix.',
  );
}

function mapMatrixDefinitionError(error: unknown): never {
  if (
    error instanceof ContentMatrixPatternRenderError
    || error instanceof MatrixGenerationSourceLimitError
    || error instanceof MatrixGenerationSchemaTypeContractError
  ) {
    throw new PseoMatrixBridgeError(
      'precondition_failed',
      'invalid_matrix_definition',
      error.message,
    );
  }
  throw error;
}

/**
 * Materialize one blueprint collection into one durable matrix. This performs
 * deterministic local validation and linking only; it never previews or starts
 * AI. The existing generation preflight remains authoritative for live-site URL
 * census and factual service/location evidence.
 */
export function createMatrixFromPseoPlan(
  input: CreatePseoMatrixFromPlanInput,
): PseoMatrixMaterializationResult {
  const write = db.transaction((): PseoMatrixMaterializationResult => {
    const current = preparePlan(input);
    if (current.replay) return current.replay;

    let matrix: ContentMatrix;
    try {
      matrix = createMatrix(input.workspaceId, {
        name: current.entry.name,
        templateId: current.template.id,
        dimensions: current.dimensions,
        urlPattern: current.template.urlPattern,
        keywordPattern: current.template.keywordPattern,
      }, { validateTemplate: true });
    } catch (error) {
      mapMatrixDefinitionError(error);
    }

    assertUniquePlannedUrls(input.workspaceId, matrix);
    assertNoBlockingCannibalization(input.workspaceId, matrix.id);
    const linked = updateEntry(input.workspaceId, input.blueprintId, input.entryId, {
      matrixId: matrix.id,
    });
    if (!linked) {
      throw new PseoMatrixBridgeError(
        'conflict',
        'source_not_found',
        'The blueprint entry changed before the matrix could be linked.',
      );
    }
    return materializationResult(input, linked, current.template, matrix, false);
  });

  return write.immediate();
}
