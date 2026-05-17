import { Router } from 'express';
import { mcpAuthMiddleware } from './auth.js';
import { handleMcpRequest } from './server.js';
import { createLogger } from '../logger.js';

const log = createLogger('mcp');
const router = Router();

router.post('/', mcpAuthMiddleware, async (req, res) => {
  try {
    await handleMcpRequest(req, res);
  } catch (err) {
    log.error({ err }, 'Unhandled MCP request error');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
