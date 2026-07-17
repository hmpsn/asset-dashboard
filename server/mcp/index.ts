import { Router } from 'express';
import { MCP_SERVER_PROFILES } from '../../shared/types/mcp-runtime.js';
import {
  mcpAuthMiddleware,
  mcpMasterKeyOnlyMiddleware,
} from './auth.js';
import { handleMcpRequest } from './server.js';
import { createLogger } from '../logger.js';

const log = createLogger('mcp');
const router = Router();

router.post(
  '/operator',
  mcpAuthMiddleware,
  mcpMasterKeyOnlyMiddleware,
  async (req, res) => {
    try {
      await handleMcpRequest(req, res, MCP_SERVER_PROFILES.OPERATOR);
    } catch (err) {
      log.error(
        {
          failureClass: err instanceof Error
            ? 'unhandled_operator_request_error'
            : 'unhandled_operator_request_non_error',
        },
        'Unhandled MCP operator request error',
      );
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  },
);

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
