import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { rankTracking } from '../../api/seo';
import { queryKeys } from '../../lib/queryKeys';
import { useBackgroundTasks } from '../useBackgroundTasks';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';

/**
 * Read the admin AI-visibility (LLM-mention) KPI for a workspace (P8 / ai-visibility).
 * GET /api/rank-tracking/:workspaceId/ai-visibility — aggregates only. Returns the empty
 * shape when the `ai-visibility` flag is off (getSafe fallback), so consumers can gate on
 * data presence (`latest === null`) without a separate flag read. Refreshes live via the
 * LLM_MENTIONS_SNAPSHOTS_REFRESHED broadcast (see wsInvalidation).
 */
export function useAiVisibility(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.aiVisibility(workspaceId),
    queryFn: () => rankTracking.aiVisibility(workspaceId),
    enabled: !!workspaceId,
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Start the LLM-mention (AI visibility) refresh job (P8 / ai-visibility).
 * POST /api/rank-tracking/:workspaceId/refresh-ai-visibility — gated server-side by the
 * `ai-visibility` flag + Growth+ tier. Tracks the returned job through useBackgroundTasks/
 * NotificationBell; the ai-visibility cache also refreshes live via the
 * LLM_MENTIONS_SNAPSHOTS_REFRESHED broadcast, so the onSuccess invalidate is just the
 * optimistic local nudge.
 */
export function useAiVisibilityRefresh(workspaceId: string) {
  const queryClient = useQueryClient();
  const { trackJob } = useBackgroundTasks();
  return useMutation({
    mutationFn: () => rankTracking.refreshAiVisibility(workspaceId),
    onSuccess: (result) => {
      if (result?.jobId) {
        trackJob(BACKGROUND_JOB_TYPES.LLM_MENTIONS_REFRESH, result.jobId, { workspaceId });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.aiVisibility(workspaceId) });
    },
  });
}
