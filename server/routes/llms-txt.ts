/**
 * LLMs.txt Generator routes.
 *
 * GET /api/llms-txt/:workspaceId              — generate and return JSON { content, fullContent, pageCount, generatedAt }
 * GET /api/llms-txt/:workspaceId/download     — generate and download llms.txt (index)
 * GET /api/llms-txt/:workspaceId/download-full — generate and download llms-full.txt (with AI summaries)
 */
import { Router } from 'express';
import { generateLlmsTxt, getLastGenerated } from '../llms-txt-generator.js';
import { createLogger } from '../logger.js';

const log = createLogger('routes:llms-txt');
import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

router.get('/api/llms-txt/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const result = await generateLlmsTxt(req.params.workspaceId);
    res.json(result);
  } catch (err) {
    log.error({ err }, 'Failed to generate LLMs.txt');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

router.get('/api/llms-txt/:workspaceId/download', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const result = await generateLlmsTxt(req.params.workspaceId);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="llms.txt"');
    res.send(result.content);
  } catch (err) {
    log.error({ err }, 'Failed to download LLMs.txt');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

router.get('/api/llms-txt/:workspaceId/download-full', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const result = await generateLlmsTxt(req.params.workspaceId);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="llms-full.txt"');
    res.send(result.fullContent);
  } catch (err) {
    log.error({ err }, 'Failed to download llms-full.txt');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// Freshness check — returns only the last generation timestamp (fast, no regeneration)
router.get('/api/llms-txt/:workspaceId/freshness', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const lastGeneratedAt = getLastGenerated(req.params.workspaceId);
    res.json({ lastGeneratedAt });
  } catch (err) {
    log.error({ err }, 'Failed to get LLMs.txt freshness');
    res.status(500).json({ error: 'Failed to get freshness' });
  }
});

export default router;
