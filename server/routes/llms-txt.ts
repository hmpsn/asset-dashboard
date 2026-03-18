/**
 * LLMs.txt Generator routes.
 *
 * GET /api/llms-txt/:workspaceId          — generate and return as JSON { content, pageCount, generatedAt }
 * GET /api/llms-txt/:workspaceId/download — generate and download as .txt file
 */
import { Router } from 'express';
import { generateLlmsTxt } from '../llms-txt-generator.js';
import { createLogger } from '../logger.js';

const log = createLogger('routes:llms-txt');
const router = Router();

router.get('/api/llms-txt/:workspaceId', async (req, res) => {
  try {
    const result = await generateLlmsTxt(req.params.workspaceId);
    res.json(result);
  } catch (err) {
    log.error({ err }, 'Failed to generate LLMs.txt');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

router.get('/api/llms-txt/:workspaceId/download', async (req, res) => {
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

export default router;
