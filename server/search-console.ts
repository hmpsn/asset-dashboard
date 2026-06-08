/**
 * Google Search Console API wrapper.
 * Fetches search analytics data (queries, clicks, impressions, CTR, position).
 */

import { getValidToken } from './google-auth.js';
import type { CustomDateRange } from './google-analytics.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';
import { GSC_METRIC_WINDOW_DAYS } from '../shared/keyword-window.js';


const log = createLogger('search-console');
const GSC_API = 'https://www.googleapis.com/webmasters/v3';

/** Convert GSC decimal CTR to percentage, rounded to 1 decimal place. E.g. 0.063 → 6.3 */
export function formatGscCtr(ctr: number): number {
  return +(ctr * 100).toFixed(1);
}

/** Round GSC position to 1 decimal place. */
export function formatGscPosition(position: number): number {
  return +position.toFixed(1);
}

/**
 * Compute percent change from previous to current value.
 * Returns 100 when previous is 0 and current > 0, 0 when both are 0.
 */
export function computePercentChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return +(((current - previous) / previous) * 100).toFixed(1);
}

/**
 * Given a GSC page URL, extract its pathname.
 * Returns the pathname for valid URLs, the raw value if it starts with '/', or null.
 */
export function extractGscPagePathname(pageUrl: string): string | null {
  try {
    return new URL(pageUrl).pathname;
  } catch (err) { // catch-ok: expected failure for non-URL strings (e.g. plain slugs)
    return pageUrl.startsWith('/') ? pageUrl : null;
  }
}

/**
 * Find the page with the largest absolute click drop between two period datasets.
 * Returns the page URL with the highest drop (positive drop = clicks decreased).
 * Also considers pages that vanished entirely (appeared in prev but not in cur).
 * Returns null if no page had a drop.
 */
export function findTopDroppedPage(
  curRows: Array<{ keys: string[]; clicks: number }>,
  prevRows: Array<{ keys: string[]; clicks: number }>,
): string | null {
  if (!curRows.length && !prevRows.length) return null;

  const prevByPage = new Map<string, number>();
  for (const row of prevRows) {
    prevByPage.set(row.keys[0], row.clicks);
  }

  let topPage: string | null = null;
  let maxDrop = 0;

  for (const row of curRows) {
    const prev = prevByPage.get(row.keys[0]) ?? 0;
    const drop = prev - row.clicks;
    if (drop > maxDrop) {
      maxDrop = drop;
      topPage = row.keys[0];
    }
  }

  // Also check pages that appeared in prev but not in cur (dropped to zero entirely)
  const curPageKeys = new Set(curRows.map(r => r.keys[0]));
  for (const [page, prevClicks] of prevByPage) {
    if (!curPageKeys.has(page) && prevClicks > maxDrop) {
      maxDrop = prevClicks;
      topPage = page;
    }
  }

  return topPage;
}

/**
 * Find the page with the largest absolute click spike between two period datasets.
 * Returns the page URL with the highest increase (positive spike = clicks increased).
 * Returns null if no page had an increase.
 */
export function findTopSpikedPage(
  curRows: Array<{ keys: string[]; clicks: number }>,
  prevRows: Array<{ keys: string[]; clicks: number }>,
): string | null {
  if (!curRows.length) return null;

  const prevByPage = new Map<string, number>();
  for (const row of prevRows) {
    prevByPage.set(row.keys[0], row.clicks);
  }

  let topPage: string | null = null;
  let maxSpike = 0;

  for (const row of curRows) {
    const prev = prevByPage.get(row.keys[0]) ?? 0;
    const spike = row.clicks - prev;
    if (spike > maxSpike) {
      maxSpike = spike;
      topPage = row.keys[0];
    }
  }

  return topPage;
}

interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchQueryObservation extends SearchQuery {
  date: string;
}

