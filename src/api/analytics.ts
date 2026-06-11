// ── Analytics API (GA4 + GSC) ──────────────────────────────────────
import { get, post, getOptional } from './client';
import type {
  SearchOverview, PerformanceTrend, SearchComparison,
  SearchDeviceBreakdown, SearchCountryBreakdown, SearchTypeBreakdown,
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource,
  GA4DeviceBreakdown, GA4CountryBreakdown, GA4Event, GA4EventTrend,
  GA4ConversionSummary, GA4EventPageBreakdown, GA4Comparison,
  GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage,
} from '../../shared/types/analytics';
import type { ClientIntelligence } from '../../shared/types/intelligence.js';
import type { AnalyticsDateRange } from '../../shared/types/analytics-contract.js';

// ── Query-string helper ────────────────────────────────────────────
function qs(days: number, dateRange?: AnalyticsDateRange): string {
  const dr = dateRange ? `&startDate=${dateRange.startDate}&endDate=${dateRange.endDate}` : '';
  return `?days=${days}${dr}`;
}

// ── Search Console (GSC) ───────────────────────────────────────────
export const gsc = {
  overview: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    getOptional<SearchOverview>(`/api/public/search-overview/${wsId}${qs(days, dateRange)}`),

  trend: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    get<PerformanceTrend[]>(`/api/public/performance-trend/${wsId}${qs(days, dateRange)}`),

  comparison: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    getOptional<SearchComparison>(`/api/public/search-comparison/${wsId}${qs(days, dateRange)}`),

  devices: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    get<SearchDeviceBreakdown[]>(`/api/public/search-devices/${wsId}${qs(days, dateRange)}`),
};

// ── Google Analytics 4 (GA4) ───────────────────────────────────────
export const ga4 = {
  overview: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    getOptional<GA4Overview>(`/api/public/analytics-overview/${wsId}${qs(days, dateRange)}`),

  trend: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    get<GA4DailyTrend[]>(`/api/public/analytics-trend/${wsId}${qs(days, dateRange)}`),

  topPages: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    get<GA4TopPage[]>(`/api/public/analytics-top-pages/${wsId}${qs(days, dateRange)}`),

  sources: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    get<GA4TopSource[]>(`/api/public/analytics-sources/${wsId}${qs(days, dateRange)}`),

  devices: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    get<GA4DeviceBreakdown[]>(`/api/public/analytics-devices/${wsId}${qs(days, dateRange)}`),

  countries: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    get<GA4CountryBreakdown[]>(`/api/public/analytics-countries/${wsId}${qs(days, dateRange)}`),

  events: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    get<GA4Event[]>(`/api/public/analytics-events/${wsId}${qs(days, dateRange)}`),

  eventTrend: (wsId: string, eventName: string, days: number, dateRange?: AnalyticsDateRange) =>
    get<GA4EventTrend[]>(`/api/public/analytics-event-trend/${wsId}?event=${encodeURIComponent(eventName)}&days=${days}${dateRange ? `&startDate=${dateRange.startDate}&endDate=${dateRange.endDate}` : ''}`),

  eventPages: (wsId: string, eventName: string, days: number, dateRange?: AnalyticsDateRange) =>
    get<GA4EventPageBreakdown[]>(`/api/public/analytics-event-explorer/${wsId}?event=${encodeURIComponent(eventName)}&days=${days}${dateRange ? `&startDate=${dateRange.startDate}&endDate=${dateRange.endDate}` : ''}`),

  conversions: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    get<GA4ConversionSummary[]>(`/api/public/analytics-conversions/${wsId}${qs(days, dateRange)}`),

  comparison: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    getOptional<GA4Comparison>(`/api/public/analytics-comparison/${wsId}${qs(days, dateRange)}`),

  newVsReturning: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    get<GA4NewVsReturning[]>(`/api/public/analytics-new-vs-returning/${wsId}${qs(days, dateRange)}`),

  organic: (wsId: string, days: number, dateRange?: AnalyticsDateRange) =>
    getOptional<GA4OrganicOverview>(`/api/public/analytics-organic/${wsId}${qs(days, dateRange)}`),

  landingPages: (wsId: string, days: number, opts?: { dateRange?: AnalyticsDateRange; organic?: boolean; limit?: number }) => {
    let url = `/api/public/analytics-landing-pages/${wsId}${qs(days, opts?.dateRange)}`;
    if (opts?.organic) url += '&organic=true';
    if (opts?.limit) url += `&limit=${opts.limit}`;
    return get<GA4LandingPage[]>(url);
  },
};

