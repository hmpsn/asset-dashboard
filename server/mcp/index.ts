import { Router } from 'express';
import { mcpAuthMiddleware } from './auth.js';
import { handleMcpRequest } from './server.js';

const router = Router();

router.post('/', mcpAuthMiddleware, async (req, res) => {
  try {
    await handleMcpRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
