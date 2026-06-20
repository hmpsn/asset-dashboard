// ── useClientTheIssue — the curated evergreen feed read ─────────────────────────
//
// Phase 2 (strategy-the-issue). Reads the public `?clientStatus=sent` projection — the
// curated recommendations the operator actually sent (Stage-0 ClientFacingRecommendation
// projection, Track C / audit P2-5). Uses its OWN query key (client.theIssue), distinct
// from shared.recommendations (raw read), so the curated surface invalidates independently
// and never disturbs the byte-identical shared key the rest of the dashboard relies on.
//
// Resilient (getSafe under the hood): a thin/new client degrades to an empty set so the
// surface falls back to its content floor rather than erroring.

import { useQuery } from '@tanstack/react-query';
import { theIssueApi } from '../../../api/theIssue';
import { queryKeys } from '../../../lib/queryKeys';
import type { RecommendationSet } from '../../../../shared/types/recommendations';

export function useClientTheIssue(workspaceId?: string) {
  return useQuery<RecommendationSet>({
    queryKey: queryKeys.client.theIssue(workspaceId ?? ''),
    queryFn: () => theIssueApi.feed(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}
