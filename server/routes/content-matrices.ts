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
} from '../content-matrices.js';
import { createLogger } from '../logger.js';

const log = createLogger('routes:content-matrices');
const router = Router();

// List all matrices for a workspace
router.get('/api/content-matrices/:workspaceId', (req, res) => {
  try {
    const matrices = listMatrices(req.params.workspaceId);
    res.json(matrices);
  } catch (err) {
    log.error({ err }, 'Failed to list matrices');
    res.status(500).json({ error: 'Failed to list matrices' });
  }
});

// Get a single matrix
router.get('/api/content-matrices/:workspaceId/:matrixId', (req, res) => {
  try {
    const matrix = getMatrix(req.params.workspaceId, req.params.matrixId);
    if (!matrix) return res.status(404).json({ error: 'Matrix not found' });
    res.json(matrix);
  } catch (err) {
    log.error({ err }, 'Failed to get matrix');
    res.status(500).json({ error: 'Failed to get matrix' });
  }
});

// Create a new matrix
router.post('/api/content-matrices/:workspaceId', (req, res) => {
  const { name, templateId, dimensions, urlPattern, keywordPattern } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!templateId) return res.status(400).json({ error: 'templateId is required' });

  try {
    const matrix = createMatrix(req.params.workspaceId, {
      name,
      templateId,
      dimensions: dimensions || [],
      urlPattern: urlPattern || '',
      keywordPattern: keywordPattern || '',
    });
    res.status(201).json(matrix);
  } catch (err) {
    log.error({ err }, 'Failed to create matrix');
    res.status(500).json({ error: 'Failed to create matrix' });
  }
});

// Update a matrix (name, dimensions, patterns)
router.put('/api/content-matrices/:workspaceId/:matrixId', (req, res) => {
  try {
    const updated = updateMatrix(req.params.workspaceId, req.params.matrixId, req.body);
    if (!updated) return res.status(404).json({ error: 'Matrix not found' });
    res.json(updated);
  } catch (err) {
    log.error({ err }, 'Failed to update matrix');
    res.status(500).json({ error: 'Failed to update matrix' });
  }
});

// Update a single cell within a matrix
router.patch('/api/content-matrices/:workspaceId/:matrixId/cells/:cellId', (req, res) => {
  try {
    const updated = updateMatrixCell(
      req.params.workspaceId,
      req.params.matrixId,
      req.params.cellId,
      req.body,
    );
    if (!updated) return res.status(404).json({ error: 'Matrix or cell not found' });
    res.json(updated);
  } catch (err) {
    log.error({ err }, 'Failed to update matrix cell');
    res.status(500).json({ error: 'Failed to update matrix cell' });
  }
});

// Delete a matrix
router.delete('/api/content-matrices/:workspaceId/:matrixId', (req, res) => {
  try {
    const deleted = deleteMatrix(req.params.workspaceId, req.params.matrixId);
    if (!deleted) return res.status(404).json({ error: 'Matrix not found' });
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, 'Failed to delete matrix');
    res.status(500).json({ error: 'Failed to delete matrix' });
  }
});

export default router;
