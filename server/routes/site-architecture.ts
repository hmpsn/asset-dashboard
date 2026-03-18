/**
 * Site Architecture Planner routes.
 *
 * GET /api/site-architecture/:workspaceId — build and return the full URL tree
 */
import { Router } from 'express';
import { buildSiteArchitecture } from '../site-architecture.js';
import { createLogger } from '../logger.js';

const log = createLogger('routes:site-architecture');
const router = Router();

router.get('/api/site-architecture/:workspaceId', async (req, res) => {
  try {
    const result = await buildSiteArchitecture(req.params.workspaceId);
    res.json(result);
  } catch (err) {
    log.error({ err }, 'Failed to build site architecture');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

export default router;
