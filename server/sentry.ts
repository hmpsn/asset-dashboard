import * as Sentry from '@sentry/node';
import type { Express } from 'express';

const DSN = process.env.SENTRY_DSN;

/** Whether Sentry is configured (SENTRY_DSN is set). */
export const isSentryEnabled = !!DSN;

/** Initialize Sentry for the server. No-op if SENTRY_DSN is not set. */
export function initSentry(): void {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    beforeSend(event) {
      // Try to attach workspaceId from the request URL
      const url = event.request?.url;
      if (url) {
        const match = url.match(/\/api\/(?:public\/)?[^/]+\/([^/?]+)/);
        if (match) {
          event.tags = { ...event.tags, workspaceId: match[1] };
        }
      }
      return event;
    },
  });
}

/** Wire Sentry error handler into Express (must be called after all route mounts). */
export function setupSentryErrorHandler(app: Express): void {
  if (!DSN) return;
  Sentry.setupExpressErrorHandler(app);
}

export { Sentry };
