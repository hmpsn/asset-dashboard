import { normalizePageUrl } from '../../shared/page-address-utils.js';

export function detectKeywordConflicts(
  pageMappings: Array<{ pagePath: string; primaryKeyword: string }>,
  normalize: (kw: string) => string,
): Array<[string, string[]]> {
  const kwCount = new Map<string, string[]>();
  for (const pm of pageMappings) {
    const kw = normalize(pm.primaryKeyword);
    if (!kw) continue;
    if (!kwCount.has(kw)) kwCount.set(kw, []);
    kwCount.get(kw)!.push(pm.pagePath);
  }
  return [...kwCount.entries()].filter(([, pages]) => pages.length > 1);
}

export function buildConflictNote(conflicts: Array<[string, string[]]>): string {
  if (conflicts.length === 0) return '';
  return (
    `\n\nKEYWORD CONFLICTS to resolve (same keyword assigned to multiple pages):\n` +
    conflicts.map(([kw, pages]) => `- "${kw}" → ${pages.join(', ')}`).join('\n') +
    `\nFor each conflict, include a fix in "keywordFixes" — reassign one page to a different keyword.\n`
  );
}

export function buildKeywordSummaryLine(pagePath: string, primaryKeyword: string): string {
  return `${pagePath}: "${primaryKeyword}"`;
}

export function buildFallbackKeywordFromPageIdentity(
  pagePath: string,
  page: { seoTitle?: string | null; title?: string | null } | undefined,
  normalizer: (kw: string) => string,
): string | null {
  const titleFallback = page?.seoTitle || page?.title;
  const slugFallback = pagePath.split('/').filter(Boolean).join(' ');
  const fallback = normalizer(titleFallback || slugFallback);
  return fallback || null;
}

export function buildPeriodComparisonBlock(
  periodComparison: {
    change: { clicks: number; impressions: number; position: number };
    changePercent: { clicks: number; impressions: number; position: number };
  } | null | undefined,
): string {
  if (!periodComparison) return '';
  const { change, changePercent } = periodComparison;
  const posLabel =
    change.position > 0 ? 'declining ⚠️' : change.position < 0 ? 'improving ✓' : 'stable';
  return (
    `\n\nPERIOD COMPARISON (last 28 days vs previous 28 days):\n` +
    `- Clicks: ${change.clicks >= 0 ? '+' : ''}${change.clicks} (${changePercent.clicks >= 0 ? '+' : ''}${changePercent.clicks}%)\n` +
    `- Impressions: ${change.impressions >= 0 ? '+' : ''}${change.impressions} (${changePercent.impressions >= 0 ? '+' : ''}${changePercent.impressions}%)\n` +
    `- Avg Position: ${change.position >= 0 ? '+' : ''}${change.position} (${posLabel})`
  );
}

export function buildGscQueriesBlock(
  gscRows: Array<{ page: string; query: string; position: number; clicks: number; impressions: number }>,
): string {
  if (gscRows.length === 0) return '';
  const top = [...gscRows].sort((a, b) => b.impressions - a.impressions).slice(0, 30);
  const lines = top.map(r => {
    const pagePath = normalizePageUrl(r.page);
    return `- "${r.query}" → ${pagePath} (pos: ${r.position.toFixed(1)}, clicks: ${r.clicks}, imp: ${r.impressions})`;
  });
  return `\n\nTop GSC queries (last 90 days):\n` + lines.join('\n');
}

export function buildDeviceBreakdownBlock(
  deviceBreakdown: Array<{ device: string; clicks: number; impressions: number; ctr: number; position: number }>,
): string {
  if (deviceBreakdown.length === 0) return '';
  let out =
    `\n\nDEVICE BREAKDOWN (last 28 days):\n` +
    deviceBreakdown
      .map(d => `- ${d.device}: ${d.clicks} clicks, ${d.impressions} imp, CTR ${d.ctr}%, avg pos ${d.position}`)
      .join('\n');
  const mobile = deviceBreakdown.find(d => d.device === 'MOBILE');
  const desktop = deviceBreakdown.find(d => d.device === 'DESKTOP');
  if (mobile && desktop && mobile.impressions > desktop.impressions && mobile.position > desktop.position + 2) {
    out += `\n⚠️ MOBILE GAP: Mobile has ${mobile.impressions} imp vs desktop ${desktop.impressions} but avg position is ${mobile.position.toFixed(1)} vs ${desktop.position.toFixed(1)} — mobile optimization is critical.`;
  }
  return out;
}

export function buildCountryBreakdownBlock(
  countryBreakdown: Array<{ country: string; clicks: number; impressions: number; position: number }>,
): string {
  if (countryBreakdown.length === 0) return '';
  return (
    `\n\nTOP COUNTRIES by clicks:\n` +
    countryBreakdown
      .slice(0, 5)
      .map(c => `- ${c.country}: ${c.clicks} clicks, ${c.impressions} imp, pos ${c.position}`)
      .join('\n')
  );
}

export function findUnmappedLandingPages<T extends { landingPage: string }>(
  organicLandingPages: T[],
  mappedPaths: Set<string>,
): T[] {
  return organicLandingPages.filter(lp => !mappedPaths.has(lp.landingPage));
}

export function findHighBounceLandingPages<T extends { landingPage: string; bounceRate: number; sessions: number }>(
  organicLandingPages: T[],
): T[] {
  return organicLandingPages.filter(lp => lp.bounceRate > 70 && lp.sessions > 5);
}

export function filterDeclinedSiteKeywords(
  siteKeywords: string[],
  declinedSet: Set<string>,
  normalize: (kw: string) => string,
): string[] {
  return siteKeywords.filter(kw => !declinedSet.has(normalize(kw)));
}

export function filterDeclinedContentGaps<T extends { targetKeyword?: string }>(
  contentGaps: T[],
  declinedSet: Set<string>,
  normalize: (kw: string) => string,
): T[] {
  return contentGaps.filter(cg => !cg.targetKeyword || !declinedSet.has(normalize(cg.targetKeyword)));
}

export function buildTopConvertingPages(
  ga4EventsByPage: Array<{ pagePath: string; eventName: string; eventCount: number }>,
  limit = 8,
): Array<[string, { events: number; topEvent: string }]> {
  const pageEvents = new Map<string, { events: number; topEvent: string }>();
  for (const ep of ga4EventsByPage) {
    const existing = pageEvents.get(ep.pagePath);
    if (!existing || ep.eventCount > existing.events) {
      pageEvents.set(ep.pagePath, { events: ep.eventCount, topEvent: ep.eventName });
    }
  }
  return [...pageEvents.entries()]
    .sort((a, b) => b[1].events - a[1].events)
    .slice(0, limit);
}
