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
import { isBrandedQuery } from './competitor-brand-filter.js';
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

export interface BrandedDemandSplit {
  status: 'ready' | 'unavailable';
  /** Branded impressions divided by all Search Console impressions, expressed as a percentage. */
  denominator: 'impressions';
  tokens: string[];
  queryRowsSampled: number;
  total: { clicks: number; impressions: number };
  branded: { clicks: number; impressions: number; sharePct: number };
  nonBranded: { clicks: number; impressions: number; sharePct: number };
}

function pct(part: number, total: number): number {
  return total > 0 ? +((part / total) * 100).toFixed(1) : 0;
}

export async function fetchBrandedDemandSplit(
  siteId: string,
  gscUrl: string,
  days: number,
  brandTokens: string[],
  dateRange?: CustomDateRange,
): Promise<BrandedDemandSplit> {
  const tokens = [...new Set(brandTokens.map((token) => token.trim().toLowerCase()).filter(Boolean))];
  if (tokens.length === 0) {
    return {
      status: 'unavailable',
      denominator: 'impressions',
      tokens,
      queryRowsSampled: 0,
      total: { clicks: 0, impressions: 0 },
      branded: { clicks: 0, impressions: 0, sharePct: 0 },
      nonBranded: { clicks: 0, impressions: 0, sharePct: 0 },
    };
  }

  const overview = await getSearchOverview(siteId, gscUrl, days, { queryLimit: 5000, pageLimit: 1 }, dateRange);
  const branded = overview.topQueries.reduce(
    (acc, row) => {
      if (!isBrandedQuery(row.query, tokens)) return acc;
      acc.clicks += row.clicks;
      acc.impressions += row.impressions;
      return acc;
    },
    { clicks: 0, impressions: 0 },
  );
  const total = {
    clicks: overview.totalClicks,
    impressions: overview.totalImpressions,
  };
  const nonBranded = {
    clicks: Math.max(0, total.clicks - branded.clicks),
    impressions: Math.max(0, total.impressions - branded.impressions),
  };

  return {
    status: 'ready',
    denominator: 'impressions',
    tokens,
    queryRowsSampled: overview.topQueries.length,
    total,
    branded: {
      ...branded,
      sharePct: pct(branded.impressions, total.impressions),
    },
    nonBranded: {
      ...nonBranded,
      sharePct: pct(nonBranded.impressions, total.impressions),
    },
  };
}
