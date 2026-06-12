// CLIENT-FACING
// React Query hook for the Premium competitor-gaps public endpoint.
// The server returns 402 for non-Premium tiers, so the caller passes
// `enabled` based on the workspace's effective tier (premium only) to avoid a
// guaranteed-failing request. The competitor-gap data refreshes on the same
// weekly cadence as keyword-strategy regeneration, so a long staleTime keeps
// the surface quiet between refreshes.

import { useQuery } from '@tanstack/react-query';
import { competitorGapsApi } from '../../api/competitorGaps';
import { queryKeys } from '../../lib/queryKeys';

export function useClientCompetitorGaps(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.competitorGaps(workspaceId),
    queryFn: () => competitorGapsApi.getGaps(workspaceId),
    enabled: enabled && !!workspaceId,
    staleTime: 60 * 60 * 1000,
  });
}
