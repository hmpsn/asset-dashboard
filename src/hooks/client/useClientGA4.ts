import type {
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource,
  GA4DeviceBreakdown, GA4CountryBreakdown, GA4Event, GA4ConversionSummary,
  GA4Comparison, GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage,
} from '../../components/client/types';
import { useGA4Base } from '../shared/useGA4Base';

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
  const {
    overviewQ, trendQ, topPagesQ, sourcesQ, devicesQ, countriesQ,
    comparisonQ, nvrQ, organicQ, landingQ, conversionsQ, eventsQ,
  } = useGA4Base({
    wsId,
    days,
    dateRange,
    enabled,
    keyPrefix: 'client-ga4',
    includeEvents: true,
    landingOpts: { organic: true, limit: 15 },
  });

  // Aggregate partial failures
  const failedKeys: string[] = [];
  if (overviewQ.error) failedKeys.push('overview');
  if (trendQ.error) failedKeys.push('trend');
  if (topPagesQ.error) failedKeys.push('pages');
  if (sourcesQ.error) failedKeys.push('sources');
  if (devicesQ.error) failedKeys.push('devices');
  if (countriesQ.error) failedKeys.push('countries');
  if (eventsQ.error) failedKeys.push('events');
  if (conversionsQ.error) failedKeys.push('conversions');
  if (comparisonQ.error) failedKeys.push('comparison');
  if (nvrQ.error) failedKeys.push('nvr');
  if (organicQ.error) failedKeys.push('organic');
  if (landingQ.error) failedKeys.push('landing');

  const sectionError = failedKeys.length === 12
    ? 'Unable to load analytics data'
    : failedKeys.length > 0
      ? `Partial analytics load — failed: ${failedKeys.join(', ')}`
      : null;

  return {
    ga4Overview: (overviewQ.data ?? null) as GA4Overview | null,
    ga4Trend: trendQ.data ?? [],
    ga4Pages: topPagesQ.data ?? [],
    ga4Sources: sourcesQ.data ?? [],
    ga4Devices: devicesQ.data ?? [],
    ga4Countries: countriesQ.data ?? [],
    ga4Events: eventsQ.data ?? [],
    ga4Conversions: conversionsQ.data ?? [],
    ga4Comparison: (comparisonQ.data ?? null) as GA4Comparison | null,
    ga4NewVsReturning: nvrQ.data ?? [],
    ga4Organic: (organicQ.data ?? null) as GA4OrganicOverview | null,
    ga4LandingPages: landingQ.data ?? [],
    isLoading: overviewQ.isLoading || trendQ.isLoading,
    sectionError,
  };
}