export interface SearchPage {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchOverview {
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  topQueries: SearchQuery[];
  topPages: SearchPage[];
  dateRange: { start: string; end: string };
}

export interface PerformanceTrend {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function gscFetch(endpoint: string, token: string, body?: unknown): Promise<unknown> {
  const opts: RequestInit = {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) {
    opts.method = 'POST';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(endpoint, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GSC API error (${res.status}): ${err}`);
  }
  return res.json();
}

export async function listGscSites(siteId: string): Promise<Array<{ siteUrl: string; permissionLevel: string }>> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  const data = await gscFetch(`${GSC_API}/sites`, token) as {
    siteEntry?: Array<{ siteUrl: string; permissionLevel: string }>;
  };
  return data.siteEntry || [];
}

export async function getSearchOverview(
  siteId: string,
  gscSiteUrl: string,
  days: number = GSC_METRIC_WINDOW_DAYS,
  options: { queryLimit?: number; pageLimit?: number; startRow?: number; searchType?: string } = {},
  dateRange?: CustomDateRange,
): Promise<SearchOverview> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  let endDate: Date, startDate: Date;
  if (dateRange) {
    startDate = new Date(dateRange.startDate);
    endDate = new Date(dateRange.endDate);
  } else {
    endDate = new Date();
    endDate.setDate(endDate.getDate() - 3); // GSC data has ~3 day delay
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);
  }

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);
  const searchType = options.searchType || 'web';
  const maxQueryRows = options.queryLimit || 500;
  const pageLimit = options.pageLimit || 500;
  const startRow = options.startRow || 0;

  // Fetch accurate site-level totals (no dimensions = aggregated row)
  const totalsData = await gscFetch(
    `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
    token,
    {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      type: searchType,
    }
  ) as { rows?: SearchAnalyticsRow[] };

  const totalsRow = totalsData.rows?.[0];
  const totalClicks = totalsRow?.clicks || 0;
  const totalImpressions = totalsRow?.impressions || 0;
  const avgCtr = totalsRow ? +(totalsRow.ctr * 100).toFixed(1) : 0;
  const avgPosition = totalsRow ? +totalsRow.position.toFixed(1) : 0;

  // Fetch top queries with pagination so long-tail GSC variants are not capped at 500 rows.
  const rawQueryRows = await paginateGscQuery(
    async (pageStartRow, rowLimit) => {
      const data = await gscFetch(
        `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
        token,
        {
          startDate: fmt(startDate),
          endDate: fmt(endDate),
          dimensions: ['query'],
          rowLimit,
          startRow: pageStartRow + startRow,
          type: searchType,
        },
      ) as { rows?: SearchAnalyticsRow[] };
      return data.rows ?? [];
    },
    { maxRows: maxQueryRows, pageSize: 500 },
  );

  // Fetch top pages
  const pageData = await gscFetch(
    `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
    token,
    {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ['page'],
      rowLimit: pageLimit,
      startRow: 0,
      type: searchType,
    }
  ) as { rows?: SearchAnalyticsRow[] };

  const topQueries: SearchQuery[] = rawQueryRows.map(r => ({
    query: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: +(r.ctr * 100).toFixed(1),
    position: +r.position.toFixed(1),
  }));

  const topPages: SearchPage[] = (pageData.rows || []).map(r => ({
    page: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: +(r.ctr * 100).toFixed(1),
    position: +r.position.toFixed(1),
  }));

  return {
    totalClicks,
    totalImpressions,
    avgCtr,
    avgPosition,
    topQueries,
    topPages,
    dateRange: { start: fmt(startDate), end: fmt(endDate) },
  };
}

export async function getSearchQueryObservations(
  siteId: string,
  gscSiteUrl: string,
  days: number = GSC_METRIC_WINDOW_DAYS,
  options: { maxRows?: number; searchType?: string } = {},
  dateRange?: CustomDateRange,
): Promise<SearchQueryObservation[]> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  let endDate: Date, startDate: Date;
  if (dateRange) {
    startDate = new Date(dateRange.startDate);
    endDate = new Date(dateRange.endDate);
  } else {
    endDate = new Date();
    endDate.setDate(endDate.getDate() - 3);
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);
  }

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);
  const searchType = options.searchType || 'web';

