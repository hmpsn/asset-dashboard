/**
 * Shared GA4 base hook.
 *
 * Both useAdminGA4 and useClientGA4 delegate here to avoid duplicating
 * 11+ useQuery calls. The keyPrefix parameter ('admin-ga4' | 'client-ga4')
 * scopes the cache — prefix-based invalidation then works per-workspace:
 *   queryClient.invalidateQueries({ queryKey: ['admin-ga4', wsId] })
 *
 * Key structure: [keyPrefix, wsId, metric, days, ...(dateRange ? [dateRange] : [])]
 * This matches queryKeys.admin.ga4() and queryKeys.client.ga4() factories.
 */

import { useQuery } from '@tanstack/react-query';
import { ga4 } from '../../api/analytics';
import type {
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource,
  GA4DeviceBreakdown, GA4CountryBreakdown, GA4Event, GA4ConversionSummary,
  GA4Comparison, GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage,
} from '../../../shared/types/analytics';
import type { AnalyticsDateRange } from '../../../shared/types/analytics-contract.js';

export interface GA4BaseOptions {
  wsId: string;
  days: number;
  dateRange?: AnalyticsDateRange;
  enabled: boolean;
  /** Cache namespace — determines the React Query key prefix. */
  keyPrefix: 'admin-ga4' | 'client-ga4';
  /** Whether to run the events query (client only). */
  includeEvents?: boolean;
  /** Extra options forwarded to ga4.landingPages (e.g. organic, limit). */
  landingOpts?: { organic?: boolean; limit?: number };
  /** Optional cache freshness override for all GA4 sub-queries. */
  staleTime?: number;
  api?: {
    overview: typeof ga4.overview;
    trend: typeof ga4.trend;
    topPages: typeof ga4.topPages;
    sources: typeof ga4.sources;
    devices: typeof ga4.devices;
    countries: typeof ga4.countries;
    comparison: typeof ga4.comparison;
    newVsReturning: typeof ga4.newVsReturning;
    organic: typeof ga4.organic;
    landingPages: typeof ga4.landingPages;
    conversions: typeof ga4.conversions;
    events?: typeof ga4.events;
  };
}

export function useGA4Base({
  wsId,
  days,
  dateRange: dr,
  enabled,
  keyPrefix,
  includeEvents = false,
  landingOpts,
  staleTime,
  api = ga4,
}: GA4BaseOptions) {
  // Build a consistent query key: [prefix, wsId, metric, days] or [..., dateRange]
  const mk = (metric: string): unknown[] =>
    dr ? [keyPrefix, wsId, metric, days, dr] : [keyPrefix, wsId, metric, days];

  const overviewQ = useQuery({
    queryKey: mk('overview'),
    queryFn: () => api.overview(wsId, days, dr),
    enabled,
    staleTime,
  });

  const trendQ = useQuery({
    queryKey: mk('trend'),
    queryFn: () => api.trend(wsId, days, dr),
    enabled,
    staleTime,
  });

  const topPagesQ = useQuery({
    queryKey: mk('pages'),
    queryFn: () => api.topPages(wsId, days, dr),
    enabled,
    staleTime,
  });

  const sourcesQ = useQuery({
    queryKey: mk('sources'),
    queryFn: () => api.sources(wsId, days, dr),
    enabled,
    staleTime,
  });

  const devicesQ = useQuery({
    queryKey: mk('devices'),
    queryFn: () => api.devices(wsId, days, dr),
    enabled,
    staleTime,
  });

  const countriesQ = useQuery({
    queryKey: mk('countries'),
    queryFn: () => api.countries(wsId, days, dr),
    enabled,
    staleTime,
  });

  const comparisonQ = useQuery({
    queryKey: mk('comparison'),
    queryFn: () => api.comparison(wsId, days, dr),
    enabled,
    staleTime,
  });

  const nvrQ = useQuery({
    queryKey: mk('nvr'),
    queryFn: () => api.newVsReturning(wsId, days, dr),
    enabled,
    staleTime,
  });

  const organicQ = useQuery({
    queryKey: mk('organic'),
    queryFn: () => api.organic(wsId, days, dr),
    enabled,
    staleTime,
  });

  const landingQ = useQuery({
    queryKey: mk('landing'),
    queryFn: () =>
      api.landingPages(wsId, days, {
        ...(dr ? { dateRange: dr } : {}),
        ...landingOpts,
      }),
    enabled,
    staleTime,
  });

  const conversionsQ = useQuery({
    queryKey: mk('conversions'),
    queryFn: () => api.conversions(wsId, days, dr),
    enabled,
    staleTime,
  });

  const eventsQ = useQuery({
    queryKey: mk('events'),
    queryFn: () => api.events ? api.events(wsId, days, dr) : Promise.resolve([]),
    enabled: enabled && includeEvents,
    staleTime,
  });

  return {
    overviewQ,
    trendQ,
    topPagesQ,
    sourcesQ,
    devicesQ,
    countriesQ,
    comparisonQ,
    nvrQ,
    organicQ,
    landingQ,
    conversionsQ,
    eventsQ,
  };
}

// Re-export GA4 types for convenience
export type {
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource,
  GA4DeviceBreakdown, GA4CountryBreakdown, GA4Event, GA4ConversionSummary,
  GA4Comparison, GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage,
};
