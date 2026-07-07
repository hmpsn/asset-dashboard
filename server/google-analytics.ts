/**
 * Google Analytics 4 Data API integration.
 * Uses the GA4 Data API v1 to fetch analytics data for workspaces.
 * Requires the analytics.readonly scope in the Google OAuth flow.
 */

import { getGlobalToken } from './google-auth.js';
import { googleJson, isGoogleProviderError } from './google-provider-client.js';
import { createLogger } from './logger.js';
import { normalizePageUrl } from './utils/page-address.js';
import type { AnalyticsDateRange } from '../shared/types/analytics-contract.js';
const log = createLogger('ga4');

const GA4_API = 'https://analyticsdata.googleapis.com/v1beta';
const GA4_ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta';

export interface GA4Property {
  name: string;          // e.g. "properties/123456789"
  displayName: string;
  propertyId: string;    // numeric ID extracted from name
}

export interface GA4Overview {
  totalUsers: number;
  totalSessions: number;
  totalPageviews: number;
  avgSessionDuration: number;   // seconds
  bounceRate: number;           // percentage
  newUserPercentage: number;    // percentage
  dateRange: { start: string; end: string };
}

export interface GA4TopPage {
  path: string;
  pageviews: number;
  users: number;
  sessions: number;
  avgEngagementTime: number;
}

export interface GA4TopSource {
  source: string;
  medium: string;
  users: number;
  sessions: number;
}

export interface GA4DailyTrend {
  date: string;
  users: number;
  sessions: number;
  pageviews: number;
}

export interface GA4DeviceBreakdown {
  device: string;
  users: number;
  sessions: number;
  percentage: number;
}

export interface GA4CountryBreakdown {
  country: string;
  users: number;
  sessions: number;
}

/**
 * List all GA4 properties accessible to the authenticated user.
 */
export async function listGA4Properties(): Promise<GA4Property[]> {
  const token = await getGlobalToken();
  if (!token) throw new Error('Google not connected');

  let data: {
    accountSummaries?: Array<{
      account: string;
      displayName: string;
      propertySummaries?: Array<{
        property: string;
        displayName: string;
      }>;
    }>;
  };
  try {
    data = await googleJson({
      endpoint: `${GA4_ADMIN_API}/accountSummaries`,
      source: 'ga4',
      token,
    });
  } catch (err) {
    log.error({ err }, 'Failed to list properties');
    if (isGoogleProviderError(err)) {
      throw new Error(`Failed to list GA4 properties: ${err.status ?? err.kind}`);
    }
    throw err;
  }

  const properties: GA4Property[] = [];
  for (const account of data.accountSummaries || []) {
    for (const prop of account.propertySummaries || []) {
      const propertyId = prop.property.replace('properties/', '');
      properties.push({
        name: prop.property,
        displayName: `${prop.displayName} (${account.displayName})`,
        propertyId,
      });
    }
  }
  return properties;
}

/**
 * Run a GA4 Data API report.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runReport(propertyId: string, body: Record<string, unknown>): Promise<any> {
  const token = await getGlobalToken();
  if (!token) throw new Error('Google not connected');

  try {
    return await googleJson({
      endpoint: `${GA4_API}/properties/${propertyId}:runReport`,
      source: 'ga4',
      token,
      body,
    });
  } catch (err) {
    log.error({ err }, 'Report failed');
    if (isGoogleProviderError(err)) {
      throw new Error(`GA4 report failed: ${err.status ?? err.kind}`);
    }
    throw err;
  }
}

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

export type CustomDateRange = AnalyticsDateRange;

function parseIntSafe(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseFloatSafe(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function ga4RatePercent(value: string | undefined, digits = 1): number {
  return roundTo(parseFloatSafe(value) * 100, digits);
}

function metricValue(
  row: { metricValues?: Array<{ value?: string }> } | undefined,
  index: number,
): string | undefined {
  return row?.metricValues?.[index]?.value;
}

function dimensionValue(
  row: { dimensionValues?: Array<{ value?: string }> } | undefined,
  index: number,
): string {
  return row?.dimensionValues?.[index]?.value ?? '';
}

function formatGa4Date(value: string): string {
  return value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
}

/**
 * Get overview metrics for a GA4 property.
 */
