import { gscAdmin } from '../../api/analytics';
import { useGSCBase, type GSCMetric } from '../shared/useGSCBase';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';
import type {
  SearchOverview, PerformanceTrend, SearchComparison,
  SearchDeviceBreakdown, SearchCountryBreakdown, SearchTypeBreakdown,
} from '../../../shared/types/analytics';

export interface AdminSearchData {
  overview: SearchOverview | null;
  trend: PerformanceTrend[];
  devices: SearchDeviceBreakdown[];
  countries: SearchCountryBreakdown[];
  searchTypes: SearchTypeBreakdown[];
  comparison: SearchComparison | null;
  isLoading: boolean;
  error: string | null;
}

export function useAdminSearch(
  workspaceId: string,
  siteId: string,
  gscSiteUrl: string | undefined,
  days: number,
  options: { enabled?: boolean; metrics?: readonly GSCMetric[] } = {},
): AdminSearchData {
  const enabled = options.enabled !== false && !!workspaceId && !!siteId && !!gscSiteUrl;
  const url = gscSiteUrl ?? '';
  const keySiteId = `${workspaceId}:${siteId}`;
  const {
    overviewQ,
    trendQ,
    comparisonQ,
    devicesQ,
    countriesQ,
    searchTypesQ,
  } = useGSCBase({
    enabled,
    metrics: options.metrics,
    makeKey: metric => queryKeys.admin.gsc(keySiteId, url, metric === 'searchTypes' ? 'types' : metric, days),
    staleTime: STALE_TIMES.ANALYTICS,
    api: {
      overview: () => gscAdmin.overview(workspaceId, siteId, url, days),
      trend: () => gscAdmin.trend(workspaceId, siteId, url, days),
      comparison: () => gscAdmin.comparison(workspaceId, siteId, url, days),
      devices: () => gscAdmin.devices(workspaceId, siteId, url, days),
      countries: () => gscAdmin.countries(workspaceId, siteId, url, days),
      searchTypes: () => gscAdmin.searchTypes(workspaceId, siteId, url, days),
    },
  });

  const firstError = overviewQ.error || trendQ.error;
  const errorMsg = firstError
    ? (firstError instanceof Error ? firstError.message : 'Failed to load data')
    : null;

  const metricSelected = (metric: GSCMetric) => !options.metrics || options.metrics.includes(metric);

  return {
    overview: (overviewQ.data ?? null) as SearchOverview | null,
    trend: trendQ.data ?? [],
    devices: devicesQ.data ?? [],
    countries: countriesQ.data ?? [],
    searchTypes: searchTypesQ.data ?? [],
    comparison: (comparisonQ.data ?? null) as SearchComparison | null,
    isLoading: options.metrics
      ? (metricSelected('overview') && overviewQ.isLoading)
        || (metricSelected('trend') && trendQ.isLoading)
        || (metricSelected('comparison') && comparisonQ.isLoading)
        || (metricSelected('devices') && devicesQ.isLoading)
        || (metricSelected('countries') && countriesQ.isLoading)
        || (metricSelected('searchTypes') && searchTypesQ.isLoading)
      : overviewQ.isLoading,
    error: errorMsg,
  };
}
