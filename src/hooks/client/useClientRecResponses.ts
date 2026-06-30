// ── useClientRecResponses — the loop-footer response summary ────────────────────
//
// Phase 2 (strategy-the-issue). Reads the client-safe pre-aggregated response counts
// (Track C / audit P2-6) that power the quiet loop footer:
//   "you've greenlit N moves · M in discussion"
//
// Resilient by construction: theIssueApi.recResponses uses getSafe, so a brand-new
// client with no responses degrades to all-zero rather than an error card. Invalidated
// alongside the feed by the RECOMMENDATIONS_UPDATED / DELIVERABLE_SENT WS handlers
// (both halves of the broadcast contract — see src/lib/wsInvalidation.ts).

import { useQuery } from '@tanstack/react-query';
import { theIssueApi } from '../../api/theIssue';
import type { ClientRecResponseSummary } from '../../../shared/types/recommendations';
import { queryKeys } from '../../lib/queryKeys';

export function useClientRecResponses(workspaceId?: string) {
  return useQuery<ClientRecResponseSummary>({
    queryKey: queryKeys.client.recResponses(workspaceId ?? ''),
    queryFn: () => theIssueApi.recResponses(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}