export async function getGA4Overview(propertyId: string, days: number = 28, dateRange?: CustomDateRange): Promise<GA4Overview> {
  const startDate = dateRange?.startDate || dateStr(days);
  const endDate = dateRange?.endDate || dateStr(1);

  const data = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'averageSessionDuration' },
      { name: 'bounceRate' },
      { name: 'newUsers' },
    ],
  }) as {
    rows?: Array<{ metricValues: Array<{ value: string }> }>;
  };

  const row = data.rows?.[0]?.metricValues;
  const totalUsers = parseIntSafe(row?.[0]?.value);
  const newUsers = parseIntSafe(row?.[5]?.value);

  return {
    totalUsers,
    totalSessions: parseIntSafe(row?.[1]?.value),
    totalPageviews: parseIntSafe(row?.[2]?.value),
    avgSessionDuration: parseFloatSafe(row?.[3]?.value),
    bounceRate: ga4RatePercent(row?.[4]?.value),
    newUserPercentage: totalUsers > 0 ? parseFloat(((newUsers / totalUsers) * 100).toFixed(1)) : 0,
    dateRange: { start: startDate, end: endDate },
  };
}

/**
 * Get daily trend data.
 */
export async function getGA4DailyTrend(propertyId: string, days: number = 28, dateRange?: CustomDateRange): Promise<GA4DailyTrend[]> {
  const startDate = dateRange?.startDate || dateStr(days);
  const endDate = dateRange?.endDate || dateStr(1);

  const data = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
    ],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  }) as {
    rows?: Array<{
      dimensionValues: Array<{ value: string }>;
      metricValues: Array<{ value: string }>;
    }>;
  };

  return (data.rows || []).map(r => ({
    date: formatGa4Date(dimensionValue(r, 0)),
    users: parseIntSafe(metricValue(r, 0)),
    sessions: parseIntSafe(metricValue(r, 1)),
    pageviews: parseIntSafe(metricValue(r, 2)),
  }));
}

/**
 * Get top pages by pageviews.
 */
export async function getGA4TopPages(propertyId: string, days: number = 28, limit: number = 20, dateRange?: CustomDateRange): Promise<GA4TopPage[]> {
  const startDate = dateRange?.startDate || dateStr(days);
  const endDate = dateRange?.endDate || dateStr(1);

  const data = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'userEngagementDuration' },
    ],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit,
  }) as {
    rows?: Array<{
      dimensionValues: Array<{ value: string }>;
      metricValues: Array<{ value: string }>;
    }>;
  };

  return (data.rows || []).map(r => {
    const sessions = parseIntSafe(metricValue(r, 2));
    return {
      path: dimensionValue(r, 0),
      pageviews: parseIntSafe(metricValue(r, 0)),
      users: parseIntSafe(metricValue(r, 1)),
      sessions,
      avgEngagementTime: sessions > 0 ? parseFloatSafe(metricValue(r, 3)) / sessions : 0,
    };
  });
}

/**
 * Get top traffic sources.
 */
export async function getGA4TopSources(propertyId: string, days: number = 28, limit: number = 10, dateRange?: CustomDateRange): Promise<GA4TopSource[]> {
  const startDate = dateRange?.startDate || dateStr(days);
  const endDate = dateRange?.endDate || dateStr(1);

  const data = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
    ],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit,
  }) as {
    rows?: Array<{
      dimensionValues: Array<{ value: string }>;
      metricValues: Array<{ value: string }>;
    }>;
  };

  return (data.rows || []).map(r => ({
    source: dimensionValue(r, 0),
    medium: dimensionValue(r, 1),
    users: parseIntSafe(metricValue(r, 0)),
    sessions: parseIntSafe(metricValue(r, 1)),
  }));
}

/**
 * Get device category breakdown.
 */
export async function getGA4DeviceBreakdown(propertyId: string, days: number = 28, dateRange?: CustomDateRange): Promise<GA4DeviceBreakdown[]> {
  const startDate = dateRange?.startDate || dateStr(days);
  const endDate = dateRange?.endDate || dateStr(1);

  const data = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
    ],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
  }) as {
    rows?: Array<{
      dimensionValues: Array<{ value: string }>;
      metricValues: Array<{ value: string }>;
    }>;
  };

  const rows = (data.rows || []).map(r => ({
    device: dimensionValue(r, 0),
    users: parseIntSafe(metricValue(r, 0)),
    sessions: parseIntSafe(metricValue(r, 1)),
    percentage: 0,
  }));
  const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);
  rows.forEach(r => r.percentage = totalSessions > 0 ? parseFloat(((r.sessions / totalSessions) * 100).toFixed(1)) : 0);
  return rows;
}

