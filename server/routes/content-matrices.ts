/**
 * Content Matrices — REST API routes for bulk content planning grids.
 */
import { Router } from 'express';
import {
  listMatrices,
  getMatrix,
  createMatrix,
  updateMatrix,
  updateMatrixCell,
  deleteMatrix,
  ContentMatrixRevisionConflictError,
  ContentMatrixRevisionRequiredError,
  ContentMatrixBulkCellWriteUnsupportedError,
  ContentMatrixSourceIntegrityError,
  ContentMatrixPatternRenderError,
  MatrixCellRevisionConflictError,
  MatrixCellRevisionRequiredError,
  MatrixTemplateIntegrityError,
} from '../content-matrices.js';
import { matrixCellSchema, matrixDimensionSchema } from '../content-matrix-read-model.js';
import { ContentTemplateRevisionConflictError } from '../content-templates.js';
import { getKeywordRecommendations } from '../keyword-recommendations.js';
import { detectMatrixCannibalization, checkKeywordCannibalization } from '../cannibalization-detection.js';
import { createLogger } from '../logger.js';
import { queueLlmsTxtRegeneration } from '../llms-txt-generator.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { invalidateContentPipelineIntelligence } from '../intelligence-freshness.js';
import {
  mutationError,
  runWorkspaceMutation,
  WorkspaceMutationError,
} from '../workspace-mutation-helper.js';

import { requireWorkspaceAccess } from '../auth.js';
import { InvalidTransitionError } from '../state-machines.js';
import { validate, z } from '../middleware/validate.js';
import {
  MATRIX_GENERATION_SOURCE_LIMITS,
  MatrixGenerationSchemaTypeContractError,
  MatrixGenerationSourceLimitError,
  matrixGenerationUtf8Bytes,
} from '../../shared/types/matrix-generation.js';

const log = createLogger('routes:content-matrices');
const router = Router();

function boundedUtf8String(limit: number, label: string, minimum = 0) {
  return z.string().min(minimum).refine(
    value => matrixGenerationUtf8Bytes(value) <= limit,
    `${label} exceeds the ${limit}-byte generation-source limit`,
  );
}

const boundedDimensionSchema = matrixDimensionSchema.extend({
  variableName: boundedUtf8String(
    MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxDimensionNameBytes,
    'variableName',
    1,
  ),
  values: z.array(boundedUtf8String(
    MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxDimensionValueBytes,
    'dimension value',
  )).max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxValuesPerDimension),
});

function addGeneratedCellProductIssue(
  value: { dimensions?: Array<{ values: string[] }> },
  ctx: z.RefinementCtx,
): void {
  if (!value.dimensions || value.dimensions.length === 0) return;
  let product = 1;
  for (const dimension of value.dimensions) {
    product *= dimension.values.length;
    if (product > MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxGeneratedCells) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dimensions'],
        message: `Dimensions generate more than ${MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxGeneratedCells} cells`,
      });
      return;
    }
  }
}

const createMatrixSchema = z.object({
  name: boundedUtf8String(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxNameBytes, 'name', 1),
  templateId: boundedUtf8String(
    MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxTemplateIdBytes,
    'templateId',
    1,
  ),
  dimensions: z.array(boundedDimensionSchema)
    .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxDimensions)
    .optional()
    .default([]),
  urlPattern: boundedUtf8String(
    MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxPatternBytes,
    'urlPattern',
  ).optional().default(''),
  keywordPattern: boundedUtf8String(
    MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxPatternBytes,
    'keywordPattern',
  ).optional().default(''),
}).superRefine(addGeneratedCellProductIssue);

