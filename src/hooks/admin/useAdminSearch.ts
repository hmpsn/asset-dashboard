import { useQuery } from '@tanstack/react-query';
import { gscAdmin } from '../../api/analytics';
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
  siteId: string,
  gscSiteUrl: string | undefined,
  days: number,
): AdminSearchData {
  const enabled = !!gscSiteUrl;
  const url = gscSiteUrl ?? '';

  const overviewQ = useQuery({
    queryKey: queryKeys.admin.gsc(siteId, url, 'overview', days),
    queryFn: () => gscAdmin.overview(siteId, url, days),
    enabled,
  });

  const trendQ = useQuery({
    queryKey: queryKeys.admin.gsc(siteId, url, 'trend', days),
    queryFn: () => gscAdmin.trend(siteId, url, days),
    enabled,
  });

  const devicesQ = useQuery({
    queryKey: queryKeys.admin.gsc(siteId, url, 'devices', days),
    queryFn: () => gscAdmin.devices(siteId, url, days),
    enabled,
  });

  const countriesQ = useQuery({
    queryKey: queryKeys.admin.gsc(siteId, url, 'countries', days),
    queryFn: () => gscAdmin.countries(siteId, url, days),
    enabled,
  });

  const typesQ = useQuery({
    queryKey: queryKeys.admin.gsc(siteId, url, 'types', days),
    queryFn: () => gscAdmin.searchTypes(siteId, url, days),
    enabled,
  });

  const comparisonQ = useQuery({
    queryKey: queryKeys.admin.gsc(siteId, url, 'comparison', days),
    queryFn: () => gscAdmin.comparison(siteId, url, days),
    enabled,
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
    searchTypes: typesQ.data ?? [],
    comparison: (comparisonQ.data ?? null) as SearchComparison | null,
    isLoading: overviewQ.isLoading,
    error: errorMsg,
  };
}
