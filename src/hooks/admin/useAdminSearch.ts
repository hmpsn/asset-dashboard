import { gscAdmin } from '../../api/analytics';
import { useGSCBase } from '../shared/useGSCBase';
import { queryKeys } from '../../lib/queryKeys';
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
): AdminSearchData {
  const enabled = !!workspaceId && !!siteId && !!gscSiteUrl;
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
    makeKey: metric => queryKeys.admin.gsc(keySiteId, url, metric === 'searchTypes' ? 'types' : metric, days),
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

  return {
    overview: (overviewQ.data ?? null) as SearchOverview | null,
    trend: trendQ.data ?? [],
    devices: devicesQ.data ?? [],
    countries: countriesQ.data ?? [],
    searchTypes: searchTypesQ.data ?? [],
    comparison: (comparisonQ.data ?? null) as SearchComparison | null,
    isLoading: overviewQ.isLoading,
    error: errorMsg,
  };
}