const updateMatrixSchema = z.object({
  name: boundedUtf8String(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxNameBytes, 'name', 1).optional(),
  templateId: boundedUtf8String(
    MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxTemplateIdBytes,
    'templateId',
    1,
  ).optional(),
  dimensions: z.array(boundedDimensionSchema)
    .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxDimensions)
    .optional(),
  urlPattern: boundedUtf8String(
    MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxPatternBytes,
    'urlPattern',
  ).optional(),
  keywordPattern: boundedUtf8String(
    MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxPatternBytes,
    'keywordPattern',
  ).optional(),
  expectedMatrixRevision: z.number().int().nonnegative().optional(),
}).strict().superRefine((value, ctx) => {
  addGeneratedCellProductIssue(value, ctx);
  const changesDefinition = value.templateId !== undefined
    || value.dimensions !== undefined
    || value.urlPattern !== undefined
    || value.keywordPattern !== undefined;
  if (changesDefinition && value.expectedMatrixRevision === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expectedMatrixRevision'],
      message: 'Required for generation-effective matrix changes',
    });
  }
});

const updateMatrixCellSchema = matrixCellSchema
  .omit({ id: true, revision: true, statusHistory: true })
  .partial()
  .extend({
    expectedCellRevision: z.number().int().nonnegative(),
  });

/**
 * Map an illegal status transition (thrown by updateMatrix / updateMatrixCell via the cell state
 * machine) to a 409 with the machine's own message. Returning null defers to the default handling.
 */
function mapTransitionError(err: unknown): { status: number; error: string } | null {
  if (err instanceof InvalidTransitionError) {
    return { status: 409, error: err.message };
  }
  if (err instanceof ContentMatrixRevisionConflictError
    || err instanceof MatrixCellRevisionConflictError
    || err instanceof ContentTemplateRevisionConflictError) {
    return { status: 409, error: err.message };
  }
  if (err instanceof ContentMatrixRevisionRequiredError
    || err instanceof MatrixCellRevisionRequiredError
    || err instanceof ContentMatrixBulkCellWriteUnsupportedError
    || err instanceof ContentMatrixPatternRenderError) {
    return { status: 400, error: err.message };
  }
  if (err instanceof MatrixGenerationSourceLimitError) {
    return { status: 400, error: err.message };
  }
  if (err instanceof MatrixGenerationSchemaTypeContractError) {
    return { status: 400, error: err.message };
  }
  if (err instanceof MatrixTemplateIntegrityError) {
    return { status: 404, error: err.message };
  }
  if (err instanceof ContentMatrixSourceIntegrityError) {
    return { status: 422, error: err.message };
  }
  return null;
}

function notifyContentPlanUpdated(workspaceId: string, payload: Record<string, unknown>) {
  invalidateContentPipelineIntelligence(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, { domain: 'content-plan', ...payload });
}

// List all matrices for a workspace
router.get('/api/content-matrices/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const matrices = listMatrices(req.params.workspaceId);
    res.json(matrices);
  } catch (err) {
    if (err instanceof MatrixGenerationSourceLimitError) {
      return res.status(422).json({ error: err.message });
    }
    log.error({ err }, 'Failed to list matrices');
    res.status(500).json({ error: 'Failed to list matrices' });
  }
});

// Get a single matrix
router.get('/api/content-matrices/:workspaceId/:matrixId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const matrix = getMatrix(req.params.workspaceId, req.params.matrixId);
    if (!matrix) return res.status(404).json({ error: 'Matrix not found' });
    res.json(matrix);
  } catch (err) {
    if (err instanceof MatrixGenerationSourceLimitError) {
      return res.status(422).json({ error: err.message });
    }
    log.error({ err }, 'Failed to get matrix');
    res.status(500).json({ error: 'Failed to get matrix' });
  }
});

// Create a new matrix
router.post('/api/content-matrices/:workspaceId', requireWorkspaceAccess('workspaceId'), validate(createMatrixSchema), (req, res) => {
  const { name, templateId, dimensions, urlPattern, keywordPattern } = req.body;
  try {
    const matrix = runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to create matrix',
      mapError: mapTransitionError,
      mutate: ({ workspaceId }) => createMatrix(workspaceId, {
        name,
        templateId,
        dimensions: dimensions || [],
        urlPattern: urlPattern || '',
        keywordPattern: keywordPattern || '',
      }, { validateTemplate: true }),
      onActivity: ({ workspaceId, result }) => {
        addActivity(
          workspaceId,
          'content_updated',
          `Created content matrix "${result.name}"`,
          `${result.cells.length} planned page${result.cells.length === 1 ? '' : 's'}`,
          { matrixId: result.id, action: 'matrix_created' },
        );
      },
      onBroadcast: ({ workspaceId, result }) => {
        notifyContentPlanUpdated(workspaceId, { matrixId: result.id, action: 'matrix_created' });
      },
    });
    res.status(201).json(matrix);
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    const mapped = mapTransitionError(err);
    if (mapped) return res.status(mapped.status).json({ error: mapped.error });
    log.error({ err }, 'Failed to create matrix');
    res.status(500).json({ error: 'Failed to create matrix' });
  }
});