/**
 * Get top countries by users.
 */
// ─── Key Events & Conversions ───

export interface GA4Event {
  eventName: string;
  eventCount: number;
  users: number;
}

export interface GA4EventTrend {
  date: string;
  eventCount: number;
}

export interface GA4ConversionSummary {
  eventName: string;
  conversions: number;
  users: number;
  rate: number; // conversion rate as percentage
}

/**
 * Get top events by count.
 */
export async function getGA4KeyEvents(propertyId: string, days: number = 28, limit: number = 20, dateRange?: CustomDateRange): Promise<GA4Event[]> {
  const startDate = dateRange?.startDate || dateStr(days);
  const endDate = dateRange?.endDate || dateStr(1);

  const data = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'eventName' }],
    metrics: [
      { name: 'eventCount' },
      { name: 'totalUsers' },
    ],
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit,
  }) as {
    rows?: Array<{
      dimensionValues: Array<{ value: string }>;
      metricValues: Array<{ value: string }>;
    }>;
  };

  return (data.rows || []).map(r => ({
    eventName: dimensionValue(r, 0),
    eventCount: parseIntSafe(metricValue(r, 0)),
    users: parseIntSafe(metricValue(r, 1)),
  }));
}

/**
 * Get daily trend for a specific event.
 */
export async function getGA4EventTrend(propertyId: string, eventName: string, days: number = 28, dateRange?: CustomDateRange): Promise<GA4EventTrend[]> {
  const startDate = dateRange?.startDate || dateStr(days);
  const endDate = dateRange?.endDate || dateStr(1);

  const data = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        stringFilter: { matchType: 'EXACT', value: eventName },
      },
    },
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  }) as {
    rows?: Array<{
      dimensionValues: Array<{ value: string }>;
      metricValues: Array<{ value: string }>;
    }>;
  };

  return (data.rows || []).map(r => ({
    date: formatGa4Date(dimensionValue(r, 0)),
    eventCount: parseIntSafe(metricValue(r, 0)),
  }));
}

/**
 * Get conversion/key events with rates.
 * GA4 marks certain events as "key events" (formerly conversions).
 * We calculate rate as: users who triggered event / total users.
 */
export async function getGA4Conversions(propertyId: string, days: number = 28, dateRange?: CustomDateRange): Promise<GA4ConversionSummary[]> {
  const startDate = dateRange?.startDate || dateStr(days);
  const endDate = dateRange?.endDate || dateStr(1);

  // First get total users for the period
  const overviewData = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: 'totalUsers' }],
  }) as { rows?: Array<{ metricValues: Array<{ value: string }> }> };
  const totalUsers = parseIntSafe(metricValue(overviewData.rows?.[0], 0));

  const data = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'eventName' }],
    metrics: [
      { name: 'keyEvents' },
      { name: 'totalUsers' },
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'isKeyEvent',
        stringFilter: { matchType: 'EXACT', value: 'true' },
      },
    },
    orderBys: [{ metric: { metricName: 'keyEvents' }, desc: true }],
    limit: 50,
  }) as {
    rows?: Array<{
      dimensionValues: Array<{ value: string }>;
      metricValues: Array<{ value: string }>;
    }>;
  };

  return (data.rows || [])
    .map(r => {
      const users = parseIntSafe(metricValue(r, 1));
      return {
        eventName: dimensionValue(r, 0),
        conversions: parseIntSafe(metricValue(r, 0)),
        users,
        rate: totalUsers > 0 ? parseFloat(((users / totalUsers) * 100).toFixed(2)) : 0,
      };
    })
    .slice(0, 15);
}

export interface GA4EventPageBreakdown {
  eventName: string;
  pagePath: string;
  eventCount: number;
  users: number;
}

/**
 * Get event breakdown by page path, optionally filtered by event name or page path.
 */