  const rows = await paginateGscQuery(
    async (startRow, rowLimit) => {
      const data = await gscFetch(
        `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
        token,
        {
          startDate: fmt(startDate),
          endDate: fmt(endDate),
          dimensions: ['query', 'date'],
          rowLimit,
          startRow,
          type: searchType,
        },
      ) as { rows?: SearchAnalyticsRow[] };
      return data.rows ?? [];
    },
    { maxRows: options.maxRows ?? 5000, pageSize: 500 },
  );

  return rows.map(row => ({
    query: row.keys[0],
    date: row.keys[1],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: +(row.ctr * 100).toFixed(1),
    position: +row.position.toFixed(1),
  }));
}

export interface QueryPageRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  /** CTR as a percentage (e.g., 6.3 for 6.3%). Already converted from GSC decimal. Do NOT multiply by 100. */
  ctr: number;
  position: number;
}

export async function getQueryPageData(
  siteId: string,
  gscSiteUrl: string,
  days: number = 90,
  opts?: { maxRows?: number; dateRange?: CustomDateRange },
): Promise<QueryPageRow[]> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  let startDate: Date;
  let endDate: Date;
  if (opts?.dateRange) {
    startDate = new Date(opts.dateRange.startDate);
    endDate = new Date(opts.dateRange.endDate);
  } else {
    endDate = new Date();
    endDate.setDate(endDate.getDate() - 3);
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);
  }

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);

  const maxRows = opts?.maxRows ?? 500;

  if (maxRows > 500) {
    // Use pagination for larger datasets
    return paginateGscQuery(
      async (startRow, rowLimit) => {
        const data = await gscFetch(
          `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
          token,
          {
            startDate: fmt(startDate),
            endDate: fmt(endDate),
            dimensions: ['query', 'page'],
            rowLimit,
            startRow,
            type: 'web',
          },
        ) as { rows?: SearchAnalyticsRow[] };
        return (data.rows || []).map(r => ({
          query: r.keys[0],
          page: r.keys[1],
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: +(r.ctr * 100).toFixed(1),
          position: +r.position.toFixed(1),
        }));
      },
      { maxRows, pageSize: 500 },
    );
  }

  const data = await gscFetch(
    `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
    token,
    {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ['query', 'page'],
      rowLimit: maxRows,
      type: 'web',
    }
  ) as { rows?: SearchAnalyticsRow[] };

  return (data.rows || []).map(r => ({
    query: r.keys[0],
    page: r.keys[1],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: +(r.ctr * 100).toFixed(1),
    position: +r.position.toFixed(1),
  }));
}

/**
 * Fetch ALL pages that GSC has data for (up to 1000).
 * Used by the redirect scanner to find "ghost URLs" — pages Google
 * is indexing/showing in search that may no longer exist on the site.
 */
export async function getAllGscPages(
  siteId: string,
  gscSiteUrl: string,
  days: number = 90,
  dateRange?: CustomDateRange,
): Promise<SearchPage[]> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  const { startDate: start, endDate: end } = gscDateRange(days, dateRange);
  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);

  const data = await gscFetch(
    `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
    token,
    {
      startDate: start,
      endDate: end,
      dimensions: ['page'],
      rowLimit: 1000,
      type: 'web',
    }
  ) as { rows?: SearchAnalyticsRow[] };

