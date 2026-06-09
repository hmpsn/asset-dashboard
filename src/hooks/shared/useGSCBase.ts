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
  api: GSCBaseApi;
}

export function useGSCBase({ enabled, makeKey, api }: GSCBaseOptions) {
  const overviewQ = useQuery({
    queryKey: makeKey('overview'),
    queryFn: api.overview,
    enabled,
  });

  const trendQ = useQuery({
    queryKey: makeKey('trend'),
    queryFn: api.trend,
    enabled,
  });

  const comparisonQ = useQuery({
    queryKey: makeKey('comparison'),
    queryFn: api.comparison,
    enabled,
  });

  const devicesQ = useQuery({
    queryKey: makeKey('devices'),
    queryFn: api.devices,
    enabled,
  });

  const countriesQ = useQuery({
    queryKey: makeKey('countries'),
    queryFn: () => api.countries ? api.countries() : Promise.resolve([]),
    enabled: enabled && !!api.countries,
  });

  const searchTypesQ = useQuery({
    queryKey: makeKey('searchTypes'),
    queryFn: () => api.searchTypes ? api.searchTypes() : Promise.resolve([]),
    enabled: enabled && !!api.searchTypes,
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