export async function getGA4EventsByPage(
  propertyId: string,
  days: number = 28,
  options: { eventName?: string; pagePath?: string; limit?: number } = {},
  dateRange?: CustomDateRange,
): Promise<GA4EventPageBreakdown[]> {
  const startDate = dateRange?.startDate || dateStr(days);
  const endDate = dateRange?.endDate || dateStr(1);
  const limit = options.limit || 50;

  // Build dimension filters
  const filters: Array<{ filter: { fieldName: string; stringFilter: { matchType: string; value: string } } }> = [];
  if (options.eventName) {
    filters.push({ filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: options.eventName } } });
  }
  if (options.pagePath) {
    filters.push({ filter: { fieldName: 'pagePath', stringFilter: { matchType: 'CONTAINS', value: options.pagePath } } });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'eventName' }, { name: 'pagePath' }],
    metrics: [
      { name: 'eventCount' },
      { name: 'totalUsers' },
    ],
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit,
  };

  if (filters.length === 1) {
    body.dimensionFilter = filters[0];
  } else if (filters.length > 1) {
    body.dimensionFilter = { andGroup: { expressions: filters } };
  }

  const data = await runReport(propertyId, body) as {
    rows?: Array<{
      dimensionValues: Array<{ value: string }>;
      metricValues: Array<{ value: string }>;
    }>;
  };

  return (data.rows || []).map(r => ({
    eventName: dimensionValue(r, 0),
    pagePath: dimensionValue(r, 1),
    eventCount: parseIntSafe(metricValue(r, 0)),
    users: parseIntSafe(metricValue(r, 1)),
  }));
}

// ─── Phase 3: Landing Pages, Organic Filter, Period Comparison, Engagement ───

export interface GA4LandingPage {
  landingPage: string;
  sessions: number;
  users: number;
  bounceRate: number;
  avgEngagementTime: number;
  conversions: number;
}

/**
 * Get top landing pages — the first page users see when they arrive.
 * Critical for SEO: shows which pages drive organic entry traffic.
 */
export async function getGA4LandingPages(
  propertyId: string,
  days: number = 28,
  limit: number = 25,
  organicOnly: boolean = false,
  dateRange?: CustomDateRange,
): Promise<GA4LandingPage[]> {
  const startDate = dateRange?.startDate || dateStr(days);
  const endDate = dateRange?.endDate || dateStr(1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'landingPage' }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'bounceRate' },
      { name: 'userEngagementDuration' },
      { name: 'keyEvents' },
    ],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit,
  };

  if (organicOnly) {
    body.dimensionFilter = {
      filter: {
        fieldName: 'sessionDefaultChannelGroup',
        stringFilter: { matchType: 'EXACT', value: 'Organic Search' },
      },
    };
  }

  const data = await runReport(propertyId, body) as {
    rows?: Array<{
      dimensionValues: Array<{ value: string }>;
      metricValues: Array<{ value: string }>;
    }>;
  };

  return (data.rows || []).map(r => {
    const sessions = parseIntSafe(metricValue(r, 0));
    return {
      landingPage: dimensionValue(r, 0),
      sessions,
      users: parseIntSafe(metricValue(r, 1)),
      bounceRate: ga4RatePercent(metricValue(r, 2)),
      avgEngagementTime: sessions > 0
        ? parseFloatSafe(metricValue(r, 3)) / sessions
        : 0,
      conversions: parseIntSafe(metricValue(r, 4)),
    };
  });
}

export async function getGA4PageOrganicTrafficMap(
  propertyId: string,
  days: number = 28,
  limit: number = 500,
  dateRange?: CustomDateRange,
): Promise<Map<string, number>> {
  const pages = await getGA4LandingPages(propertyId, days, limit, true, dateRange);
  const trafficByPath = new Map<string, number>();
  for (const page of pages) {
    trafficByPath.set(normalizePageUrl(page.landingPage).toLowerCase(), page.sessions);
  }
  return trafficByPath;
}

export interface GA4OrganicOverview {
  organicUsers: number;
  organicSessions: number;
  organicPageviews: number;
  organicBounceRate: number;
  engagementRate: number;
  avgEngagementTime: number;
  shareOfTotalUsers: number;   // organic users as % of all users
  dateRange: { start: string; end: string };
}

/**
 * Get overview metrics filtered to Organic Search channel only.
 * Includes engagement rate (GA4's preferred metric over bounce rate).
 */
