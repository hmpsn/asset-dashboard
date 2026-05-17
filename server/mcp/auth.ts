import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../logger.js';

const log = createLogger('mcp-auth');

export function mcpAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) {
    log.warn('MCP_API_KEY env var not set — rejecting all MCP requests');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = auth.slice(7);
  const expected = Buffer.from(apiKey);
  const provided = Buffer.from(token.padEnd(apiKey.length));
  const valid = expected.length === provided.length &&
    crypto.timingSafeEqual(expected, provided) &&
    token.length === apiKey.length;
  if (!valid) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