// ── Admin GA4 endpoints (admin auth, independent of client portal visibility) ──
export const ga4Admin = {
  overview: (wsId: string, days: number) =>
    getOptional<GA4Overview>(`/api/google/analytics-overview/${wsId}?days=${days}`),

  trend: (wsId: string, days: number) =>
    get<GA4DailyTrend[]>(`/api/google/analytics-trend/${wsId}?days=${days}`),

  topPages: (wsId: string, days: number) =>
    get<GA4TopPage[]>(`/api/google/analytics-top-pages/${wsId}?days=${days}`),

  sources: (wsId: string, days: number) =>
    get<GA4TopSource[]>(`/api/google/analytics-sources/${wsId}?days=${days}`),

  devices: (wsId: string, days: number) =>
    get<GA4DeviceBreakdown[]>(`/api/google/analytics-devices/${wsId}?days=${days}`),

  countries: (wsId: string, days: number) =>
    get<GA4CountryBreakdown[]>(`/api/google/analytics-countries/${wsId}?days=${days}`),

  conversions: (wsId: string, days: number) =>
    get<GA4ConversionSummary[]>(`/api/google/analytics-conversions/${wsId}?days=${days}`),

  comparison: (wsId: string, days: number) =>
    getOptional<GA4Comparison>(`/api/google/analytics-comparison/${wsId}?days=${days}`),

  newVsReturning: (wsId: string, days: number) =>
    get<GA4NewVsReturning[]>(`/api/google/analytics-new-vs-returning/${wsId}?days=${days}`),

  organic: (wsId: string, days: number) =>
    getOptional<GA4OrganicOverview>(`/api/google/analytics-organic/${wsId}?days=${days}`),

  landingPages: (wsId: string, days: number, opts?: { organic?: boolean; limit?: number }) => {
    let url = `/api/google/analytics-landing-pages/${wsId}?days=${days}`;
    if (opts?.organic) url += '&organic=true';
    if (opts?.limit) url += `&limit=${opts.limit}`;
    return get<GA4LandingPage[]>(url);
  },
};

// ── Admin GSC endpoints (require auth, used in admin dashboard) ──
function gscQs(workspaceId: string, gscSiteUrl: string, days: number): string {
  return `workspaceId=${encodeURIComponent(workspaceId)}&gscSiteUrl=${encodeURIComponent(gscSiteUrl)}&days=${days}`;
}

export const gscAdmin = {
  overview: (workspaceId: string, siteId: string, gscSiteUrl: string, days: number) =>
    getOptional<SearchOverview>(`/api/google/search-overview/${siteId}?${gscQs(workspaceId, gscSiteUrl, days)}`),

  trend: (workspaceId: string, siteId: string, gscSiteUrl: string, days: number) =>
    get<PerformanceTrend[]>(`/api/google/performance-trend/${siteId}?${gscQs(workspaceId, gscSiteUrl, days)}`),

  devices: (workspaceId: string, siteId: string, gscSiteUrl: string, days: number) =>
    get<SearchDeviceBreakdown[]>(`/api/google/search-devices/${siteId}?${gscQs(workspaceId, gscSiteUrl, days)}`),

  countries: (workspaceId: string, siteId: string, gscSiteUrl: string, days: number) =>
    get<SearchCountryBreakdown[]>(`/api/google/search-countries/${siteId}?${gscQs(workspaceId, gscSiteUrl, days)}`),

  searchTypes: (workspaceId: string, siteId: string, gscSiteUrl: string, days: number) =>
    get<SearchTypeBreakdown[]>(`/api/google/search-types/${siteId}?${gscQs(workspaceId, gscSiteUrl, days)}`),

  comparison: (workspaceId: string, siteId: string, gscSiteUrl: string, days: number) =>
    getOptional<SearchComparison>(`/api/google/search-comparison/${siteId}?${gscQs(workspaceId, gscSiteUrl, days)}`),

  chat: (workspaceId: string, siteId: string, body: { question: string; context: Record<string, unknown> }) =>
    post<{ answer: string }>(`/api/google/search-chat/${siteId}`, { ...body, workspaceId }),
};

// ── Client Intelligence ────────────────────────────────────────────
export async function fetchClientIntelligence(workspaceId: string): Promise<ClientIntelligence> {
  return get<ClientIntelligence>(`/api/public/intelligence/${workspaceId}`);
}
