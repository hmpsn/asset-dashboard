// CLIENT-FACING
// React Query hook for the published-briefing public endpoint.
// Pass `enabled: false` for free-tier workspaces — the server would respond
// 402 (tier-gated). The parent composer (`<InsightsBriefingPage>`) decides
// based on the workspace's effective tier whether to enable this query.

import { useClientPublishedBriefingView } from './useClientInsightViewModel';

export function useClientBriefing(workspaceId: string, enabled: boolean) {
  return useClientPublishedBriefingView(workspaceId, enabled);
}
