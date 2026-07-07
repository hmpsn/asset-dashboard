// @ds-rebuilt
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type { CompetitiveIntelResponse } from './types';

export function useCompetitiveIntel(
  workspaceId: string,
  competitors: string[],
  seoDataAvailable: boolean,
) {
  const competitorKey = useMemo(() => competitors.join(','), [competitors]);

  const query = useQuery<CompetitiveIntelResponse>({
    queryKey: queryKeys.admin.competitorIntel(workspaceId, competitorKey),
    queryFn: () => get<CompetitiveIntelResponse>(
      `/api/seo/competitive-intel/${workspaceId}?competitors=${encodeURIComponent(competitorKey)}`,
    ),
    enabled: competitors.length > 0 && seoDataAvailable,
    staleTime: 168 * 60 * 60 * 1000,
    retry: 1,
  });

  return { ...query, competitorKey };
}
