/**
 * Google Search Console API wrapper.
 * Fetches search analytics data (queries, clicks, impressions, CTR, position).
 */

import { getValidToken } from './google-auth.js';
import type { CustomDateRange } from './google-analytics.js';

const GSC_API = 'https://www.googleapis.com/webmasters/v3';

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
  days: number = 28,
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
  const queryLimit = options.queryLimit || 500;
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

  // Fetch top queries
  const queryData = await gscFetch(
    `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
    token,
    {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ['query'],
      rowLimit: queryLimit,
      startRow,
      type: searchType,
    }
  ) as { rows?: SearchAnalyticsRow[] };

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

  const topQueries: SearchQuery[] = (queryData.rows || []).map(r => ({
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

export interface QueryPageRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function getQueryPageData(
  siteId: string,
  gscSiteUrl: string,
  days: number = 90
): Promise<QueryPageRow[]> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 3);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);

  const data = await gscFetch(
    `${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`,
    token,
    {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ['query', 'page'],
      rowLimit: 500,
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

/** Shared date range helper (GSC has ~3 day data delay) */
function gscDateRange(days: number, dateRange?: CustomDateRange) {
  if (dateRange) return { startDate: dateRange.startDate, endDate: dateRange.endDate };
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 3);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { startDate: fmt(startDate), endDate: fmt(endDate) };
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
    } catch {
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

  // Previous period: shift both dates back by `days`
  const prevEnd = new Date(curStart);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days + 1);
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const [curData, prevData] = await Promise.all([
    gscFetch(`${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`, token, {
      startDate: curStart, endDate: curEnd, type: 'web',
    }) as Promise<{ rows?: SearchAnalyticsRow[] }>,
    gscFetch(`${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`, token, {
      startDate: fmt(prevStart), endDate: fmt(prevEnd), type: 'web',
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
