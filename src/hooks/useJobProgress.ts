/**
 * useJobProgress — shared hook for editor-adjacent AI generation jobs.
 *
 * C2 defines this contract; C3 (publish service extraction) and all subsequent
 * generation UI surfaces MUST consume it. Never re-implement the
 * start → track → invalidate pattern inline.
 *
 * Usage:
 *   const { startJob, isRunning, jobId, error } = useJobProgress(
 *     BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION,
 *     [queryKeys.admin.copySections(wsId, entryId)],
 *     wsId,
 *   );
 *   // Call startJob({ entryId, blueprintId }) to launch. isRunning is true
 *   // until the job reaches a terminal state. On 'done', the queryKeys are
 *   // invalidated automatically.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useBackgroundTasks, isTerminalJobStatus } from './useBackgroundTasks';
import type { BackgroundJobType } from '../../shared/types/background-jobs';

export interface UseJobProgressResult {
  /**
   * Start the job. Returns the jobId on success, null on failure.
   * Merges workspaceId into params automatically.
   */
  startJob: (params?: Record<string, unknown>) => Promise<string | null>;
  /** True while the job is pending or running. */
  isRunning: boolean;
  /** The jobId of the most recently started job, or null. */
  jobId: string | null;
  /** Error message if the last job ended in error status. */
  error: string | null;
}

/**
 * @param jobType     - The BACKGROUND_JOB_TYPES key for this generation.
 * @param queryKeys   - React Query keys to invalidate when the job reaches 'done'.
 * @param workspaceId - Workspace scope; injected into every startJob call.
 */
export function useJobProgress(
  jobType: BackgroundJobType,
  queryKeys: QueryKey[],
  workspaceId: string,
): UseJobProgressResult {
  const tasks = useBackgroundTasks();
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track whether we've already invalidated for this jobId to avoid
  // re-invalidating on re-renders after the job is done.
  const invalidatedRef = useRef<string | null>(null);

  // Watch the tracked job for terminal status
  const trackedJob = jobId ? tasks.jobs.find(j => j.id === jobId) : undefined;

  useEffect(() => {
    if (!trackedJob) return;
    if (!isTerminalJobStatus(trackedJob.status)) return;
    if (invalidatedRef.current === trackedJob.id) return;
    invalidatedRef.current = trackedJob.id;

    if (trackedJob.status === 'done') {
      setError(null);
      for (const key of queryKeys) {
        queryClient.invalidateQueries({ queryKey: key as unknown[] });
      }
    } else if (trackedJob.status === 'error') {
      setError(trackedJob.error ?? 'Generation failed');
    }
  // queryKeys is an array of arrays; we intentionally capture it at hook
  // creation time so the effect does not re-run when the parent re-renders.
  // The consumer must wrap queryKeys in useMemo if they need to change.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKeys identity stable at call site
  }, [trackedJob, queryClient]);

  const startJob = useCallback(async (params: Record<string, unknown> = {}): Promise<string | null> => {
    setError(null);
    invalidatedRef.current = null;
    const id = await tasks.startJob(jobType, { workspaceId, ...params });
    if (id) {
      setJobId(id);
    } else {
      setError('Failed to start job');
    }
    return id;
  }, [tasks, jobType, workspaceId]);

  const isRunning = trackedJob
    ? !isTerminalJobStatus(trackedJob.status)
    : false;

  return { startJob, isRunning, jobId, error };
}