export async function getGA4OrganicOverview(
  propertyId: string,
  days: number = 28,
  dateRange?: CustomDateRange,
): Promise<GA4OrganicOverview> {
  const startDate = dateRange?.startDate || dateStr(days);
  const endDate = dateRange?.endDate || dateStr(1);

  // Get organic metrics
  const organicData = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'bounceRate' },
      { name: 'engagementRate' },
      { name: 'userEngagementDuration' },
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'sessionDefaultChannelGroup',
        stringFilter: { matchType: 'EXACT', value: 'Organic Search' },
      },
    },
  }) as { rows?: Array<{ metricValues: Array<{ value: string }> }> };

  // Get total users for share calculation
  const totalData = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: 'totalUsers' }],
  }) as { rows?: Array<{ metricValues: Array<{ value: string }> }> };

  const row = organicData.rows?.[0]?.metricValues;
  const totalUsers = parseIntSafe(metricValue(totalData.rows?.[0], 0));
  const organicUsers = parseInt(row?.[0]?.value || '0');
  const organicSessions = parseInt(row?.[1]?.value || '0');

  return {
    organicUsers,
    organicSessions,
    organicPageviews: parseInt(row?.[2]?.value || '0'),
    organicBounceRate: ga4RatePercent(row?.[3]?.value),
    engagementRate: ga4RatePercent(row?.[4]?.value),
    avgEngagementTime: organicSessions > 0
      ? parseFloat(row?.[5]?.value || '0') / organicSessions
      : 0,
    shareOfTotalUsers: totalUsers > 0
      ? parseFloat(((organicUsers / totalUsers) * 100).toFixed(1))
      : 0,
    dateRange: { start: startDate, end: endDate },
  };
}

export interface GA4PeriodComparison {
  current: GA4Overview;
  previous: GA4Overview;
  change: {
    users: number; sessions: number; pageviews: number;
    bounceRate: number; avgSessionDuration: number;
  };
  changePercent: {
    users: number; sessions: number; pageviews: number;
  };
}

/**
 * Compare current period vs previous period for GA4 overview metrics.
 * Uses GA4's native dual date range support (single API call).
 */
export async function getGA4PeriodComparison(
  propertyId: string,
  days: number = 28,
  dateRange?: CustomDateRange,
): Promise<GA4PeriodComparison> {
  let curStart = dateRange?.startDate || dateStr(days);
  let curEnd = dateRange?.endDate || dateStr(1);
  const curStartDate = new Date(`${curStart}T00:00:00.000Z`);
  const curEndDate = new Date(`${curEnd}T00:00:00.000Z`);
  if (
    !Number.isFinite(curStartDate.getTime()) ||
    !Number.isFinite(curEndDate.getTime()) ||
    curEndDate.getTime() < curStartDate.getTime()
  ) {
    curStart = dateStr(days);
    curEnd = dateStr(1);
  }

  // Compute previous period from the span of the current period
  const curSpanMs = new Date(`${curEnd}T00:00:00.000Z`).getTime() - new Date(`${curStart}T00:00:00.000Z`).getTime();
  const curSpanDays = Math.max(1, Math.round(curSpanMs / (1000 * 60 * 60 * 24)) + 1);
  const prevEnd = new Date(`${curStart}T00:00:00.000Z`); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - curSpanDays + 1);
  const fmtD = (d: Date) => d.toISOString().split('T')[0];

  const data = await runReport(propertyId, {
    dateRanges: [
      { startDate: curStart, endDate: curEnd },
      { startDate: fmtD(prevStart), endDate: fmtD(prevEnd) },
    ],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'averageSessionDuration' },
      { name: 'bounceRate' },
      { name: 'newUsers' },
    ],
  }) as { rows?: Array<{ metricValues: Array<{ value: string }> }> };

  const parse = (rowIdx: number) => {
    const row = data.rows?.[rowIdx]?.metricValues;
    const totalUsers = parseInt(row?.[0]?.value || '0');
    const newUsers = parseInt(row?.[5]?.value || '0');
    return {
      totalUsers,
      totalSessions: parseInt(row?.[1]?.value || '0'),
      totalPageviews: parseInt(row?.[2]?.value || '0'),
      avgSessionDuration: parseFloat(row?.[3]?.value || '0'),
      bounceRate: ga4RatePercent(row?.[4]?.value),
      newUserPercentage: totalUsers > 0 ? parseFloat(((newUsers / totalUsers) * 100).toFixed(1)) : 0,
      dateRange: { start: '', end: '' },
    };
  };

  const current = { ...parse(0), dateRange: { start: curStart, end: curEnd } };
  const previous = { ...parse(1), dateRange: { start: fmtD(prevStart), end: fmtD(prevEnd) } };

  const pct = (c: number, p: number) => p === 0 ? (c > 0 ? 100 : 0) : parseFloat((((c - p) / p) * 100).toFixed(1));

  return {
    current,
    previous,
    change: {
      users: current.totalUsers - previous.totalUsers,
      sessions: current.totalSessions - previous.totalSessions,
      pageviews: current.totalPageviews - previous.totalPageviews,
      bounceRate: parseFloat((current.bounceRate - previous.bounceRate).toFixed(1)),
      avgSessionDuration: parseFloat((current.avgSessionDuration - previous.avgSessionDuration).toFixed(1)),
    },
    changePercent: {
      users: pct(current.totalUsers, previous.totalUsers),
      sessions: pct(current.totalSessions, previous.totalSessions),
      pageviews: pct(current.totalPageviews, previous.totalPageviews),
    },
  };
}

