import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import logger from '../logger.js';

const reqLog = logger.child({ module: 'http' });

/**
 * Express middleware that:
 * 1. Assigns a unique requestId to every request.
 * 2. Logs request start + completion with duration.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  const start = Date.now();

  // Attach to request for downstream consumers
  (req as Record<string, unknown>).requestId = requestId;

  // Set response header so callers can correlate
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    reqLog[level](
      { requestId, method: req.method, path: req.originalUrl, status: res.statusCode, duration },
      `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`,
    );
  });

  next();
}
