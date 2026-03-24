import { useQuery } from '@tanstack/react-query';
import { ga4 } from '../../api/analytics';
import type {
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource,
  GA4DeviceBreakdown, GA4CountryBreakdown, GA4Comparison,
  GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage, GA4ConversionSummary,
} from '../../../shared/types/analytics';

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

export function useAdminGA4(workspaceId: string, days: number, enabled: boolean): AdminGA4Data {
  const overviewQ = useQuery({
    queryKey: ['admin-ga4-overview', workspaceId, days],
    queryFn: () => ga4.overview(workspaceId, days),
    enabled,
  });

  const trendQ = useQuery({
    queryKey: ['admin-ga4-trend', workspaceId, days],
    queryFn: () => ga4.trend(workspaceId, days),
    enabled,
  });

  const topPagesQ = useQuery({
    queryKey: ['admin-ga4-pages', workspaceId, days],
    queryFn: () => ga4.topPages(workspaceId, days),
    enabled,
  });

  const sourcesQ = useQuery({
    queryKey: ['admin-ga4-sources', workspaceId, days],
    queryFn: () => ga4.sources(workspaceId, days),
    enabled,
  });

  const devicesQ = useQuery({
    queryKey: ['admin-ga4-devices', workspaceId, days],
    queryFn: () => ga4.devices(workspaceId, days),
    enabled,
  });

  const countriesQ = useQuery({
    queryKey: ['admin-ga4-countries', workspaceId, days],
    queryFn: () => ga4.countries(workspaceId, days),
    enabled,
  });

  const comparisonQ = useQuery({
    queryKey: ['admin-ga4-comparison', workspaceId, days],
    queryFn: () => ga4.comparison(workspaceId, days),
    enabled,
  });

  const nvrQ = useQuery({
    queryKey: ['admin-ga4-nvr', workspaceId, days],
    queryFn: () => ga4.newVsReturning(workspaceId, days),
    enabled,
  });

  const organicQ = useQuery({
    queryKey: ['admin-ga4-organic', workspaceId, days],
    queryFn: () => ga4.organic(workspaceId, days),
    enabled,
  });

  const landingQ = useQuery({
    queryKey: ['admin-ga4-landing', workspaceId, days],
    queryFn: () => ga4.landingPages(workspaceId, days),
    enabled,
  });

  const conversionsQ = useQuery({
    queryKey: ['admin-ga4-conversions', workspaceId, days],
    queryFn: () => ga4.conversions(workspaceId, days),
    enabled,
  });

  const firstError = overviewQ.error || trendQ.error;
  const errorMsg = firstError
    ? (firstError instanceof Error ? firstError.message : 'Failed to load analytics data')
    : null;

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
    isLoading: overviewQ.isLoading,
    error: errorMsg,
  };
}
