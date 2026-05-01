const GENERIC_DISCOVERY_DOMAINS = new Set([
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'medium.com',
  'pinterest.com',
  'quora.com',
  'reddit.com',
  'tiktok.com',
  'twitter.com',
  'wikipedia.org',
  'wikihow.com',
  'x.com',
  'youtube.com',
  'youtu.be',
]);

export function sanitizeCompetitorDomain(rawDomain: string): string {
  return rawDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

export function normalizeCompetitorDomain(rawDomain: string): string {
  return sanitizeCompetitorDomain(rawDomain).replace(/^www\./, '');
}

export function isGenericDiscoveryDomain(rawDomain: string): boolean {
  const domain = normalizeCompetitorDomain(rawDomain);
  if (!domain) return true;
  return [...GENERIC_DISCOVERY_DOMAINS].some(blocked => domain === blocked || domain.endsWith(`.${blocked}`));
}

export function isProviderSafeDomain(rawDomain: string): boolean {
  const domain = normalizeCompetitorDomain(rawDomain);
  if (!domain || domain.length > 253) return false;
  if (!domain.includes('.') || domain.includes('..')) return false;
  const labels = domain.split('.');
  if (labels.some(label => label.length === 0 || label.length > 63)) return false;
  if (labels.some(label => label.startsWith('-') || label.endsWith('-'))) return false;
  if (!labels.every(label => /^[a-z0-9-]+$/.test(label))) return false;

  const tld = labels[labels.length - 1];
  return /^[a-z]{2,63}$/.test(tld);
}

export function isOwnOrRelatedDomain(rawDomain: string, rawClientDomain: string): boolean {
  const domain = normalizeCompetitorDomain(rawDomain);
  const clientDomain = normalizeCompetitorDomain(rawClientDomain);
  if (!domain || !clientDomain) return false;
  return domain === clientDomain || domain.endsWith(`.${clientDomain}`) || clientDomain.endsWith(`.${domain}`);
}

export function isDiscoverableCompetitorDomain(rawDomain: string, rawClientDomain: string): boolean {
  const domain = normalizeCompetitorDomain(rawDomain);
  return Boolean(domain)
    && isProviderSafeDomain(domain)
    && !isOwnOrRelatedDomain(domain, rawClientDomain)
    && !isGenericDiscoveryDomain(domain);
}

export function filterDiscoveredCompetitors<T extends { domain: string }>(
  competitors: T[],
  clientDomain: string
): T[] {
  const seen = new Set<string>();
  return competitors.flatMap(competitor => {
    const domain = normalizeCompetitorDomain(competitor.domain);
    if (!isDiscoverableCompetitorDomain(domain, clientDomain) || seen.has(domain)) return [];
    seen.add(domain);
    return [{ ...competitor, domain }];
  });
}

export function cleanCompetitorDomains(domains: string[], clientDomain = ''): string[] {
  const seen = new Set<string>();
  return domains.flatMap(raw => {
    const sanitized = sanitizeCompetitorDomain(raw);
    const domain = normalizeCompetitorDomain(sanitized);
    if (!domain || seen.has(domain)) return [];
    if (!isProviderSafeDomain(domain)) return [];
    if (clientDomain && !isDiscoverableCompetitorDomain(domain, clientDomain)) return [];
    if (!clientDomain && isGenericDiscoveryDomain(domain)) return [];
    seen.add(domain);
    return [sanitized];
  });
}
