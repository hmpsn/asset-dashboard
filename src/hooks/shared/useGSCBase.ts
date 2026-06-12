import { useQuery } from '@tanstack/react-query';
import type {
  SearchComparison,
  SearchCountryBreakdown,
  SearchDeviceBreakdown,
  SearchOverview,
  SearchTypeBreakdown,
  PerformanceTrend,
} from '../../../shared/types/analytics';

type GSCMetric = 'overview' | 'trend' | 'comparison' | 'devices' | 'countries' | 'searchTypes';

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
  makeKey: (metric: GSCMetric) => readonly unknown[];
  staleTime?: number;
  api: GSCBaseApi;
}

export function useGSCBase({ enabled, makeKey, staleTime, api }: GSCBaseOptions) {
  const overviewQ = useQuery({
    queryKey: makeKey('overview'),
    queryFn: api.overview,
    enabled,
    staleTime,
  });

  const trendQ = useQuery({
    queryKey: makeKey('trend'),
    queryFn: api.trend,
    enabled,
    staleTime,
  });

  const comparisonQ = useQuery({
    queryKey: makeKey('comparison'),
    queryFn: api.comparison,
    enabled,
    staleTime,
  });

  const devicesQ = useQuery({
    queryKey: makeKey('devices'),
    queryFn: api.devices,
    enabled,
    staleTime,
  });

  const countriesQ = useQuery({
    queryKey: makeKey('countries'),
    queryFn: () => api.countries ? api.countries() : Promise.resolve([]),
    enabled: enabled && !!api.countries,
    staleTime,
  });

  const searchTypesQ = useQuery({
    queryKey: makeKey('searchTypes'),
    queryFn: () => api.searchTypes ? api.searchTypes() : Promise.resolve([]),
    enabled: enabled && !!api.searchTypes,
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
