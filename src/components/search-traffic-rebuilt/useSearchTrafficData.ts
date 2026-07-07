// @ds-rebuilt
import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { useAdminGA4 } from '../../hooks/admin/useAdminGA4';
import { useAdminSearch } from '../../hooks/admin/useAdminSearch';
import { queryKeys } from '../../lib/queryKeys';
import type { PerformanceTrend } from '../../../shared/types/analytics';
import type { SearchTrafficGa4Data, SearchTrafficSearchData, SearchOverviewWithDemand } from './types';

function gscQs(workspaceId: string, gscSiteUrl: string, days: number, previous = false): string {
  const params = new URLSearchParams({
    workspaceId,
    gscSiteUrl,
    days: String(days),
  });
  if (previous) params.set('previous', 'true');
  return params.toString();
}

function priorTrendKey(workspaceId: string, siteId: string, gscSiteUrl: string, days: number) {
  return [...queryKeys.admin.gsc(`${workspaceId}:${siteId}`, gscSiteUrl, 'prior-trend', days)] as const;
}

export function useSearchTrafficSearchData(
  workspaceId: string,
  siteId: string | undefined,
  gscSiteUrl: string | undefined,
  days: number,
): SearchTrafficSearchData {
  const search = useAdminSearch(workspaceId, siteId ?? '', gscSiteUrl, days);
  const enabled = !!workspaceId && !!siteId && !!gscSiteUrl;
  const priorTrend = useQuery({
    queryKey: priorTrendKey(workspaceId, siteId ?? '', gscSiteUrl ?? '', days),
    queryFn: () => get<PerformanceTrend[]>(`/api/google/performance-trend/${siteId}?${gscQs(workspaceId, gscSiteUrl ?? '', days, true)}`),
    enabled,
  });

  return {
    overview: search.overview as SearchOverviewWithDemand | null,
    trend: search.trend,
    priorTrend: priorTrend.data ?? [],
    devices: search.devices,
    countries: search.countries,
    searchTypes: search.searchTypes,
    comparison: search.comparison,
    isLoading: search.isLoading,
    priorIsLoading: priorTrend.isLoading,
    error: search.error,
    refetchPriorTrend: () => { void priorTrend.refetch(); },
  };
}

export function useSearchTrafficGa4Data(
  workspaceId: string,
  days: number,
  ga4PropertyId: string | undefined,
): SearchTrafficGa4Data {
  return useAdminGA4(workspaceId, days, !!ga4PropertyId);
}