// Update a matrix (name, dimensions, patterns)
router.put('/api/content-matrices/:workspaceId/:matrixId', requireWorkspaceAccess('workspaceId'), validate(updateMatrixSchema), (req, res) => {
  try {
    const { expectedMatrixRevision, ...updates } = req.body;
    const updated = runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to update matrix',
      mapError: mapTransitionError,
      mutate: ({ workspaceId }) => {
        const next = updateMatrix(workspaceId, req.params.matrixId, updates, {
          expectedMatrixRevision,
        });
        if (!next) throw mutationError(404, 'Matrix not found');
        return next;
      },
      onActivity: ({ workspaceId, result }) => {
        addActivity(
          workspaceId,
          'content_updated',
          `Updated content matrix "${result.name}"`,
          undefined,
          { matrixId: result.id, action: 'matrix_updated' },
        );
      },
      onBroadcast: ({ workspaceId, result }) => {
        notifyContentPlanUpdated(workspaceId, { matrixId: result.id, action: 'matrix_updated' });
      },
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err }, 'Failed to update matrix');
    res.status(500).json({ error: 'Failed to update matrix' });
  }
});

// Update a single cell within a matrix
router.patch('/api/content-matrices/:workspaceId/:matrixId/cells/:cellId', requireWorkspaceAccess('workspaceId'), validate(updateMatrixCellSchema), (req, res) => {
  try {
    const { expectedCellRevision, ...updates } = req.body;
    const updated = runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to update matrix cell',
      mapError: mapTransitionError,
      readBeforeWrite: ({ workspaceId }) => getMatrix(workspaceId, req.params.matrixId),
      mutate: ({ workspaceId, existing }) => {
        if (!existing) throw mutationError(404, 'Matrix or cell not found');
        const next = updateMatrixCell(
          workspaceId,
          req.params.matrixId,
          req.params.cellId,
          updates,
          { expectedCellRevision, requireExpectedCellRevision: true },
        );
        if (!next) throw mutationError(404, 'Matrix or cell not found');
        return next;
      },
      onActivity: ({ workspaceId, existing, result }) => {
        const cell = result.cells.find(c => c.id === req.params.cellId);
        const previousCell = existing?.cells.find(c => c.id === req.params.cellId);
        if ((cell?.revision ?? 0) === (previousCell?.revision ?? 0)) return;
        const statusChanged = typeof updates.status === 'string';
        addActivity(
          workspaceId,
          'content_updated',
          `Updated content plan page "${cell?.targetKeyword || req.params.cellId}"`,
          statusChanged ? `Status: ${updates.status}` : undefined,
          {
            matrixId: result.id,
            cellId: req.params.cellId,
            action: 'matrix_cell_updated',
            status: cell?.status,
            changedFields: Object.keys(updates).sort(),
          },
        );
      },
      onBroadcast: ({ workspaceId, existing, result }) => {
        const cell = result.cells.find(c => c.id === req.params.cellId);
        const previousCell = existing?.cells.find(c => c.id === req.params.cellId);
        if ((cell?.revision ?? 0) === (previousCell?.revision ?? 0)) return;
        notifyContentPlanUpdated(workspaceId, {
          matrixId: result.id,
          cellId: req.params.cellId,
          action: 'matrix_cell_updated',
          status: cell?.status,
        });
      },
    });
    res.json(updated);

    // Regenerate llms.txt when a cell is marked published (new content is live)
    if (updates.status === 'published') {
      queueLlmsTxtRegeneration(req.params.workspaceId, 'content_published');
    }
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err }, 'Failed to update matrix cell');
    res.status(500).json({ error: 'Failed to update matrix cell' });
  }
});

