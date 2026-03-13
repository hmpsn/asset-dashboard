// ── Analytics API (GA4 + GSC) ──────────────────────────────────────
import { get, post, getSafe, getOptional } from './client';
import type {
  SearchOverview, PerformanceTrend, SearchComparison,
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource,
  GA4DeviceBreakdown, GA4CountryBreakdown, GA4Event, GA4EventTrend,
  GA4ConversionSummary, GA4EventPageBreakdown, GA4Comparison,
  GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage,
} from '../../shared/types/analytics';

// ── Query-string helper ────────────────────────────────────────────
function qs(days: number, dateRange?: { startDate: string; endDate: string }): string {
  const dr = dateRange ? `&startDate=${dateRange.startDate}&endDate=${dateRange.endDate}` : '';
  return `?days=${days}${dr}`;
}

// ── Search Console (GSC) ───────────────────────────────────────────
export const gsc = {
  overview: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getOptional<SearchOverview>(`/api/public/search-overview/${wsId}${qs(days, dateRange)}`),

  trend: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getSafe<PerformanceTrend[]>(`/api/public/performance-trend/${wsId}${qs(days, dateRange)}`, []),

  comparison: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getSafe<SearchComparison | null>(`/api/public/search-comparison/${wsId}${qs(days, dateRange)}`, null),

  devices: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getSafe<unknown[]>(`/api/public/search-devices/${wsId}${qs(days, dateRange)}`, []),
};

// ── Google Analytics 4 (GA4) ───────────────────────────────────────
export const ga4 = {
  overview: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getOptional<GA4Overview>(`/api/public/analytics-overview/${wsId}${qs(days, dateRange)}`),

  trend: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getSafe<GA4DailyTrend[]>(`/api/public/analytics-trend/${wsId}${qs(days, dateRange)}`, []),

  topPages: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getSafe<GA4TopPage[]>(`/api/public/analytics-top-pages/${wsId}${qs(days, dateRange)}`, []),

  sources: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getSafe<GA4TopSource[]>(`/api/public/analytics-sources/${wsId}${qs(days, dateRange)}`, []),

  devices: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getSafe<GA4DeviceBreakdown[]>(`/api/public/analytics-devices/${wsId}${qs(days, dateRange)}`, []),

  countries: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getSafe<GA4CountryBreakdown[]>(`/api/public/analytics-countries/${wsId}${qs(days, dateRange)}`, []),

  events: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getSafe<GA4Event[]>(`/api/public/analytics-events/${wsId}${qs(days, dateRange)}`, []),

  eventTrend: (wsId: string, eventName: string, days: number) =>
    getSafe<GA4EventTrend[]>(`/api/public/analytics-event-trend/${wsId}?eventName=${encodeURIComponent(eventName)}&days=${days}`, []),

  eventPages: (wsId: string, eventName: string, days: number) =>
    getSafe<GA4EventPageBreakdown[]>(`/api/public/analytics-event-pages/${wsId}?eventName=${encodeURIComponent(eventName)}&days=${days}`, []),

  conversions: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getSafe<GA4ConversionSummary[]>(`/api/public/analytics-conversions/${wsId}${qs(days, dateRange)}`, []),

  comparison: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getSafe<GA4Comparison | null>(`/api/public/analytics-comparison/${wsId}${qs(days, dateRange)}`, null),

  newVsReturning: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getSafe<GA4NewVsReturning[]>(`/api/public/analytics-new-vs-returning/${wsId}${qs(days, dateRange)}`, []),

  organic: (wsId: string, days: number, dateRange?: { startDate: string; endDate: string }) =>
    getSafe<GA4OrganicOverview | null>(`/api/public/analytics-organic/${wsId}${qs(days, dateRange)}`, null),

  landingPages: (wsId: string, days: number, opts?: { dateRange?: { startDate: string; endDate: string }; organic?: boolean; limit?: number }) => {
    let url = `/api/public/analytics-landing-pages/${wsId}${qs(days, opts?.dateRange)}`;
    if (opts?.organic) url += '&organic=true';
    if (opts?.limit) url += `&limit=${opts.limit}`;
    return getSafe<GA4LandingPage[]>(url, []);
  },
};

// ── Admin GSC endpoints (require auth, used in admin dashboard) ──
function gscQs(gscSiteUrl: string, days: number): string {
  return `gscSiteUrl=${encodeURIComponent(gscSiteUrl)}&days=${days}`;
}

export const gscAdmin = {
  overview: (siteId: string, gscSiteUrl: string, days: number) =>
    getOptional<SearchOverview>(`/api/google/search-overview/${siteId}?${gscQs(gscSiteUrl, days)}`),

  trend: (siteId: string, gscSiteUrl: string, days: number) =>
    getSafe<PerformanceTrend[]>(`/api/google/performance-trend/${siteId}?${gscQs(gscSiteUrl, days)}`, []),

  devices: (siteId: string, gscSiteUrl: string, days: number) =>
    getSafe<unknown[]>(`/api/google/search-devices/${siteId}?${gscQs(gscSiteUrl, days)}`, []),

  countries: (siteId: string, gscSiteUrl: string, days: number) =>
    getSafe<unknown[]>(`/api/google/search-countries/${siteId}?${gscQs(gscSiteUrl, days)}`, []),

  searchTypes: (siteId: string, gscSiteUrl: string, days: number) =>
    getSafe<unknown[]>(`/api/google/search-types/${siteId}?${gscQs(gscSiteUrl, days)}`, []),

  comparison: (siteId: string, gscSiteUrl: string, days: number) =>
    getSafe<SearchComparison | null>(`/api/google/search-comparison/${siteId}?${gscQs(gscSiteUrl, days)}`, null),

  chat: (siteId: string, body: { question: string; context: Record<string, unknown> }) =>
    post<{ answer: string }>(`/api/google/search-chat/${siteId}`, body),
};
