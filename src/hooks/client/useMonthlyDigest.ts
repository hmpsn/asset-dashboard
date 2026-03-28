import { useQuery } from '@tanstack/react-query';
import { getSafe } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type { MonthlyDigestData } from '../../../shared/types/narrative.js';

const emptyDigest: MonthlyDigestData = {
  month: '',
  period: { start: '', end: '' },
  summary: '',
  wins: [],
  issuesAddressed: [],
  metrics: { clicksChange: 0, impressionsChange: 0, avgPositionChange: 0, pagesOptimized: 0 },
  roiHighlights: [],
};

export function useMonthlyDigest(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.client.monthlyDigest(workspaceId),
    queryFn: () =>
      getSafe<MonthlyDigestData>(
        `/api/public/insights/${workspaceId}/digest`,
        emptyDigest,
      ),
    staleTime: 60 * 60 * 1000, // 1 hour — digests don't change often
    enabled: !!workspaceId,
  });
}