// Get keyword recommendations for a cell's seed keyword
router.post('/api/content-matrices/:workspaceId/:matrixId/cells/:cellId/recommend-keywords', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const matrix = getMatrix(req.params.workspaceId, req.params.matrixId);
    if (!matrix) return res.status(404).json({ error: 'Matrix not found' });

    const cell = matrix.cells.find(c => c.id === req.params.cellId);
    if (!cell) return res.status(404).json({ error: 'Cell not found' });

    const seedKeyword = req.body.seedKeyword || cell.targetKeyword;
    const result = await getKeywordRecommendations(req.params.workspaceId, seedKeyword, {
      useAI: req.body.useAI ?? false,
      maxCandidates: req.body.maxCandidates ?? 15,
      includeReasoning: req.body.includeReasoning ?? false,
      excludeConflictIdentifiers: [cell.id],
    });
    res.json(result);
  } catch (err) {
    log.error({ err }, 'Failed to get keyword recommendations');
    res.status(500).json({ error: 'Failed to get keyword recommendations' });
  }
});

// Standalone keyword recommendations (not tied to a specific cell)
router.post('/api/content-matrices/:workspaceId/recommend-keywords', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { seedKeyword } = req.body;
  if (!seedKeyword) return res.status(400).json({ error: 'seedKeyword is required' });

  try {
    const result = await getKeywordRecommendations(req.params.workspaceId, seedKeyword, {
      useAI: req.body.useAI ?? false,
      maxCandidates: req.body.maxCandidates ?? 15,
      includeReasoning: req.body.includeReasoning ?? false,
    });
    res.json(result);
  } catch (err) {
    log.error({ err }, 'Failed to get keyword recommendations');
    res.status(500).json({ error: 'Failed to get keyword recommendations' });
  }
});

// Run cannibalization detection for all cells in a matrix
router.get('/api/content-matrices/:workspaceId/:matrixId/cannibalization', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const report = detectMatrixCannibalization(req.params.workspaceId, req.params.matrixId);
    res.json(report);
  } catch (err) {
    log.error({ err }, 'Failed to run cannibalization detection');
    res.status(500).json({ error: 'Failed to run cannibalization detection' });
  }
});

// Check a single keyword for cannibalization (standalone)
router.post('/api/content-matrices/:workspaceId/check-cannibalization', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { keyword } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  try {
    const conflicts = checkKeywordCannibalization(req.params.workspaceId, keyword);
    res.json({ keyword, conflicts, total: conflicts.length });
  } catch (err) {
    log.error({ err }, 'Failed to check keyword cannibalization');
    res.status(500).json({ error: 'Failed to check keyword cannibalization' });
  }
});

// Delete a matrix
router.delete('/api/content-matrices/:workspaceId/:matrixId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    runWorkspaceMutation({
      workspaceId: req.params.workspaceId,
      defaultErrorMessage: 'Failed to delete matrix',
      readBeforeWrite: ({ workspaceId }) => getMatrix(workspaceId, req.params.matrixId),
      mutate: ({ workspaceId, existing }) => {
        if (!existing) throw mutationError(404, 'Matrix not found');
        const deleted = deleteMatrix(workspaceId, req.params.matrixId);
        if (!deleted) throw mutationError(404, 'Matrix not found');
        return existing;
      },
      onActivity: ({ workspaceId, result }) => {
        addActivity(
          workspaceId,
          'content_updated',
          `Deleted content matrix "${result.name}"`,
          `${result.cells.length} planned page${result.cells.length === 1 ? '' : 's'} removed`,
          { matrixId: result.id, action: 'matrix_deleted' },
        );
      },
      onBroadcast: ({ workspaceId, result }) => {
        notifyContentPlanUpdated(workspaceId, { matrixId: result.id, action: 'matrix_deleted', deleted: true });
      },
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof WorkspaceMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err }, 'Failed to delete matrix');
    res.status(500).json({ error: 'Failed to delete matrix' });
  }
});

export default router;