  return (data.rows || []).map(r => ({
    page: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: +(r.ctr * 100).toFixed(1),
    position: +r.position.toFixed(1),
  }));
}

/**
 * Identify the page with the largest absolute click drop between the current and
 * previous period. Used by anomaly detection to populate `AnomalyDigestData.affectedPage`
 * so the diagnostic orchestrator can run page-specific probes (position history,
 * canonical, internal links).
 *
 * Makes 2 GSC API calls — call once per workspace per detection run and cache the result.
 * Returns the URL pathname of the most-affected page, or null if no page data is available.
 */
export async function getTopDroppedGscPage(
  siteId: string,
  gscSiteUrl: string,
  days: number = 28,
): Promise<string | null> {
  const token = await getValidToken(siteId);
  if (!token) return null;

  const { startDate: curStart, endDate: curEnd } = gscDateRange(days);
  const previousWindow = getPreviousGscWindow(curStart, days);

  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);
  const [curData, prevData] = await Promise.all([
    gscFetch(`${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`, token, {
      startDate: curStart, endDate: curEnd, dimensions: ['page'], rowLimit: 100, type: 'web',
    }) as Promise<{ rows?: SearchAnalyticsRow[] }>,
    gscFetch(`${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`, token, {
      startDate: previousWindow.startDate, endDate: previousWindow.endDate, dimensions: ['page'], rowLimit: 100, type: 'web',
    }) as Promise<{ rows?: SearchAnalyticsRow[] }>,
  ]);

  if (!curData.rows?.length || !prevData.rows?.length) return null;

  // Build a map of previous-period clicks by page
  const prevByPage = new Map<string, number>();
  for (const row of prevData.rows) {
    prevByPage.set(row.keys[0], row.clicks);
  }

  // Find the page with the largest absolute click drop
  let topPage: string | null = null;
  let maxDrop = 0;
  for (const row of curData.rows) {
    const prev = prevByPage.get(row.keys[0]) ?? 0;
    const drop = prev - row.clicks; // positive = dropped
    if (drop > maxDrop) {
      maxDrop = drop;
      topPage = row.keys[0];
    }
  }

  // Also check pages that appeared in prev but not in cur (dropped to zero entirely)
  const curPageKeys = new Set(curData.rows.map(r => r.keys[0]));
  for (const [page, prevClicks] of prevByPage) {
    if (!curPageKeys.has(page) && prevClicks > maxDrop) {
      maxDrop = prevClicks;
      topPage = page;
    }
  }

  if (!topPage) return null;
  return extractGscPagePathname(topPage);
}

/**
 * Returns the pathname of the page with the largest absolute click *increase*
 * between the current period and the prior equal-length period.
 * Used to populate affectedPage for traffic_spike anomalies.
 */
export async function getTopSpikedGscPage(
  siteId: string,
  gscSiteUrl: string,
  days: number = 28,
): Promise<string | null> {
  const token = await getValidToken(siteId);
  if (!token) return null;

  const { startDate: curStart, endDate: curEnd } = gscDateRange(days);
  const previousWindow = getPreviousGscWindow(curStart, days);

  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);
  const [curData, prevData] = await Promise.all([
    gscFetch(`${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`, token, {
      startDate: curStart, endDate: curEnd, dimensions: ['page'], rowLimit: 100, type: 'web',
    }) as Promise<{ rows?: SearchAnalyticsRow[] }>,
    gscFetch(`${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`, token, {
      startDate: previousWindow.startDate, endDate: previousWindow.endDate, dimensions: ['page'], rowLimit: 100, type: 'web',
    }) as Promise<{ rows?: SearchAnalyticsRow[] }>,
  ]);

  if (!curData.rows?.length) return null;

  // Build a map of previous-period clicks by page
  const prevByPage = new Map<string, number>();
  for (const row of (prevData.rows ?? [])) {
    prevByPage.set(row.keys[0], row.clicks);
  }

  // Find the page with the largest absolute click increase
  let topPage: string | null = null;
  let maxSpike = 0;
  for (const row of curData.rows) {
    const prev = prevByPage.get(row.keys[0]) ?? 0;
    const spike = row.clicks - prev; // positive = increased
    if (spike > maxSpike) {
      maxSpike = spike;
      topPage = row.keys[0];
    }
  }

  if (!topPage) return null;
  return extractGscPagePathname(topPage);
}

