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

export interface GA4BaseOptions {
  wsId: string;
  days: number;
  dateRange?: { startDate: string; endDate: string };
  enabled: boolean;
  /** Cache namespace — determines the React Query key prefix. */
  keyPrefix: 'admin-ga4' | 'client-ga4';
  /** Whether to run the events query (client only). */
  includeEvents?: boolean;
  /** Extra options forwarded to ga4.landingPages (e.g. organic, limit). */
  landingOpts?: { organic?: boolean; limit?: number };
}

export function useGA4Base({
  wsId,
  days,
  dateRange: dr,
  enabled,
  keyPrefix,
  includeEvents = false,
  landingOpts,
}: GA4BaseOptions) {
  // Build a consistent query key: [prefix, wsId, metric, days] or [..., dateRange]
  const mk = (metric: string): unknown[] =>
    dr ? [keyPrefix, wsId, metric, days, dr] : [keyPrefix, wsId, metric, days];

  const overviewQ = useQuery({
    queryKey: mk('overview'),
    queryFn: () => ga4.overview(wsId, days, dr),
    enabled,
  });

  const trendQ = useQuery({
    queryKey: mk('trend'),
    queryFn: () => ga4.trend(wsId, days, dr),
    enabled,
  });

  const topPagesQ = useQuery({
    queryKey: mk('pages'),
    queryFn: () => ga4.topPages(wsId, days, dr),
    enabled,
  });

  const sourcesQ = useQuery({
    queryKey: mk('sources'),
    queryFn: () => ga4.sources(wsId, days, dr),
    enabled,
  });

  const devicesQ = useQuery({
    queryKey: mk('devices'),
    queryFn: () => ga4.devices(wsId, days, dr),
    enabled,
  });

  const countriesQ = useQuery({
    queryKey: mk('countries'),
    queryFn: () => ga4.countries(wsId, days, dr),
    enabled,
  });

  const comparisonQ = useQuery({
    queryKey: mk('comparison'),
    queryFn: () => ga4.comparison(wsId, days, dr),
    enabled,
  });

  const nvrQ = useQuery({
    queryKey: mk('nvr'),
    queryFn: () => ga4.newVsReturning(wsId, days, dr),
    enabled,
  });

  const organicQ = useQuery({
    queryKey: mk('organic'),
    queryFn: () => ga4.organic(wsId, days, dr),
    enabled,
  });

  const landingQ = useQuery({
    queryKey: mk('landing'),
    queryFn: () =>
      ga4.landingPages(wsId, days, {
        ...(dr ? { dateRange: dr } : {}),
        ...landingOpts,
      }),
    enabled,
  });

  const conversionsQ = useQuery({
    queryKey: mk('conversions'),
    queryFn: () => ga4.conversions(wsId, days, dr),
    enabled,
  });

  const eventsQ = useQuery({
    queryKey: mk('events'),
    queryFn: () => ga4.events(wsId, days, dr),
    enabled: enabled && includeEvents,
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
