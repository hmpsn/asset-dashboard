/**
 * Request fingerprinting middleware.
 * Hashes User-Agent + Accept-Language + IP to create a device fingerprint.
 * Used alongside IP for rate limiting to detect IP rotation attacks.
 */
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      fingerprint?: string;
    }
  }
}

/** Compute a SHA-256 fingerprint from request headers + IP. */
function computeFingerprint(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';
  const lang = req.headers['accept-language'] || '';
  return crypto.createHash('sha256').update(`${ip}:${ua}:${lang}`).digest('hex').slice(0, 16);
}

/** Express middleware that attaches req.fingerprint for downstream use. */
export function fingerprintMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.fingerprint = computeFingerprint(req);
  next();
}
