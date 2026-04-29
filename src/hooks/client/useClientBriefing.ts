// CLIENT-FACING
// React Query hook for the published-briefing public endpoint.
// Pass `enabled: false` for free-tier workspaces — the server would respond
// 402 (tier-gated). The parent composer (`<InsightsBriefingPage>`) decides
// based on the workspace's effective tier whether to enable this query.

import { useQuery } from '@tanstack/react-query';
import { briefingApi } from '../../api/briefing';
import { queryKeys } from '../../lib/queryKeys';

export function useClientBriefing(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.briefing(workspaceId),
    queryFn: () => briefingApi.getPublished(workspaceId),
    enabled: enabled && !!workspaceId,
    // Briefings update Monday at 14:00 UTC. 1-hour staleness keeps the UI
    // fresh on weekly publish cycles without thrashing the public endpoint
    // on every tab focus. The 'briefing:published' WS event invalidates this
    // key on real-time publishes, so staleness is the floor, not the ceiling.
    staleTime: 60 * 60 * 1000,
  });
}
