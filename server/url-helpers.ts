/**
 * URL utility helpers for workspace base-URL resolution.
 * Kept in a separate module from helpers.ts to avoid a circular dependency
 * (webflow-pages.ts already imports resolvePagePath from helpers.ts).
 */
import { getSiteSubdomain } from './webflow-pages.js';

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
    } catch { /* token missing or network failure — fall through to empty string */ }
  }
  return '';
}
