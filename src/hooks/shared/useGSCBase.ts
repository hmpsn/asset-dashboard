import { useQuery } from '@tanstack/react-query';
import type {
  SearchComparison,
  SearchCountryBreakdown,
  SearchDeviceBreakdown,
  SearchOverview,
  SearchTypeBreakdown,
  PerformanceTrend,
} from '../../../shared/types/analytics';

export const GSC_METRICS = [
  'overview',
  'trend',
  'comparison',
  'devices',
  'countries',
  'searchTypes',
] as const;

export type GSCMetric = typeof GSC_METRICS[number];

export interface GSCBaseApi {
  overview: () => Promise<SearchOverview | null>;
  trend: () => Promise<PerformanceTrend[]>;
  comparison: () => Promise<SearchComparison | null>;
  devices: () => Promise<SearchDeviceBreakdown[]>;
  countries?: () => Promise<SearchCountryBreakdown[]>;
  searchTypes?: () => Promise<SearchTypeBreakdown[]>;
}

export interface GSCBaseOptions {
  enabled: boolean;
  /** Optional query subset. Omit to preserve the historical all-metrics behavior. */
  metrics?: readonly GSCMetric[];
  makeKey: (metric: GSCMetric) => readonly unknown[];
  staleTime?: number;
  api: GSCBaseApi;
}

export function useGSCBase({ enabled, metrics, makeKey, staleTime, api }: GSCBaseOptions) {
  const metricEnabled = (metric: GSCMetric) => enabled && (!metrics || metrics.includes(metric));

  const overviewQ = useQuery({
    queryKey: makeKey('overview'),
    queryFn: api.overview,
    enabled: metricEnabled('overview'),
    staleTime,
  });

  const trendQ = useQuery({
    queryKey: makeKey('trend'),
    queryFn: api.trend,
    enabled: metricEnabled('trend'),
    staleTime,
  });

  const comparisonQ = useQuery({
    queryKey: makeKey('comparison'),
    queryFn: api.comparison,
    enabled: metricEnabled('comparison'),
    staleTime,
  });

  const devicesQ = useQuery({
    queryKey: makeKey('devices'),
    queryFn: api.devices,
    enabled: metricEnabled('devices'),
    staleTime,
  });

  const countriesQ = useQuery({
    queryKey: makeKey('countries'),
    queryFn: () => api.countries ? api.countries() : Promise.resolve([]),
    enabled: metricEnabled('countries') && !!api.countries,
    staleTime,
  });

  const searchTypesQ = useQuery({
    queryKey: makeKey('searchTypes'),
    queryFn: () => api.searchTypes ? api.searchTypes() : Promise.resolve([]),
    enabled: metricEnabled('searchTypes') && !!api.searchTypes,
    staleTime,
  });

  return {
    overviewQ,
    trendQ,
    comparisonQ,
    devicesQ,
    countriesQ,
    searchTypesQ,
  };
}
