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
  if (token !== apiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
