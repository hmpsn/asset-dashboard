/**
 * Content Plan Review — client-facing endpoints for tiered content plan review.
 *
 * Provides:
 * 1. Public matrix progress view (read-only for clients)
 * 2. Admin: send template for client review (creates approval batch)
 * 3. Admin: send sample cells to client (creates content requests)
 * 4. Client: batch approve remaining cells after samples approved
 * 5. Client: flag individual cells for changes
 */
import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { getMatrix, listMatrices } from '../content-matrices.js';
import { getTemplate } from '../content-templates.js';
import { getWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';
import { validate, z } from '../middleware/validate.js';
import { requireAuthenticatedClientPortalAuth, requireClientPortalAuth } from '../middleware.js';
import type { ContentMatrix, MatrixCell } from '../../shared/types/content.ts';
import {
  batchApproveMatrixCells,
  ContentPlanReviewMutationError,
  flagMatrixCell,
  sendSamplesForReview,
  sendTemplateForReview,
} from '../domains/content-plan/review-mutations.js';

const log = createLogger('routes:content-plan-review');
const router = Router();

const CLIENT_VISIBLE_CELL_STATUSES = new Set(['review', 'flagged', 'approved', 'published']);

const sendSamplesSchema = z.object({
  cellIds: z.array(z.string().trim().min(1)).min(1, 'cellIds array is required'),
}).strict();

function clientVisibleCells(cells: MatrixCell[]): MatrixCell[] {
  return cells.filter(c => CLIENT_VISIBLE_CELL_STATUSES.has(c.status));
}

function serializeClientMatrix(matrix: ContentMatrix, cells: MatrixCell[], extra: Record<string, unknown> = {}) {
  return {
    id: matrix.id,
    name: matrix.name,
    stats: {
      total: cells.length,
      planned: 0,
      briefGenerated: 0,
      drafted: 0,
      reviewed: cells.filter(c => c.status === 'review' || c.status === 'flagged' || c.status === 'approved').length,
      published: cells.filter(c => c.status === 'published').length,
    },
    dimensions: matrix.dimensions.map(d => ({ name: d.variableName, values: d.values })),
    cells: cells.map(c => ({
      id: c.id,
      targetKeyword: c.targetKeyword,
      plannedUrl: c.plannedUrl,
      status: c.status,
      variableValues: c.variableValues,
      clientFlag: c.clientFlag,
      clientFlaggedAt: c.clientFlaggedAt,
      hasBrief: !!c.briefId,
      hasPost: !!c.postId,
    })),
    createdAt: matrix.createdAt,
    ...extra,
  };
}

// ── Public endpoints (client portal) ──

router.use('/api/public/content-plan/:workspaceId', requireClientPortalAuth('workspaceId'));

/**
 * GET /api/public/content-plan/:workspaceId
 * Returns a summary of all matrices for the client — read-only progress view.
 * Omits internal IDs and implementation details.
 */
router.get('/api/public/content-plan/:workspaceId', (req, res) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const matrices = listMatrices(req.params.workspaceId);
    const clientView = matrices
      .map(m => ({ matrix: m, cells: clientVisibleCells(m.cells) }))
      .filter(({ cells }) => cells.length > 0)
      .map(({ matrix, cells }) => serializeClientMatrix(matrix, cells));

    res.json(clientView);
  } catch (err) {
    log.error({ err }, 'Failed to get client content plan');
    res.status(500).json({ error: 'Failed to get content plan' });
  }
});

/**
 * GET /api/public/content-plan/:workspaceId/:matrixId
 * Returns a single matrix progress for the client.
 */
router.get('/api/public/content-plan/:workspaceId/:matrixId', (req, res) => {
  try {
    const matrix = getMatrix(req.params.workspaceId, req.params.matrixId);
    if (!matrix) return res.status(404).json({ error: 'Content plan not found' });

    const template = getTemplate(req.params.workspaceId, matrix.templateId);

    const cells = clientVisibleCells(matrix.cells);
    if (!cells.length) return res.json(null);

    res.json(serializeClientMatrix(matrix, cells, {
      templateName: template?.name ?? null,
      templatePageType: template?.pageType ?? null,
    }));
  } catch (err) {
    log.error({ err }, 'Failed to get client matrix view');
    res.status(500).json({ error: 'Failed to get content plan' });
  }
});

/**
 * POST /api/public/content-plan/:workspaceId/:matrixId/cells/:cellId/flag
 * Client flags a specific cell for changes with a comment.
 */
router.post(
  '/api/public/content-plan/:workspaceId/:matrixId/cells/:cellId/flag',
  requireAuthenticatedClientPortalAuth('workspaceId'),
  validate(z.object({ comment: z.string().trim().min(1, 'comment is required').max(2000) })),
  (req, res) => {
  const { comment } = req.body;

  try {
    flagMatrixCell(req.params.workspaceId, req.params.matrixId, req.params.cellId, comment);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ContentPlanReviewMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err }, 'Failed to flag cell');
    res.status(500).json({ error: 'Failed to flag cell' });
  }
});

// ── Admin endpoints ──

/**
 * POST /api/content-plan/:workspaceId/:matrixId/send-template-review
 * Sends the template for client review by creating an approval batch
 * with the template structure as the approval item.
 */
router.post('/api/content-plan/:workspaceId/:matrixId/send-template-review', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const { batch } = sendTemplateForReview(req.params.workspaceId, req.params.matrixId);
    res.json({ batchId: batch.id, batch });
  } catch (err) {
    if (err instanceof ContentPlanReviewMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err }, 'Failed to send template for review');
    res.status(500).json({ error: 'Failed to send template for review' });
  }
});

/**
 * POST /api/content-plan/:workspaceId/:matrixId/send-samples
 * Admin selects specific cell IDs to send as sample briefs for client review.
 * Creates an approval batch with the selected cells' keyword + URL info.
 */
router.post('/api/content-plan/:workspaceId/:matrixId/send-samples', requireWorkspaceAccess('workspaceId'), validate(sendSamplesSchema), (req, res) => {
  const { cellIds } = req.body as { cellIds: string[] };

  try {
    const { batch, cellsSent } = sendSamplesForReview(req.params.workspaceId, req.params.matrixId, cellIds);
    res.json({ batchId: batch.id, batch, cellsSent });
  } catch (err) {
    if (err instanceof ContentPlanReviewMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err }, 'Failed to send samples for review');
    res.status(500).json({ error: 'Failed to send samples for review' });
  }
});

/**
 * POST /api/content-plan/:workspaceId/:matrixId/batch-approve
 * After samples are approved, batch-approve all remaining planned/keyword_validated cells.
 * Moves them to 'approved' status so brief generation can proceed.
 */
router.post('/api/content-plan/:workspaceId/:matrixId/batch-approve', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const { approvedCount, totalCells } = batchApproveMatrixCells(req.params.workspaceId, req.params.matrixId);
    res.json({ ok: true, approvedCount, totalCells });
  } catch (err) {
    if (err instanceof ContentPlanReviewMutationError) {
      return res.status(err.status).json({ error: err.message });
    }
    log.error({ err }, 'Failed to batch approve cells');
    res.status(500).json({ error: 'Failed to batch approve' });
  }
});

export default router;