export interface GA4NewVsReturning {
  segment: string;   // 'new' | 'returning'
  users: number;
  sessions: number;
  bounceRate: number;
  engagementRate: number;
  avgEngagementTime: number;
  percentage: number;
}

/**
 * New vs returning user comparison.
 */
export async function getGA4NewVsReturning(
  propertyId: string,
  days: number = 28,
  dateRange?: CustomDateRange,
): Promise<GA4NewVsReturning[]> {
  const startDate = dateRange?.startDate || dateStr(days);
  const endDate = dateRange?.endDate || dateStr(1);

  const data = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'newVsReturning' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'bounceRate' },
      { name: 'engagementRate' },
      { name: 'userEngagementDuration' },
    ],
    orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
  }) as {
    rows?: Array<{
      dimensionValues: Array<{ value: string }>;
      metricValues: Array<{ value: string }>;
    }>;
  };

  const rows = (data.rows || []).map(r => {
    const sessions = parseIntSafe(metricValue(r, 1));
    return {
      segment: dimensionValue(r, 0),
      users: parseIntSafe(metricValue(r, 0)),
      sessions,
      bounceRate: ga4RatePercent(metricValue(r, 2)),
      engagementRate: ga4RatePercent(metricValue(r, 3)),
      avgEngagementTime: sessions > 0 ? parseFloatSafe(metricValue(r, 4)) / sessions : 0,
      percentage: 0,
    };
  });
  const totalUsers = rows.reduce((s, r) => s + r.users, 0);
  rows.forEach(r => r.percentage = totalUsers > 0 ? parseFloat(((r.users / totalUsers) * 100).toFixed(1)) : 0);
  return rows;
}

export async function getGA4Countries(propertyId: string, days: number = 28, limit: number = 10, dateRange?: CustomDateRange): Promise<GA4CountryBreakdown[]> {
  const startDate = dateRange?.startDate || dateStr(days);
  const endDate = dateRange?.endDate || dateStr(1);

  const data = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'country' }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'sessions' },
    ],
    orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
    limit,
  }) as {
    rows?: Array<{
      dimensionValues: Array<{ value: string }>;
      metricValues: Array<{ value: string }>;
    }>;
  };

  return (data.rows || []).map(r => ({
    country: dimensionValue(r, 0),
    users: parseIntSafe(metricValue(r, 0)),
    sessions: parseIntSafe(metricValue(r, 1)),
  }));
}

/**
 * Find the landing page with the largest absolute user drop between the current
 * and previous period. Used by anomaly detection to populate
 * `AnomalyDigestData.affectedPage` so the diagnostic orchestrator can run
 * page-specific probes (position history, canonical, internal links).
 *
 * Makes 2 GA4 API calls — call once per workspace per detection run.
 * Returns the page path (e.g. "/blog/article"), or null if no data is available.
 */
