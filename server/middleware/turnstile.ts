/**
 * Cloudflare Turnstile server-side verification middleware.
 * Validates the turnstile token sent by the frontend.
 * Skips verification if TURNSTILE_SECRET_KEY is not set (backward compatible).
 */
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../logger.js';

const log = createLogger('turnstile');

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Express middleware that verifies a Cloudflare Turnstile token.
 * Expects `turnstileToken` in the request body.
 * If TURNSTILE_SECRET_KEY is not configured, the middleware is a no-op.
 */
export function verifyTurnstile(req: Request, res: Response, next: NextFunction): void {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    // Turnstile not configured — skip verification
    return next();
  }

  const token = req.body?.turnstileToken;
  if (!token) {
    res.status(400).json({ error: 'CAPTCHA verification required' });
    return;
  }

  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: secretKey,
      response: token,
      remoteip: ip,
    }),
  })
    .then(r => r.json() as Promise<{ success: boolean; 'error-codes'?: string[] }>)
    .then(result => {
      if (result.success) {
        return next();
      }
      log.warn({ ip, errors: result['error-codes'], fingerprint: req.fingerprint }, 'Turnstile verification failed');
      res.status(403).json({ error: 'CAPTCHA verification failed. Please try again.' });
    })
    .catch(err => {
      log.error({ err }, 'Turnstile API request failed');
      // Fail open — don't block users if Turnstile API is down
      next();
    });
}