/**
 * Generic pagination helper for GSC API queries.
 * Fetches multiple pages of results using startRow, up to maxRows total.
 */
export async function paginateGscQuery<T>(
  fetchPage: (startRow: number, rowLimit: number) => Promise<T[]>,
  opts?: { maxRows?: number; pageSize?: number },
): Promise<T[]> {
  const maxRows = opts?.maxRows ?? 2000;
  const pageSize = opts?.pageSize ?? 500;
  const results: T[] = [];

  for (let startRow = 0; startRow < maxRows; startRow += pageSize) {
    const page = await fetchPage(startRow, pageSize);
    results.push(...page);
    if (page.length < pageSize) break; // Last page — no more data
  }

  return results.slice(0, maxRows);
}

export interface RichResultsIssue {
  severity: 'ERROR' | 'SUGGESTION' | 'WARNING';
  issueMessage: string;
  type: string;
}

export interface UrlInspectionResult {
  hasErrors: boolean;
  issues: RichResultsIssue[];
  richResultsDetected: string[];
}

/**
 * Call GSC URL Inspection API to check rich results status.
 * Uses the existing getValidToken OAuth pattern.
 * Returns null when GSC is not connected or quota is exhausted.
 */
export async function inspectUrlForRichResults(
  siteId: string,
  pageUrl: string,
  siteUrl: string,
): Promise<UrlInspectionResult | null> {
  const token = await getValidToken(siteId);
  if (!token) return null;

  const res = await fetch(
    'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: pageUrl, siteUrl }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 429) {
      log.warn({ siteId }, 'GSC URL Inspection API quota exhausted');
      return null;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`GSC URL Inspection authentication error (${res.status}): ${errText.slice(0, 200)}`);
    }
    if (res.status >= 400 && res.status < 500) {
      log.warn({ siteId, status: res.status }, 'GSC URL Inspection API client error — treating as no_gsc');
      return null;
    }
    throw new Error(`GSC URL Inspection error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json() as {
    inspectionResult?: {
      richResultsResult?: {
        detectedItems?: Array<{
          richResultType?: string;
          items?: Array<{
            issues?: Array<{
              severity?: string;
              issueMessage?: string;
              type?: string;
            }>;
          }>;
        }>;
      };
    };
  };

  const detectedItems = data.inspectionResult?.richResultsResult?.detectedItems ?? [];
  const issues: RichResultsIssue[] = [];
  const richResultsDetected: string[] = [];

  for (const item of detectedItems) {
    if (item.richResultType) richResultsDetected.push(item.richResultType);
    for (const i of (item.items ?? [])) {
      for (const issue of (i.issues ?? [])) {
        issues.push({
          severity: (issue.severity as RichResultsIssue['severity']) || 'SUGGESTION',
          issueMessage: issue.issueMessage || '',
          type: issue.type || '',
        });
      }
    }
  }

  return {
    hasErrors: issues.some(i => i.severity === 'ERROR'),
    issues,
    richResultsDetected,
  };
}

/** Shared date range helper (GSC has ~3 day data delay) */
export function gscDateRange(days: number, dateRange?: CustomDateRange) {
  if (dateRange) {
    const start = new Date(`${dateRange.startDate}T00:00:00.000Z`);
    const end = new Date(`${dateRange.endDate}T00:00:00.000Z`);
    if (
      Number.isFinite(start.getTime()) &&
      Number.isFinite(end.getTime()) &&
      end.getTime() >= start.getTime()
    ) {
      return { startDate: dateRange.startDate, endDate: dateRange.endDate };
    }
  }
  const now = new Date();
  const endDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 3,
  ));
  const startDate = new Date(Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate() - days,
  ));
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { startDate: fmt(startDate), endDate: fmt(endDate) };
}

function shiftIsoDateUtc(isoDate: string, dayDelta: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const shifted = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + dayDelta,
  ));
  return shifted.toISOString().split('T')[0];
}

function getPreviousGscWindow(currentStartDate: string, periodDays: number) {
  const safePeriodDays = Math.max(1, periodDays);
  return {
    startDate: shiftIsoDateUtc(currentStartDate, -safePeriodDays),
    endDate: shiftIsoDateUtc(currentStartDate, -1),
  };
}

export async function getPerformanceTrend(
  siteId: string,
  gscSiteUrl: string,
  days: number = 28,
  dateRange?: CustomDateRange,
): Promise<PerformanceTrend[]> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  const { startDate, endDate } = gscDateRange(days, dateRange);
  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);

  const data = await gscFetch(
    `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
    token,
    {
      startDate,
      endDate,
      dimensions: ['date'],
      type: 'web',
    }
  ) as { rows?: SearchAnalyticsRow[] };

  return (data.rows || []).map(r => ({
    date: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: +(r.ctr * 100).toFixed(1),
    position: +r.position.toFixed(1),
  }));
}

