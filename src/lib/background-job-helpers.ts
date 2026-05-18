import type { QueryClient } from '@tanstack/react-query';
import type { BackgroundJobType } from '../../shared/types/background-jobs';

export interface BackgroundJobLifecycleBridge {
  startJob: (type: BackgroundJobType, params: Record<string, unknown>) => Promise<string | null>;
  trackJob: (type: BackgroundJobType, jobId: string, params: Record<string, unknown>) => void;
  cancelJob: (jobId: string) => Promise<void> | void;
}

export async function startAndTrackJob(
  bridge: BackgroundJobLifecycleBridge,
  type: BackgroundJobType,
  params: Record<string, unknown>,
): Promise<string | null> {
  const jobId = await bridge.startJob(type, params);
  if (!jobId) return null;
  bridge.trackJob(type, jobId, params);
  return jobId;
}

export function attachTrackedJob(
  bridge: Pick<BackgroundJobLifecycleBridge, 'trackJob'>,
  type: BackgroundJobType,
  jobId: string,
  params: Record<string, unknown>,
): void {
  bridge.trackJob(type, jobId, params);
}

export async function cancelTrackedJob(
  bridge: Pick<BackgroundJobLifecycleBridge, 'cancelJob'>,
  jobId: string | null | undefined,
): Promise<void> {
  if (!jobId) return;
  await bridge.cancelJob(jobId);
}

export function invalidateQueriesOnJobCompletion(
  queryClient: QueryClient,
  queryKeys: readonly (readonly unknown[])[],
): void {
  for (const queryKey of queryKeys) {
    queryClient.invalidateQueries({ queryKey });
  }
}
