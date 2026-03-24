import { useQuery } from '@tanstack/react-query';
import { ga4 } from '../../api/analytics';
import type {
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource,
  GA4DeviceBreakdown, GA4CountryBreakdown, GA4Event, GA4ConversionSummary,
  GA4Comparison, GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage,
} from '../../components/client/types';

export interface ClientGA4Data {
  ga4Overview: GA4Overview | null;
  ga4Trend: GA4DailyTrend[];
  ga4Pages: GA4TopPage[];
  ga4Sources: GA4TopSource[];
  ga4Devices: GA4DeviceBreakdown[];
  ga4Countries: GA4CountryBreakdown[];
  ga4Events: GA4Event[];
  ga4Conversions: GA4ConversionSummary[];
  ga4Comparison: GA4Comparison | null;
  ga4NewVsReturning: GA4NewVsReturning[];
  ga4Organic: GA4OrganicOverview | null;
  ga4LandingPages: GA4LandingPage[];
}

export function useClientGA4(
  wsId: string,
  days: number,
  dateRange: { startDate: string; endDate: string } | undefined,
  enabled: boolean,
) {
  const dr = dateRange;

  const overview = useQuery({
    queryKey: ['client-ga4-overview', wsId, days, dr],
    queryFn: () => ga4.overview(wsId, days, dr),
    enabled,
  });

  const trend = useQuery({
    queryKey: ['client-ga4-trend', wsId, days, dr],
    queryFn: () => ga4.trend(wsId, days, dr),
    enabled,
  });

  const pages = useQuery({
    queryKey: ['client-ga4-pages', wsId, days, dr],
    queryFn: () => ga4.topPages(wsId, days, dr),
    enabled,
  });

  const sources = useQuery({
    queryKey: ['client-ga4-sources', wsId, days, dr],
    queryFn: () => ga4.sources(wsId, days, dr),
    enabled,
  });

  const devices = useQuery({
    queryKey: ['client-ga4-devices', wsId, days, dr],
    queryFn: () => ga4.devices(wsId, days, dr),
    enabled,
  });

  const countries = useQuery({
    queryKey: ['client-ga4-countries', wsId, days, dr],
    queryFn: () => ga4.countries(wsId, days, dr),
    enabled,
  });

  const events = useQuery({
    queryKey: ['client-ga4-events', wsId, days, dr],
    queryFn: () => ga4.events(wsId, days, dr),
    enabled,
  });

  const conversions = useQuery({
    queryKey: ['client-ga4-conversions', wsId, days, dr],
    queryFn: () => ga4.conversions(wsId, days, dr),
    enabled,
  });

  const comparison = useQuery({
    queryKey: ['client-ga4-comparison', wsId, days, dr],
    queryFn: () => ga4.comparison(wsId, days, dr),
    enabled,
  });

  const nvr = useQuery({
    queryKey: ['client-ga4-nvr', wsId, days, dr],
    queryFn: () => ga4.newVsReturning(wsId, days, dr),
    enabled,
  });

  const organic = useQuery({
    queryKey: ['client-ga4-organic', wsId, days, dr],
    queryFn: () => ga4.organic(wsId, days, dr),
    enabled,
  });

  const landing = useQuery({
    queryKey: ['client-ga4-landing', wsId, days, dr],
    queryFn: () => ga4.landingPages(wsId, days, { dateRange: dr, organic: true, limit: 15 }),
    enabled,
  });

  // Aggregate section error — report partial failures
  const failedKeys: string[] = [];
  if (overview.error) failedKeys.push('overview');
  if (trend.error) failedKeys.push('trend');
  if (pages.error) failedKeys.push('pages');
  if (sources.error) failedKeys.push('sources');
  if (devices.error) failedKeys.push('devices');
  if (countries.error) failedKeys.push('countries');
  if (events.error) failedKeys.push('events');
  if (conversions.error) failedKeys.push('conversions');
  if (comparison.error) failedKeys.push('comparison');
  if (nvr.error) failedKeys.push('nvr');
  if (organic.error) failedKeys.push('organic');
  if (landing.error) failedKeys.push('landing');

  const sectionError = failedKeys.length === 12
    ? 'Unable to load analytics data'
    : failedKeys.length > 0
      ? `Partial analytics load — failed: ${failedKeys.join(', ')}`
      : null;

  return {
    ga4Overview: (overview.data ?? null) as GA4Overview | null,
    ga4Trend: trend.data ?? [],
    ga4Pages: pages.data ?? [],
    ga4Sources: sources.data ?? [],
    ga4Devices: devices.data ?? [],
    ga4Countries: countries.data ?? [],
    ga4Events: events.data ?? [],
    ga4Conversions: conversions.data ?? [],
    ga4Comparison: (comparison.data ?? null) as GA4Comparison | null,
    ga4NewVsReturning: nvr.data ?? [],
    ga4Organic: (organic.data ?? null) as GA4OrganicOverview | null,
    ga4LandingPages: landing.data ?? [],
    isLoading: overview.isLoading || trend.isLoading,
    sectionError,
  };
}