export async function getTopDroppedGA4Page(
  propertyId: string,
  days: number = 28,
): Promise<string | null> {
  const curEnd = dateStr(1);
  const curStart = dateStr(days);
  const curSpanMs = new Date(curEnd).getTime() - new Date(curStart).getTime();
  const curSpanDays = Math.round(curSpanMs / (1000 * 60 * 60 * 24)) + 1;
  const prevEndDate = new Date(curStart);
  prevEndDate.setDate(prevEndDate.getDate() - 1);
  const prevStartDate = new Date(prevEndDate);
  prevStartDate.setDate(prevStartDate.getDate() - curSpanDays + 1);
  const fmtD = (d: Date) => d.toISOString().split('T')[0];

  type PageRow = {
    dimensionValues: Array<{ value: string }>;
    metricValues: Array<{ value: string }>;
  };

  const [curData, prevData] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [{ startDate: curStart, endDate: curEnd }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'totalUsers' }],
      orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
      limit: 100,
    }),
    runReport(propertyId, {
      dateRanges: [{ startDate: fmtD(prevStartDate), endDate: fmtD(prevEndDate) }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'totalUsers' }],
      orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
      limit: 100,
    }),
  ]) as [{ rows?: PageRow[] }, { rows?: PageRow[] }];

  if (!curData.rows?.length || !prevData.rows?.length) return null;

  const prevByPage = new Map<string, number>();
  for (const row of prevData.rows) {
    prevByPage.set(dimensionValue(row, 0), parseIntSafe(metricValue(row, 0)));
  }

  let topPage: string | null = null;
  let maxDrop = 0;
  for (const row of curData.rows) {
    const page = dimensionValue(row, 0);
    const curUsers = parseIntSafe(metricValue(row, 0));
    const prevUsers = prevByPage.get(page) ?? 0;
    const drop = prevUsers - curUsers;
    if (drop > maxDrop) {
      maxDrop = drop;
      topPage = page;
    }
  }

  // Also check pages that appeared in prev but not in cur (dropped to zero entirely)
  const curPages = new Set(curData.rows.map(r => dimensionValue(r, 0)));
  for (const [page, prevUsers] of prevByPage) {
    if (!curPages.has(page) && prevUsers > maxDrop) {
      maxDrop = prevUsers;
      topPage = page;
    }
  }

  if (!topPage) return null;
  // GA4 landingPage may be a full URL or a path — normalize to pathname, strip query string
  try {
    if (topPage.startsWith('http')) {
      return new URL(topPage).pathname.split('?')[0];
    }
    return topPage.split('?')[0];
  } catch (err) {
    return topPage.startsWith('/') ? topPage.split('?')[0] : null;
  }
}

/**
 * Find the landing page with the largest absolute user *increase* between the
 * current and previous period. Used by anomaly detection to populate
 * `AnomalyDigestData.affectedPage` for traffic_spike anomalies.
 *
 * Makes 2 GA4 API calls — call once per workspace per detection run.
 * Returns the page path (e.g. "/blog/article"), or null if no data is available.
 */
export async function getTopSpikedGA4Page(
  propertyId: string,
  days: number = 28,
): Promise<string | null> {
  const curEnd = dateStr(1);
  const curStart = dateStr(days);
  const curSpanMs = new Date(curEnd).getTime() - new Date(curStart).getTime();
  const curSpanDays = Math.round(curSpanMs / (1000 * 60 * 60 * 24)) + 1;
  const prevEndDate = new Date(curStart);
  prevEndDate.setDate(prevEndDate.getDate() - 1);
  const prevStartDate = new Date(prevEndDate);
  prevStartDate.setDate(prevStartDate.getDate() - curSpanDays + 1);
  const fmtD = (d: Date) => d.toISOString().split('T')[0];

  type PageRow = {
    dimensionValues: Array<{ value: string }>;
    metricValues: Array<{ value: string }>;
  };

  const [curData, prevData] = await Promise.all([
    runReport(propertyId, {
      dateRanges: [{ startDate: curStart, endDate: curEnd }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'totalUsers' }],
      orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
      limit: 100,
    }),
    runReport(propertyId, {
      dateRanges: [{ startDate: fmtD(prevStartDate), endDate: fmtD(prevEndDate) }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [{ name: 'totalUsers' }],
      orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
      limit: 100,
    }),
  ]) as [{ rows?: PageRow[] }, { rows?: PageRow[] }];

  if (!curData.rows?.length) return null;

  const prevByPage = new Map<string, number>();
  for (const row of (prevData.rows ?? [])) {
    prevByPage.set(dimensionValue(row, 0), parseIntSafe(metricValue(row, 0)));
  }

  let topPage: string | null = null;
  let maxSpike = 0;
  for (const row of curData.rows) {
    const page = dimensionValue(row, 0);
    const curUsers = parseIntSafe(metricValue(row, 0));
    const prevUsers = prevByPage.get(page) ?? 0;
    const spike = curUsers - prevUsers; // positive = increased
    if (spike > maxSpike) {
      maxSpike = spike;
      topPage = page;
    }
  }

  if (!topPage) return null;
  try {
    if (topPage.startsWith('http')) {
      return new URL(topPage).pathname.split('?')[0];
    }
    return topPage.split('?')[0];
  } catch (err) {
    return topPage.startsWith('/') ? topPage.split('?')[0] : null;
  }
}
