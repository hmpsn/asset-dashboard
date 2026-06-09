import { gsc } from '../../api/analytics';
import { useGSCBase } from '../shared/useGSCBase';
import { queryKeys } from '../../lib/queryKeys';
import type { SearchOverview, PerformanceTrend, SearchComparison } from '../../components/client/types';
import type { SearchDeviceBreakdown } from '../../../shared/types/analytics';
import type { AnalyticsDateRange } from '../../../shared/types/analytics-contract.js';

export interface ClientSearchData {
  overview: SearchOverview | null;
  trend: PerformanceTrend[];
  comparison: SearchComparison | null;
  devices: SearchDeviceBreakdown[];
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
    api: {
      overview: () => gsc.overview(wsId, days, dr),
      trend: () => gsc.trend(wsId, days, dr),
      comparison: () => gsc.comparison(wsId, days, dr),
      devices: () => gsc.devices(wsId, days, dr),
    },
  });

  return {
    overview: (overviewQ.data ?? null) as SearchOverview | null,
    trend: trendQ.data ?? [],
    comparison: (comparisonQ.data ?? null) as SearchComparison | null,
    devices: devicesQ.data ?? [],
    isLoading: overviewQ.isLoading || trendQ.isLoading,
    error: overviewQ.error || trendQ.error || comparisonQ.error || devicesQ.error,
  };
}
