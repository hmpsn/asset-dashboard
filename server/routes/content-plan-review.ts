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
import { getMatrix, listMatrices, updateMatrixCell } from '../content-matrices.js';
import { getTemplate } from '../content-templates.js';
import { createBatch } from '../approvals.js';
import { getWorkspace } from '../workspaces.js';
import { createLogger } from '../logger.js';

const log = createLogger('routes:content-plan-review');
import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

// ── Public endpoints (client portal) ──

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
    const clientView = matrices.map(m => ({
      id: m.id,
      name: m.name,
      stats: m.stats,
      dimensions: m.dimensions.map(d => ({ name: d.variableName, values: d.values })),
      cells: m.cells.map(c => ({
        id: c.id,
        targetKeyword: c.targetKeyword,
        plannedUrl: c.plannedUrl,
        status: c.status,
        variableValues: c.variableValues,
        hasBrief: !!c.briefId,
        hasPost: !!c.postId,
      })),
      createdAt: m.createdAt,
    }));

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

    res.json({
      id: matrix.id,
      name: matrix.name,
      templateName: template?.name ?? null,
      templatePageType: template?.pageType ?? null,
      stats: matrix.stats,
      dimensions: matrix.dimensions.map(d => ({ name: d.variableName, values: d.values })),
      cells: matrix.cells.map(c => ({
        id: c.id,
        targetKeyword: c.targetKeyword,
        plannedUrl: c.plannedUrl,
        status: c.status,
        variableValues: c.variableValues,
        hasBrief: !!c.briefId,
        hasPost: !!c.postId,
      })),
      createdAt: matrix.createdAt,
    });
  } catch (err) {
    log.error({ err }, 'Failed to get client matrix view');
    res.status(500).json({ error: 'Failed to get content plan' });
  }
});

/**
 * POST /api/public/content-plan/:workspaceId/:matrixId/cells/:cellId/flag
 * Client flags a specific cell for changes with a comment.
 */
router.post('/api/public/content-plan/:workspaceId/:matrixId/cells/:cellId/flag', (req, res) => {
  const { comment } = req.body;
  if (!comment) return res.status(400).json({ error: 'comment is required' });

  try {
    const updated = updateMatrixCell(
      req.params.workspaceId,
      req.params.matrixId,
      req.params.cellId,
      { clientFlag: comment, clientFlaggedAt: new Date().toISOString() },
    );
    if (!updated) return res.status(404).json({ error: 'Cell not found' });

    log.info({ workspaceId: req.params.workspaceId, matrixId: req.params.matrixId, cellId: req.params.cellId }, 'Client flagged cell');
    res.json({ ok: true });
  } catch (err) {
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
    const matrix = getMatrix(req.params.workspaceId, req.params.matrixId);
    if (!matrix) return res.status(404).json({ error: 'Matrix not found' });

    const template = getTemplate(req.params.workspaceId, matrix.templateId);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    // Build template summary for client review
    const sectionSummary = (template.sections || [])
      .map((s, i) => `${i + 1}. ${s.headingTemplate} (${s.wordCountTarget || '~500'} words)`)
      .join('\n');

    const templateDescription = [
      `Page Type: ${template.pageType}`,
      `URL Pattern: ${template.urlPattern || 'N/A'}`,
      `Keyword Pattern: ${template.keywordPattern || 'N/A'}`,
      `Variables: ${(template.variables || []).map(v => v.name).join(', ') || 'None'}`,
      `\nSections:\n${sectionSummary}`,
      template.toneAndStyle ? `\nTone & Style: ${template.toneAndStyle}` : '',
    ].filter(Boolean).join('\n');

    const batch = createBatch(
      req.params.workspaceId,
      ws.webflowSiteId || '',
      `Content Plan: ${matrix.name} — Template Review`,
      [{
        pageId: matrix.id,
        pageTitle: `Template: ${template.name}`,
        pageSlug: `content-plan-template-${matrix.id}`,
        field: 'content_plan_template',
        currentValue: '',
        proposedValue: templateDescription,
      }],
    );

    log.info({ workspaceId: req.params.workspaceId, matrixId: matrix.id, batchId: batch.id }, 'Template sent for client review');
    res.json({ batchId: batch.id, batch });
  } catch (err) {
    log.error({ err }, 'Failed to send template for review');
    res.status(500).json({ error: 'Failed to send template for review' });
  }
});

/**
 * POST /api/content-plan/:workspaceId/:matrixId/send-samples
 * Admin selects specific cell IDs to send as sample briefs for client review.
 * Creates an approval batch with the selected cells' keyword + URL info.
 */
router.post('/api/content-plan/:workspaceId/:matrixId/send-samples', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { cellIds } = req.body as { cellIds?: string[] };
  if (!cellIds?.length) return res.status(400).json({ error: 'cellIds array is required' });

  try {
    const matrix = getMatrix(req.params.workspaceId, req.params.matrixId);
    if (!matrix) return res.status(404).json({ error: 'Matrix not found' });

    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const selectedCells = matrix.cells.filter(c => cellIds.includes(c.id));
    if (!selectedCells.length) return res.status(400).json({ error: 'No matching cells found' });

    const items = selectedCells.map(cell => ({
      pageId: cell.id,
      pageTitle: cell.targetKeyword,
      pageSlug: cell.plannedUrl || cell.id,
      field: 'content_plan_sample',
      currentValue: '',
      proposedValue: [
        `Keyword: ${cell.targetKeyword}`,
        `Planned URL: ${cell.plannedUrl || 'TBD'}`,
        cell.variableValues ? `Variables: ${Object.entries(cell.variableValues).map(([k, v]) => `${k}=${v}`).join(', ')}` : '',
        cell.keywordValidation ? `Volume: ${cell.keywordValidation.volume}, KD: ${cell.keywordValidation.difficulty}` : '',
      ].filter(Boolean).join('\n'),
    }));

    const batch = createBatch(
      req.params.workspaceId,
      ws.webflowSiteId || '',
      `Content Plan: ${matrix.name} — Sample Review (${selectedCells.length} pages)`,
      items,
    );

    // Update cell statuses to review
    for (const cell of selectedCells) {
      updateMatrixCell(req.params.workspaceId, req.params.matrixId, cell.id, { status: 'review' });
    }

    log.info({ workspaceId: req.params.workspaceId, matrixId: matrix.id, batchId: batch.id, cellCount: selectedCells.length }, 'Samples sent for client review');
    res.json({ batchId: batch.id, batch, cellsSent: selectedCells.length });
  } catch (err) {
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
    const matrix = getMatrix(req.params.workspaceId, req.params.matrixId);
    if (!matrix) return res.status(404).json({ error: 'Matrix not found' });

    const approvable = ['planned', 'keyword_validated', 'brief_generated'];
    const cellsToApprove = matrix.cells.filter(c => approvable.includes(c.status));

    let approvedCount = 0;
    for (const cell of cellsToApprove) {
      updateMatrixCell(req.params.workspaceId, req.params.matrixId, cell.id, { status: 'approved' });
      approvedCount++;
    }

    log.info({ workspaceId: req.params.workspaceId, matrixId: matrix.id, approvedCount }, 'Batch approved remaining cells');
    res.json({ ok: true, approvedCount, totalCells: matrix.cells.length });
  } catch (err) {
    log.error({ err }, 'Failed to batch approve cells');
    res.status(500).json({ error: 'Failed to batch approve' });
  }
});

export default router;
