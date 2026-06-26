import { webflowFetch } from './webflow-client.js';

interface WebflowCustomDomainsResponse {
  customDomains?: Array<{ url?: string | null }>;
}

interface WebflowSiteResponse {
  shortName?: string | null;
  customDomains?: Array<{ url?: string | null }>;
}

export interface WebflowSiteDomainInfo {
  staging: string;
  customDomains: string[];
  defaultDomain: string;
}

export function normalizeWebflowDomainUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function listCustomDomainUrls(siteId: string, tokenOverride?: string): Promise<string[]> {
  try {
    const res = await webflowFetch(
      `/sites/${siteId}/custom_domains`,
      { signal: AbortSignal.timeout(5000) },
      tokenOverride,
    );
    if (!res.ok) return [];
    const data = await res.json() as WebflowCustomDomainsResponse;
    return (data.customDomains ?? [])
      .map(domain => normalizeWebflowDomainUrl(domain.url))
      .filter((domain): domain is string => Boolean(domain));
  } catch { // catch-ok: custom domain lookup is optional; callers can still use the staging domain
    return [];
  }
}

export async function getPrimaryCustomDomainUrl(siteId: string, tokenOverride?: string): Promise<string | null> {
  const domains = await listCustomDomainUrls(siteId, tokenOverride);
  return domains[0] ?? null;
}

export async function getWebflowSiteDomainInfo(
  siteId: string,
  tokenOverride?: string,
): Promise<WebflowSiteDomainInfo | null> {
  if (!tokenOverride && !process.env.WEBFLOW_API_TOKEN) return null;
  const res = await webflowFetch(`/sites/${siteId}`, { signal: AbortSignal.timeout(5000) }, tokenOverride);
  if (!res.ok) return null;
  const data = await res.json() as WebflowSiteResponse;
  if (!data.shortName) return null;

  const staging = `https://${data.shortName}.webflow.io`;
  const embeddedDomains = (data.customDomains ?? [])
    .map(domain => normalizeWebflowDomainUrl(domain.url))
    .filter((domain): domain is string => Boolean(domain));
  const endpointDomains = await listCustomDomainUrls(siteId, tokenOverride);
  const customDomains = embeddedDomains.length > 0 ? embeddedDomains : endpointDomains;

  return {
    staging,
    customDomains,
    defaultDomain: customDomains[0] ?? staging,
  };
}
