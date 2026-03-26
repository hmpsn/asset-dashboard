import { useQuery } from '@tanstack/react-query';
import { gsc } from '../../api/analytics';
import { queryKeys } from '../../lib/queryKeys';
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
    queryKey: queryKeys.client.gsc(wsId, 'overview', days, dr),
    queryFn: () => gsc.overview(wsId, days, dr),
    enabled,
  });

  const trend = useQuery({
    queryKey: queryKeys.client.gsc(wsId, 'trend', days, dr),
    queryFn: () => gsc.trend(wsId, days, dr),
    enabled,
  });

  const comparison = useQuery({
    queryKey: queryKeys.client.gsc(wsId, 'comparison', days, dr),
    queryFn: () => gsc.comparison(wsId, days, dr),
    enabled,
  });

  const devices = useQuery({
    queryKey: queryKeys.client.gsc(wsId, 'devices', days, dr),
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
