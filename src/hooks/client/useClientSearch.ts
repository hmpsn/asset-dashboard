import { gsc } from '../../api/analytics';
import { useGSCBase } from '../shared/useGSCBase';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';
import type { SearchOverview, PerformanceTrend, SearchComparison } from '../../components/client/types';
import type { SearchDeviceBreakdown } from '../../../shared/types/analytics';
import type { AnalyticsDateRange } from '../../../shared/types/analytics-contract.js';

export interface ClientSearchData {
  overview: SearchOverview | null;
  trend: PerformanceTrend[];
  comparison: SearchComparison | null;
  devices: SearchDeviceBreakdown[];
  dataUpdatedAt: number | null;
}

type FreshnessQuery = {
  status: 'pending' | 'error' | 'success';
  dataUpdatedAt: number;
};

function primaryDataUpdatedAt(query: FreshnessQuery, data: unknown): number | null {
  if (!data || query.status !== 'success' || query.dataUpdatedAt <= 0) return null;
  return query.dataUpdatedAt;
}

export function useClientSearch(
  wsId: string,
  days: number,
  dateRange: AnalyticsDateRange | undefined,
  enabled: boolean,
) {
  const dr = dateRange;
  const {
    overviewQ,
    trendQ,
    comparisonQ,
    devicesQ,
  } = useGSCBase({
    enabled,
    makeKey: metric => queryKeys.client.gsc(wsId, metric, days, dr),
    staleTime: STALE_TIMES.ANALYTICS,
    api: {
      overview: () => gsc.overview(wsId, days, dr),
      trend: () => gsc.trend(wsId, days, dr),
      comparison: () => gsc.comparison(wsId, days, dr),
      devices: () => gsc.devices(wsId, days, dr),
    },
  });

  const overview = (overviewQ.data ?? null) as SearchOverview | null;

  return {
    overview,
    trend: trendQ.data ?? [],
    comparison: (comparisonQ.data ?? null) as SearchComparison | null,
    devices: devicesQ.data ?? [],
    dataUpdatedAt: primaryDataUpdatedAt(overviewQ, overview),
    isLoading: overviewQ.isLoading || trendQ.isLoading,
    error: overviewQ.error || trendQ.error || comparisonQ.error || devicesQ.error,
  };
}
