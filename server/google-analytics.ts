/**
 * Google Analytics 4 Data API integration.
 * Uses the GA4 Data API v1 to fetch analytics data for workspaces.
 * Requires the analytics.readonly scope in the Google OAuth flow.
 */

import { getGlobalToken } from './google-auth.js';

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

  const res = await fetch(`${GA4_ADMIN_API}/accountSummaries`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[ga4] Failed to list properties:', err);
    throw new Error(`Failed to list GA4 properties: ${res.status}`);
  }

  const data = await res.json() as {
    accountSummaries?: Array<{
      account: string;
      displayName: string;
      propertySummaries?: Array<{
        property: string;
        displayName: string;
      }>;
    }>;
  };

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

  const res = await fetch(`${GA4_API}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[ga4] Report failed:', err);
    throw new Error(`GA4 report failed: ${res.status}`);
  }

  return res.json();
}

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

/**
 * Get overview metrics for a GA4 property.
 */
export async function getGA4Overview(propertyId: string, days: number = 28): Promise<GA4Overview> {
  const startDate = dateStr(days);
  const endDate = dateStr(1);

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
  const totalUsers = parseInt(row?.[0]?.value || '0');
  const newUsers = parseInt(row?.[5]?.value || '0');

  return {
    totalUsers,
    totalSessions: parseInt(row?.[1]?.value || '0'),
    totalPageviews: parseInt(row?.[2]?.value || '0'),
    avgSessionDuration: parseFloat(row?.[3]?.value || '0'),
    bounceRate: parseFloat(parseFloat(row?.[4]?.value || '0').toFixed(1)),
    newUserPercentage: totalUsers > 0 ? parseFloat(((newUsers / totalUsers) * 100).toFixed(1)) : 0,
    dateRange: { start: startDate, end: endDate },
  };
}

/**
 * Get daily trend data.
 */
export async function getGA4DailyTrend(propertyId: string, days: number = 28): Promise<GA4DailyTrend[]> {
  const startDate = dateStr(days);
  const endDate = dateStr(1);

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
    date: r.dimensionValues[0].value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
    users: parseInt(r.metricValues[0].value),
    sessions: parseInt(r.metricValues[1].value),
    pageviews: parseInt(r.metricValues[2].value),
  }));
}

/**
 * Get top pages by pageviews.
 */
export async function getGA4TopPages(propertyId: string, days: number = 28, limit: number = 20): Promise<GA4TopPage[]> {
  const startDate = dateStr(days);
  const endDate = dateStr(1);

  const data = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'totalUsers' },
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

  return (data.rows || []).map(r => ({
    path: r.dimensionValues[0].value,
    pageviews: parseInt(r.metricValues[0].value),
    users: parseInt(r.metricValues[1].value),
    avgEngagementTime: parseFloat(r.metricValues[2].value) / Math.max(parseInt(r.metricValues[1].value), 1),
  }));
}

/**
 * Get top traffic sources.
 */
export async function getGA4TopSources(propertyId: string, days: number = 28, limit: number = 10): Promise<GA4TopSource[]> {
  const startDate = dateStr(days);
  const endDate = dateStr(1);

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
    source: r.dimensionValues[0].value,
    medium: r.dimensionValues[1].value,
    users: parseInt(r.metricValues[0].value),
    sessions: parseInt(r.metricValues[1].value),
  }));
}

/**
 * Get device category breakdown.
 */
export async function getGA4DeviceBreakdown(propertyId: string, days: number = 28): Promise<GA4DeviceBreakdown[]> {
  const startDate = dateStr(days);
  const endDate = dateStr(1);

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
    device: r.dimensionValues[0].value,
    users: parseInt(r.metricValues[0].value),
    sessions: parseInt(r.metricValues[1].value),
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
export async function getGA4KeyEvents(propertyId: string, days: number = 28, limit: number = 20): Promise<GA4Event[]> {
  const startDate = dateStr(days);
  const endDate = dateStr(1);

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
    eventName: r.dimensionValues[0].value,
    eventCount: parseInt(r.metricValues[0].value),
    users: parseInt(r.metricValues[1].value),
  }));
}

/**
 * Get daily trend for a specific event.
 */
export async function getGA4EventTrend(propertyId: string, eventName: string, days: number = 28): Promise<GA4EventTrend[]> {
  const startDate = dateStr(days);
  const endDate = dateStr(1);

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
    date: r.dimensionValues[0].value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
    eventCount: parseInt(r.metricValues[0].value),
  }));
}

/**
 * Get conversion/key events with rates.
 * GA4 marks certain events as "key events" (formerly conversions).
 * We calculate rate as: users who triggered event / total users.
 */
export async function getGA4Conversions(propertyId: string, days: number = 28): Promise<GA4ConversionSummary[]> {
  const startDate = dateStr(days);
  const endDate = dateStr(1);

  // First get total users for the period
  const overviewData = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: 'totalUsers' }],
  }) as { rows?: Array<{ metricValues: Array<{ value: string }> }> };
  const totalUsers = parseInt(overviewData.rows?.[0]?.metricValues[0]?.value || '0');

  // Get key events — filter out generic GA4 auto-events to focus on meaningful ones
  const autoEvents = new Set([
    'session_start', 'first_visit', 'page_view', 'scroll',
    'user_engagement', 'click', 'file_download',
  ]);

  const data = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'eventName' }],
    metrics: [
      { name: 'eventCount' },
      { name: 'totalUsers' },
    ],
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 50,
  }) as {
    rows?: Array<{
      dimensionValues: Array<{ value: string }>;
      metricValues: Array<{ value: string }>;
    }>;
  };

  return (data.rows || [])
    .filter(r => !autoEvents.has(r.dimensionValues[0].value))
    .map(r => {
      const users = parseInt(r.metricValues[1].value);
      return {
        eventName: r.dimensionValues[0].value,
        conversions: parseInt(r.metricValues[0].value),
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
): Promise<GA4EventPageBreakdown[]> {
  const startDate = dateStr(days);
  const endDate = dateStr(1);
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
    eventName: r.dimensionValues[0].value,
    pagePath: r.dimensionValues[1].value,
    eventCount: parseInt(r.metricValues[0].value),
    users: parseInt(r.metricValues[1].value),
  }));
}

export async function getGA4Countries(propertyId: string, days: number = 28, limit: number = 10): Promise<GA4CountryBreakdown[]> {
  const startDate = dateStr(days);
  const endDate = dateStr(1);

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
    country: r.dimensionValues[0].value,
    users: parseInt(r.metricValues[0].value),
    sessions: parseInt(r.metricValues[1].value),
  }));
}
