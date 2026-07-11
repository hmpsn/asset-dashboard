import type {
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource,
  GA4DeviceBreakdown, GA4CountryBreakdown, GA4ConversionSummary,
  GA4Comparison, GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage,
} from '../../../shared/types/analytics';
import { ga4Admin } from '../../api/analytics';
import { useGA4Base, type GA4Metric } from '../shared/useGA4Base';
import { STALE_TIMES } from '../../lib/queryClient';

export interface AdminGA4Data {
  overview: GA4Overview | null;
  trend: GA4DailyTrend[];
  topPages: GA4TopPage[];
  sources: GA4TopSource[];
  devices: GA4DeviceBreakdown[];
  countries: GA4CountryBreakdown[];
  comparison: GA4Comparison | null;
  newVsReturning: GA4NewVsReturning[];
  organic: GA4OrganicOverview | null;
  landingPages: GA4LandingPage[];
  conversions: GA4ConversionSummary[];
  isLoading: boolean;
  error: string | null;
}

export function useAdminGA4(
  workspaceId: string,
  days: number,
  enabled: boolean,
  metrics?: readonly GA4Metric[],
): AdminGA4Data {
  const {
    overviewQ, trendQ, topPagesQ, sourcesQ, devicesQ, countriesQ,
    comparisonQ, nvrQ, organicQ, landingQ, conversionsQ,
  } = useGA4Base({
    wsId: workspaceId,
    days,
    enabled,
    metrics,
    keyPrefix: 'admin-ga4',
    staleTime: STALE_TIMES.ANALYTICS,
    api: ga4Admin,
  });

  const firstError = overviewQ.error || trendQ.error;
  const errorMsg = firstError
    ? (firstError instanceof Error ? firstError.message : 'Failed to load analytics data')
    : null;

  const metricSelected = (metric: GA4Metric) => !metrics || metrics.includes(metric);

  return {
    overview: (overviewQ.data ?? null) as GA4Overview | null,
    trend: trendQ.data ?? [],
    topPages: topPagesQ.data ?? [],
    sources: sourcesQ.data ?? [],
    devices: devicesQ.data ?? [],
    countries: countriesQ.data ?? [],
    comparison: (comparisonQ.data ?? null) as GA4Comparison | null,
    newVsReturning: nvrQ.data ?? [],
    organic: (organicQ.data ?? null) as GA4OrganicOverview | null,
    landingPages: landingQ.data ?? [],
    conversions: conversionsQ.data ?? [],
    isLoading: metrics
      ? (metricSelected('overview') && overviewQ.isLoading)
        || (metricSelected('trend') && trendQ.isLoading)
        || (metricSelected('topPages') && topPagesQ.isLoading)
        || (metricSelected('sources') && sourcesQ.isLoading)
        || (metricSelected('devices') && devicesQ.isLoading)
        || (metricSelected('countries') && countriesQ.isLoading)
        || (metricSelected('comparison') && comparisonQ.isLoading)
        || (metricSelected('newVsReturning') && nvrQ.isLoading)
        || (metricSelected('organic') && organicQ.isLoading)
        || (metricSelected('landingPages') && landingQ.isLoading)
        || (metricSelected('conversions') && conversionsQ.isLoading)
      : overviewQ.isLoading,
    error: errorMsg,
  };
}
