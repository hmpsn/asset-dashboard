import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { contentMatrices } from '../../api/content';
import { queryKeys } from '../../lib/queryKeys';
import { useBackgroundTasks } from '../useBackgroundTasks';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';
import type {
  MatrixGenerationBatchBudget,
  PreviewMatrixGenerationSelection,
  RetryMatrixGenerationItem,
  StartMatrixGenerationSelection,
} from '../../../shared/types/matrix-generation';

export function useMatrixGeneration(workspaceId: string, matrixId: string) {
  const queryClient = useQueryClient();
  const { trackJob } = useBackgroundTasks();
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    setRunId(null);
  }, [matrixId]);

  const preview = useMutation({
    mutationFn: (selections: PreviewMatrixGenerationSelection[]) =>
      contentMatrices.previewGeneration(workspaceId, matrixId, selections),
  });

  const start = useMutation({
    mutationFn: (request: {
      selections: StartMatrixGenerationSelection[];
      acceptedBudget: MatrixGenerationBatchBudget;
      idempotencyKey: string;
    }) => contentMatrices.startGeneration(workspaceId, matrixId, request),
    onSuccess: result => {
      setRunId(result.run.id);
      trackJob(BACKGROUND_JOB_TYPES.CONTENT_MATRIX_GENERATION, result.jobId, {
        workspaceId,
        runId: result.run.id,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.contentMatrices(workspaceId) });
    },
  });

  const run = useQuery({
    queryKey: queryKeys.admin.contentMatrixGeneration(workspaceId, runId ?? ''),
    queryFn: () => contentMatrices.getGeneration(workspaceId, runId!),
    enabled: Boolean(workspaceId && runId),
    refetchInterval: query => {
      const status = query.state.data?.run.status;
      return status === 'queued' || status === 'running' ? 2_000 : false;
    },
  });

  const retry = useMutation({
    mutationFn: (request: {
      expectedRunRevision: number;
      items: RetryMatrixGenerationItem[];
      idempotencyKey: string;
    }) => {
      if (!runId) throw new Error('No matrix generation run is selected');
      return contentMatrices.retryGeneration(workspaceId, runId, request);
    },
    onSuccess: result => {
      trackJob(BACKGROUND_JOB_TYPES.CONTENT_MATRIX_GENERATION, result.jobId, {
        workspaceId,
        runId: result.run.id,
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.contentMatrixGeneration(workspaceId, result.run.id),
      });
    },
  });

  return { preview, start, run, retry };
}
