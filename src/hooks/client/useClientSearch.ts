import { useQuery } from '@tanstack/react-query';
import { gsc } from '../../api/analytics';
import type { SearchOverview, PerformanceTrend, SearchComparison } from '../../components/client/types';
import type { SearchDeviceBreakdown } from '../../../shared/types/analytics';

export interface ClientSearchData {
  overview: SearchOverview | null;
  trend: PerformanceTrend[];
  comparison: SearchComparison | null;
  devices: SearchDeviceBreakdown[];
}

export function useClientSearch(
  wsId: string,
  days: number,
  dateRange: { startDate: string; endDate: string } | undefined,
  enabled: boolean,
) {
  const dr = dateRange;

  const overview = useQuery({
    queryKey: ['client-search-overview', wsId, days, dr],
    queryFn: () => gsc.overview(wsId, days, dr),
    enabled,
  });

  const trend = useQuery({
    queryKey: ['client-search-trend', wsId, days, dr],
    queryFn: () => gsc.trend(wsId, days, dr),
    enabled,
  });

  const comparison = useQuery({
    queryKey: ['client-search-comparison', wsId, days, dr],
    queryFn: () => gsc.comparison(wsId, days, dr),
    enabled,
  });

  const devices = useQuery({
    queryKey: ['client-search-devices', wsId, days, dr],
    queryFn: () => gsc.devices(wsId, days, dr),
    enabled,
  });

  return {
    overview: (overview.data ?? null) as SearchOverview | null,
    trend: trend.data ?? [],
    comparison: (comparison.data ?? null) as SearchComparison | null,
    devices: devices.data ?? [],
    isLoading: overview.isLoading || trend.isLoading,
    error: overview.error || trend.error || comparison.error || devices.error,
  };
}