/**
 * Get daily performance trend for a specific page URL.
 * Uses dimensionFilterGroups to filter GSC data to a single page.
 */
export async function getPageTrend(
  siteId: string,
  gscSiteUrl: string,
  pageUrl: string,
  days: number = 90,
  dateRange?: CustomDateRange,
): Promise<PerformanceTrend[]> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  const { startDate, endDate } = gscDateRange(days, dateRange);
  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);

  const data = await gscFetch(
    `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
    token,
    {
      startDate,
      endDate,
      dimensions: ['date'],
      dimensionFilterGroups: [{
        filters: [{
          dimension: 'page',
          operator: 'equals',
          expression: pageUrl,
        }],
      }],
      type: 'web',
    }
  ) as { rows?: SearchAnalyticsRow[] };

  return (data.rows || []).map(r => ({
    date: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: +(r.ctr * 100).toFixed(1),
    position: +r.position.toFixed(1),
  }));
}

// ─── Phase 2: Device, Country, Search Type, Period Comparison ───

export interface DeviceBreakdown {
  device: string;   // DESKTOP, MOBILE, TABLET
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function getSearchDeviceBreakdown(
  siteId: string,
  gscSiteUrl: string,
  days: number = 28,
  dateRange?: CustomDateRange,
): Promise<DeviceBreakdown[]> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  const { startDate, endDate } = gscDateRange(days, dateRange);
  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);

  const data = await gscFetch(
    `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
    token,
    { startDate, endDate, dimensions: ['device'], type: 'web' }
  ) as { rows?: SearchAnalyticsRow[] };

  return (data.rows || []).map(r => ({
    device: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: +(r.ctr * 100).toFixed(1),
    position: +r.position.toFixed(1),
  }));
}

export interface CountryBreakdown {
  country: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function getSearchCountryBreakdown(
  siteId: string,
  gscSiteUrl: string,
  days: number = 28,
  limit: number = 20,
  dateRange?: CustomDateRange,
): Promise<CountryBreakdown[]> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  const { startDate, endDate } = gscDateRange(days, dateRange);
  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);

  const data = await gscFetch(
    `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
    token,
    { startDate, endDate, dimensions: ['country'], rowLimit: limit, type: 'web' }
  ) as { rows?: SearchAnalyticsRow[] };

  return (data.rows || []).map(r => ({
    country: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: +(r.ctr * 100).toFixed(1),
    position: +r.position.toFixed(1),
  }));
}

export interface SearchTypeBreakdown {
  searchType: string;   // web, image, video, news, discover
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * Get performance breakdown by search type (web, image, video, news, discover).
 * Unlike other GSC calls, this requires individual queries per type since
 * searchType is not a dimension but a top-level filter.
 */
export async function getSearchTypeBreakdown(
  siteId: string,
  gscSiteUrl: string,
  days: number = 28,
  dateRange?: CustomDateRange,
): Promise<SearchTypeBreakdown[]> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  const { startDate, endDate } = gscDateRange(days, dateRange);
  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);
  const types = ['web', 'image', 'video', 'news', 'discover'];

  const results: SearchTypeBreakdown[] = [];
  for (const searchType of types) {
    try {
      const data = await gscFetch(
        `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
        token,
        { startDate, endDate, type: searchType }
      ) as { rows?: SearchAnalyticsRow[] };

      const row = data.rows?.[0];
      if (row && (row.clicks > 0 || row.impressions > 0)) {
        results.push({
          searchType,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: +(row.ctr * 100).toFixed(1),
          position: +row.position.toFixed(1),
        });
      }
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'search-console/getSearchTypeBreakdown: programming error');
      // Some search types may not be available for all properties
    }
  }
  return results;
}

