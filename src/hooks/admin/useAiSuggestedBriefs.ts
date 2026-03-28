/**
 * useAiSuggestedBriefs — React Query hook for AI-suggested briefs in the pipeline.
 *
 * Fetches suggested_brief and refresh_suggestion signals from the insight engine's
 * feedback loop. Used by the AiSuggested section in ContentPipeline.
 */

import { useQuery } from '@tanstack/react-query';
import { getSafe } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type { PipelineSignal } from '../../../shared/types/insights.js';

interface SuggestedResponse {
  signals: PipelineSignal[];
}

export function useAiSuggestedBriefs(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.aiSuggestedBriefs(workspaceId),
    queryFn: ({ signal }) =>
      getSafe<SuggestedResponse>(
        `/api/content-briefs/${workspaceId}/suggested`,
        { signals: [] },
        signal,
      ),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId,
  });
}
