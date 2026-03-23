/**
 * Content Decay routes — analyze decaying content, generate refresh recommendations
 */
import { Router } from 'express';
import { analyzeContentDecay, loadDecayAnalysis, generateBatchRecommendations } from '../content-decay.js';
import { getWorkspace } from '../workspaces.js';

import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

// Run decay analysis for a workspace
router.post('/api/content-decay/:workspaceId/analyze', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const analysis = await analyzeContentDecay(ws);
    res.json(analysis);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// Get cached decay analysis
router.get('/api/content-decay/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const analysis = loadDecayAnalysis(req.params.workspaceId);
  if (!analysis) return res.json(null);
  res.json(analysis);
});

// Generate AI refresh recommendations for top decaying pages
router.post('/api/content-decay/:workspaceId/recommendations', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const existing = loadDecayAnalysis(req.params.workspaceId);
    if (!existing) return res.status(404).json({ error: 'Run decay analysis first' });
    const maxPages = req.body.maxPages || 5;
    const updated = await generateBatchRecommendations(ws, existing, maxPages);
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// Public: Get decay analysis (client dashboard)
router.get('/api/public/content-decay/:workspaceId', (req, res) => {
  const analysis = loadDecayAnalysis(req.params.workspaceId);
  if (!analysis) return res.json(null);
  res.json(analysis);
});

export default router;
