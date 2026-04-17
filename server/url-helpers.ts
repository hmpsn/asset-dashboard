/**
 * URL utility helpers for workspace base-URL resolution.
 * Kept in a separate module from helpers.ts to avoid a circular dependency
 * (webflow-pages.ts already imports resolvePagePath from helpers.ts).
 */
import { getSiteSubdomain } from './webflow-pages.js';
import { createLogger } from './logger.js';

const log = createLogger('url-helpers');

/**
 * Resolve the base URL for a workspace — either its custom live domain or
 * its Webflow staging subdomain. Returns empty string if neither is available.
 * Pass `tokenOverride` when the caller has a workspace-specific Webflow token.
 */
export async function resolveBaseUrl(
  ws: { liveDomain?: string | null; webflowSiteId?: string | null },
  tokenOverride?: string,
): Promise<string> {
  if (ws.liveDomain) {
    return ws.liveDomain.startsWith('http') ? ws.liveDomain : `https://${ws.liveDomain}`;
  }
  if (ws.webflowSiteId) {
    try {
      const sub = await getSiteSubdomain(ws.webflowSiteId, tokenOverride);
      if (sub) return `https://${sub}.webflow.io`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Expected when no token is configured — log at debug only
      if (msg.includes('not configured')) {
        log.debug({ siteId: ws.webflowSiteId }, 'resolveBaseUrl: no Webflow token, returning empty');
      } else {
        log.warn({ siteId: ws.webflowSiteId, err: msg }, 'resolveBaseUrl: subdomain lookup failed, returning empty');
      }
    }
  }
  return '';
}
