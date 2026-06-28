import type { SchemaContext } from './suggestion-types.js';
import { createLogger } from '../logger.js';
import { getWorkspaceBySiteId } from '../workspaces.js';
import { getDeclinedKeywords } from '../keyword-feedback.js';
import { listSites } from '../webflow-pages.js';
import { buildSchemaIntelligence } from '../schema-intelligence.js';

const log = createLogger('schema-context-builder');

const SCHEMA_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;

const sitesCache: Record<string, {
  sites: Array<{ id: string; displayName: string; shortName: string; defaultLocale: string }>;
  ts: number;
}> = {};

async function listSitesCached(
  tokenOverride?: string,
): Promise<Array<{ id: string; displayName: string; shortName: string; defaultLocale: string }>> {
  const key = tokenOverride ?? '';
  const cached = sitesCache[key];
  if (cached && Date.now() - cached.ts < SCHEMA_CONTEXT_CACHE_TTL_MS) return cached.sites;
  const sites = await listSites(tokenOverride);
  sitesCache[key] = { sites, ts: Date.now() };
  return sites;
}

export async function buildSchemaContext(
  siteId: string,
): Promise<{
  ctx: SchemaContext;
}> {
  const ws = getWorkspaceBySiteId(siteId);
  const ctx: SchemaContext = {};
  let schemaIntel: Awaited<ReturnType<typeof buildSchemaIntelligence>> | null = null;
  if (ws) {
    ctx.companyName = ws.name;
    ctx.liveDomain = ws.liveDomain;

    try {
      schemaIntel = await buildSchemaIntelligence({
        siteId,
        includeEeatAssets: true,
      });
    } catch (err) {
      log.warn({ err, workspaceId: ws.id, siteId }, 'buildSchemaContext: intelligence seoContext unavailable');
    } // catch-ok

    const rawSiteKeywords = schemaIntel?.seoContext?.strategy?.siteKeywords;
    if (rawSiteKeywords?.length) {
      const declined = getDeclinedKeywords(ws.id);
      if (declined.length > 0) {
        const declinedSet = new Set(declined.map(k => k.toLowerCase()));
        ctx.siteKeywords = rawSiteKeywords.filter(k => !declinedSet.has(k.toLowerCase()));
      } else {
        ctx.siteKeywords = rawSiteKeywords;
      }
    }
    ctx.logoUrl = ws.brandLogoUrl;
    ctx.workspaceId = ws.id;
    ctx._siteId = siteId;

    try {
      // schema-context-direct-read-ok: Webflow API token selects the workspace-scoped Webflow locale source; not slice-backed business data.
      const sites = await listSitesCached(ws.webflowToken || undefined);
      const matched = sites.find(s => s.id === siteId);
      if (matched?.defaultLocale) ctx._defaultLocale = matched.defaultLocale;
    } catch { /* listSites failure: leave _defaultLocale undefined; downstream falls back to 'en' */ } // catch-ok

    const profile = schemaIntel?.seoContext?.businessProfile;
    if (profile) {
      ctx._businessProfile = {
        phone: profile.phone,
        email: profile.email,
        address: profile.addressParts,
        socialProfiles: profile.socialProfiles,
        openingHours: profile.openingHours,
        foundedDate: profile.foundedDate,
        numberOfEmployees: profile.numberOfEmployees,
      };
    }

    if (schemaIntel?.eeatAssets?.length) {
      ctx._eeatAssets = schemaIntel.eeatAssets;
    }

    ctx._siteHasSearch = ws.siteHasSearch === true;
  }
  return { ctx };
}
