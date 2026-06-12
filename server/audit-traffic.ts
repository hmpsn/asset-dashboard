import { getGA4TopPages } from './google-analytics.js';
import { getAllGscPages } from './search-console.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';
import { normalizePageUrl } from './helpers.js';

const log = createLogger('audit-traffic');

const AUDIT_TRAFFIC_CACHE_TTL_MS = 5 * 60 * 1000;

export interface AuditTrafficWorkspace {
  id: string;
  webflowSiteId?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
}

export interface AuditTrafficMetrics {
  clicks: number;
  impressions: number;
  sessions: number;
  pageviews: number;
}

export type AuditTrafficMap = Record<string, AuditTrafficMetrics>;

const auditTrafficCache: Record<string, { data: AuditTrafficMap; ts: number }> = {};

function normalizeTrafficPath(value: string): string {
  return normalizePageUrl(value);
}

function normalizeGscPagePath(value: string): string | null {
  try {
    return normalizePageUrl(new URL(value).pathname);
  } catch (_err) {
    return null;
  }
}

export function clearAuditTrafficCache(): void {
  for (const key of Object.keys(auditTrafficCache)) delete auditTrafficCache[key];
}

export async function getAuditTrafficForWorkspace(
  ws: AuditTrafficWorkspace,
): Promise<AuditTrafficMap> {
  if (!ws.gscPropertyUrl && !ws.ga4PropertyId) return {};
  const cacheKey = ws.id;
  const cached = auditTrafficCache[cacheKey];
  if (cached && Date.now() - cached.ts < AUDIT_TRAFFIC_CACHE_TTL_MS) return cached.data;

  const trafficMap: AuditTrafficMap = {};

  if (ws.gscPropertyUrl && ws.webflowSiteId) {
    try {
      const gscPages = await getAllGscPages(ws.webflowSiteId, ws.gscPropertyUrl, 28);
      for (const p of gscPages) {
        const pagePath = normalizeGscPagePath(p.page);
        if (!pagePath) continue;
        if (!trafficMap[pagePath]) trafficMap[pagePath] = { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
        trafficMap[pagePath].clicks += p.clicks;
        trafficMap[pagePath].impressions += p.impressions;
      }
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err, workspaceId: ws.id }, 'audit-traffic: GSC programming error');
      else log.debug({ err, workspaceId: ws.id }, 'audit-traffic: GSC unavailable — degrading gracefully');
    }
  }

  if (ws.ga4PropertyId) {
    try {
      const ga4Pages = await getGA4TopPages(ws.ga4PropertyId, 28, 500);
      for (const p of ga4Pages) {
        const pagePath = normalizeTrafficPath(p.path);
        if (!trafficMap[pagePath]) trafficMap[pagePath] = { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
        trafficMap[pagePath].pageviews += p.pageviews;
        trafficMap[pagePath].sessions += p.sessions;
      }
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err, workspaceId: ws.id }, 'audit-traffic: GA4 programming error');
      else log.debug({ err, workspaceId: ws.id }, 'audit-traffic: GA4 unavailable — degrading gracefully');
    }
  }

  auditTrafficCache[cacheKey] = { data: trafficMap, ts: Date.now() };
  return trafficMap;
}
