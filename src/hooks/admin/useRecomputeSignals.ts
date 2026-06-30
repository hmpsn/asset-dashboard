/**
 * useRecomputeSignals — manual "Recompute now" for the IntelligenceSignals card.
 *
 * POSTs the recompute trigger (which enqueues a background job and returns { jobId }) and registers
 * the job with useBackgroundTasks so NotificationBell surfaces progress. The recompute's feedback loop
 * broadcasts INTELLIGENCE_SIGNALS_UPDATED, which auto-invalidates the signals query — so no manual
 * cache invalidation here.
 */
import { useMutation } from '@tanstack/react-query';
import { post } from '../../api/client';
import { useBackgroundTasks } from '../useBackgroundTasks';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';

export function useRecomputeSignals(workspaceId: string) {
  const { trackJob } = useBackgroundTasks();
  return useMutation({
    mutationFn: () => post<{ jobId: string; existing?: boolean }>(
      `/api/webflow/keyword-strategy/${workspaceId}/signals/recompute`,
      {},
    ),
    onSuccess: (data) => {
      if (data?.jobId) trackJob(BACKGROUND_JOB_TYPES.INTELLIGENCE_RECOMPUTE, data.jobId, { workspaceId });
    },
  });
}
