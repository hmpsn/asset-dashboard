// @ds-rebuilt
import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { useAdminGA4 } from '../../hooks/admin/useAdminGA4';
import { useAdminSearch } from '../../hooks/admin/useAdminSearch';
import type { GA4Metric } from '../../hooks/shared/useGA4Base';
import type { GSCMetric } from '../../hooks/shared/useGSCBase';
import { STALE_TIMES } from '../../lib/queryClient';
import { queryKeys } from '../../lib/queryKeys';
import type { PerformanceTrend } from '../../../shared/types/analytics';
import type {
  SearchOverviewWithDemand,
  SearchTrafficGa4Data,
  SearchTrafficLens,
  SearchTrafficSearchData,
} from './types';

const GSC_OVERVIEW_METRICS = ['overview', 'trend', 'comparison'] as const satisfies readonly GSCMetric[];
const GSC_ANNOTATION_METRICS = ['overview', 'trend'] as const satisfies readonly GSCMetric[];
const GA4_OVERVIEW_METRICS = ['overview', 'trend', 'comparison'] as const satisfies readonly GA4Metric[];
const GA4_ANNOTATION_METRICS = ['overview', 'trend'] as const satisfies readonly GA4Metric[];

function searchMetricsForLens(lens: SearchTrafficLens): readonly GSCMetric[] | undefined {
  if (lens === 'overview') return GSC_OVERVIEW_METRICS;
  if (lens === 'annotations') return GSC_ANNOTATION_METRICS;
  return undefined;
}

function ga4MetricsForLens(lens: SearchTrafficLens): readonly GA4Metric[] | undefined {
  if (lens === 'overview') return GA4_OVERVIEW_METRICS;
  if (lens === 'annotations') return GA4_ANNOTATION_METRICS;
  return undefined;
}

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
  lens: SearchTrafficLens = 'search',
): SearchTrafficSearchData {
  const enabled = lens !== 'traffic' && !!workspaceId && !!siteId && !!gscSiteUrl;
  const search = useAdminSearch(workspaceId, siteId ?? '', gscSiteUrl, days, {
    enabled,
    metrics: searchMetricsForLens(lens),
  });
  const priorEnabled = enabled && (lens === 'search' || lens === 'annotations');
  const priorTrend = useQuery({
    queryKey: priorTrendKey(workspaceId, siteId ?? '', gscSiteUrl ?? '', days),
    queryFn: () => get<PerformanceTrend[]>(`/api/google/performance-trend/${siteId}?${gscQs(workspaceId, gscSiteUrl ?? '', days, true)}`),
    enabled: priorEnabled,
    staleTime: STALE_TIMES.ANALYTICS,
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
  lens: SearchTrafficLens = 'traffic',
): SearchTrafficGa4Data {
  return useAdminGA4(
    workspaceId,
    days,
    lens !== 'search' && !!ga4PropertyId,
    ga4MetricsForLens(lens),
  );
}
