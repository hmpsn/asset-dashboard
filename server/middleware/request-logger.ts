import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import logger from '../logger.js';
import { recordOperationTrace, recordSlowRouteTelemetry } from '../platform-observability.js';

const reqLog = logger.child({ module: 'http' });
const SLOW_ROUTE_THRESHOLD_MS = 1_500;

function getTelemetryRoutePath(req: Request): string {
  const routePath = typeof req.route?.path === 'string' ? req.route.path : '';
  if (!routePath) return req.path;
  const baseUrl = req.baseUrl || '';
  return `${baseUrl}${routePath}`;
}

function getWorkspaceIdForTelemetry(req: Request): string | undefined {
  const params = req.params as { workspaceId?: string; id?: string };
  if (typeof params.workspaceId === 'string' && params.workspaceId.length > 0) return params.workspaceId;

  const routePath = typeof req.route?.path === 'string' ? req.route.path : '';
  if (routePath.includes('workspace') && typeof params.id === 'string' && params.id.length > 0) return params.id;

  const queryWorkspaceId = req.query?.workspaceId;
  if (typeof queryWorkspaceId === 'string' && queryWorkspaceId.length > 0) return queryWorkspaceId;

  const bodyWorkspaceId = (req.body as { workspaceId?: unknown } | undefined)?.workspaceId;
  if (typeof bodyWorkspaceId === 'string' && bodyWorkspaceId.length > 0) return bodyWorkspaceId;

  return undefined;
}

/**
 * Express middleware that:
 * 1. Assigns a unique requestId to every request.
 * 2. Logs request start + completion with duration.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  const start = Date.now();

  // Attach to request for downstream consumers
  (req as unknown as Record<string, unknown>).requestId = requestId;

  // Set response header so callers can correlate
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    reqLog[level](
      { requestId, method: req.method, path: req.originalUrl, status: res.statusCode, duration },
      `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`,
    );

    if (duration >= SLOW_ROUTE_THRESHOLD_MS) {
      const workspaceId = getWorkspaceIdForTelemetry(req);
      const telemetryPath = getTelemetryRoutePath(req);

      recordSlowRouteTelemetry({
        method: req.method,
        path: telemetryPath,
        statusCode: res.statusCode,
        durationMs: duration,
        workspaceId,
      });
      recordOperationTrace({
        source: 'http',
        operation: `${req.method} ${telemetryPath}`,
        status: res.statusCode >= 500 ? 'error' : 'warning',
        durationMs: duration,
        workspaceId,
        message: `Slow route (${duration}ms)`,
      });
    }
  });

  next();
}
