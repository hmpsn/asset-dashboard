/**
 * Google Search Console API wrapper.
 * Fetches search analytics data (queries, clicks, impressions, CTR, position).
 */

import { getValidToken } from './google-auth.js';

const GSC_API = 'https://www.googleapis.com/webmasters/v3';
const GSC_API_V2 = 'https://searchconsole.googleapis.com/v1';

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
  days: number = 28
): Promise<SearchOverview> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 3); // GSC data has ~3 day delay
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const fmt = (d: Date) => d.toISOString().split('T')[0];

  // Fetch top queries
  const queryData = await gscFetch(
    `${GSC_API_V2}/searchanalytics/query`,
    token,
    {
      siteUrl: gscSiteUrl,
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ['query'],
      rowLimit: 25,
      type: 'web',
    }
  ) as { rows?: SearchAnalyticsRow[] };

  // Fetch top pages
  const pageData = await gscFetch(
    `${GSC_API_V2}/searchanalytics/query`,
    token,
    {
      siteUrl: gscSiteUrl,
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: ['page'],
      rowLimit: 25,
      type: 'web',
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

  const totalClicks = topQueries.reduce((s, q) => s + q.clicks, 0);
  const totalImpressions = topQueries.reduce((s, q) => s + q.impressions, 0);
  const avgCtr = totalImpressions > 0 ? +((totalClicks / totalImpressions) * 100).toFixed(1) : 0;
  const avgPosition = topQueries.length > 0
    ? +(topQueries.reduce((s, q) => s + q.position, 0) / topQueries.length).toFixed(1)
    : 0;

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

export async function getPerformanceTrend(
  siteId: string,
  gscSiteUrl: string,
  days: number = 28
): Promise<PerformanceTrend[]> {
  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 3);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const data = await gscFetch(
    `${GSC_API_V2}/searchanalytics/query`,
    token,
    {
      siteUrl: gscSiteUrl,
      startDate: fmt(startDate),
      endDate: fmt(endDate),
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