export interface PeriodComparison {
  current: { clicks: number; impressions: number; ctr: number; position: number };
  previous: { clicks: number; impressions: number; ctr: number; position: number };
  change: { clicks: number; impressions: number; ctr: number; position: number };
  changePercent: { clicks: number; impressions: number; ctr: number; position: number };
}

/**
 * Compare current period vs previous period of the same length.
 * E.g. days=28 compares last 28 days vs the 28 days before that.
 */
export async function getSearchPeriodComparison(
  siteId: string,
  gscSiteUrl: string,
  days: number = 28,
  dateRange?: CustomDateRange,
): Promise<PeriodComparison> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);

  const { startDate: curStart, endDate: curEnd } = gscDateRange(days, dateRange);
  const curStartDate = new Date(`${curStart}T00:00:00.000Z`);
  const curEndDate = new Date(`${curEnd}T00:00:00.000Z`);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const derivedPeriodDays = (Number.isFinite(curStartDate.getTime()) && Number.isFinite(curEndDate.getTime()))
    ? Math.round((curEndDate.getTime() - curStartDate.getTime()) / MS_PER_DAY) + 1
    : days;
  const periodDays = Math.max(1, derivedPeriodDays);
  const previousWindow = getPreviousGscWindow(curStart, periodDays);

  const [curData, prevData] = await Promise.all([
    gscFetch(`${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`, token, {
      startDate: curStart, endDate: curEnd, type: 'web',
    }) as Promise<{ rows?: SearchAnalyticsRow[] }>,
    gscFetch(`${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`, token, {
      startDate: previousWindow.startDate, endDate: previousWindow.endDate, type: 'web',
    }) as Promise<{ rows?: SearchAnalyticsRow[] }>,
  ]);

  const cur = curData.rows?.[0];
  const prev = prevData.rows?.[0];

  const current = {
    clicks: cur?.clicks || 0,
    impressions: cur?.impressions || 0,
    ctr: cur ? +(cur.ctr * 100).toFixed(1) : 0,
    position: cur ? +cur.position.toFixed(1) : 0,
  };
  const previous = {
    clicks: prev?.clicks || 0,
    impressions: prev?.impressions || 0,
    ctr: prev ? +(prev.ctr * 100).toFixed(1) : 0,
    position: prev ? +prev.position.toFixed(1) : 0,
  };

  const pct = (c: number, p: number) => p === 0 ? (c > 0 ? 100 : 0) : +((((c - p) / p) * 100).toFixed(1));

  return {
    current,
    previous,
    change: {
      clicks: current.clicks - previous.clicks,
      impressions: current.impressions - previous.impressions,
      ctr: +(current.ctr - previous.ctr).toFixed(1),
      position: +(current.position - previous.position).toFixed(1),
    },
    changePercent: {
      clicks: pct(current.clicks, previous.clicks),
      impressions: pct(current.impressions, previous.impressions),
      ctr: pct(current.ctr, previous.ctr),
      position: pct(current.position, previous.position),
    },
  };
}
