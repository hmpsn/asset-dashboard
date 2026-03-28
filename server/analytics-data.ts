/**
 * Shared analytics data layer — thin wrappers over search-console.ts functions
 * that normalize the API (all accept optional dateRange) and serve as a single
 * import point for both admin (routes/google.ts) and client (routes/public-analytics.ts).
 */
import {
  getSearchOverview,
  getPerformanceTrend,
  getSearchDeviceBreakdown,
  getSearchCountryBreakdown,
  getSearchTypeBreakdown,
  getSearchPeriodComparison,
} from './search-console.js';
import type { CustomDateRange } from './google-analytics.js';

export type { CustomDateRange };

export async function fetchSearchOverview(
  siteId: string,
  gscUrl: string,
  days: number,
  dateRange?: CustomDateRange,
) {
  return getSearchOverview(siteId, gscUrl, days, {}, dateRange);
}

export async function fetchPerformanceTrend(
  siteId: string,
  gscUrl: string,
  days: number,
  dateRange?: CustomDateRange,
) {
  return getPerformanceTrend(siteId, gscUrl, days, dateRange);
}

export async function fetchSearchDevices(
  siteId: string,
  gscUrl: string,
  days: number,
  dateRange?: CustomDateRange,
) {
  return getSearchDeviceBreakdown(siteId, gscUrl, days, dateRange);
}

export async function fetchSearchCountries(
  siteId: string,
  gscUrl: string,
  days: number,
  limit: number,
  dateRange?: CustomDateRange,
) {
  return getSearchCountryBreakdown(siteId, gscUrl, days, limit, dateRange);
}

export async function fetchSearchTypes(
  siteId: string,
  gscUrl: string,
  days: number,
  dateRange?: CustomDateRange,
) {
  return getSearchTypeBreakdown(siteId, gscUrl, days, dateRange);
}

export async function fetchSearchComparison(
  siteId: string,
  gscUrl: string,
  days: number,
  dateRange?: CustomDateRange,
) {
  return getSearchPeriodComparison(siteId, gscUrl, days, dateRange);
}
