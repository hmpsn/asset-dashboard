import { Router } from 'express';
import type { Request, Response } from 'express';
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

router.post(
  '/client',
  mcpAuthMiddleware,
  async (req, res) => {
    try {
      await handleMcpRequest(req, res, MCP_SERVER_PROFILES.CLIENT);
    } catch (err) {
      log.error(
        {
          failureClass: err instanceof Error
            ? 'unhandled_client_request_error'
            : 'unhandled_client_request_non_error',
        },
        'Unhandled MCP client request error',
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

// Streamable HTTP clients open GET on an MCP endpoint to establish the
// OPTIONAL server→client SSE notification stream, and send DELETE to tear a
// session down. This server runs stateless JSON mode (enableJsonResponse, no
// sessionIdGenerator) and offers neither, so per the MCP Streamable HTTP spec it
// MUST answer 405.
//
// Without these handlers, GET/DELETE fall through to the SPA catch-all
// (`app.get('*')`) and return 200 + index.html. A client reads that non-SSE 200 as
// an instantly-closed stream and reconnects in a tight loop — flooding `GET /mcp`
// and exhausting the shared per-IP `${ip}:/mcp` rate-limit bucket, which then 429s
// legitimate POST tool calls from the same IP (e.g. the asset-manager feature).
// No auth middleware: the method is unsupported regardless of credentials.
function methodNotAllowed(_req: Request, res: Response): void {
  res.set('Allow', 'POST');
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. This MCP endpoint only accepts POST.' },
    id: null,
  });
}
router.get('/', methodNotAllowed);
router.delete('/', methodNotAllowed);
router.get('/operator', methodNotAllowed);
router.delete('/operator', methodNotAllowed);
router.get('/client', methodNotAllowed);
router.delete('/client', methodNotAllowed);

export default router;
