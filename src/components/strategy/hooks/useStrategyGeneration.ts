import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBackgroundTasks } from '../../../hooks/useBackgroundTasks';
import { useLocalSeoRefresh } from '../../../hooks/admin';
import { BACKGROUND_JOB_TYPES } from '../../../../shared/types/background-jobs';
import { queryKeys } from '../../../lib/queryKeys';

interface LocalSync {
  localNeedsRefresh?: boolean;
  applies?: boolean;
  [key: string]: unknown;
}

interface GenerationParams {
  [key: string]: unknown;
}

interface UseStrategyGenerationParams {
  workspaceId: string;
  localSync: LocalSync | null | undefined;
  buildStrategyGenerationParams: () => GenerationParams;
}

export function useStrategyGeneration({ workspaceId, localSync, buildStrategyGenerationParams }: UseStrategyGenerationParams) {
  const queryClient = useQueryClient();
  const { jobs, startJob, findActiveJob } = useBackgroundTasks();
  const [startingStrategyJob, setStartingStrategyJob] = useState(false);
  const [lastStartedJobId, setLastStartedJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNextSteps, setShowNextSteps] = useState(false);
  const [refreshOrderingPromptOpen, setRefreshOrderingPromptOpen] = useState(false);
  const [dismissedRefreshAt, setDismissedRefreshAt] = useState<string | null>(null);
  const activeStrategyJob = findActiveJob({ type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, workspaceId });
  const completedStartedJob = lastStartedJobId ? jobs.find(job => job.id === lastStartedJobId) : undefined;
  const generating = startingStrategyJob || Boolean(activeStrategyJob);
  const refresh = useLocalSeoRefresh(workspaceId);

  // effect-layout-ok: active background jobs can predate this component mount.
  useEffect(() => {
    if (activeStrategyJob && !lastStartedJobId) {
      setLastStartedJobId(activeStrategyJob.id);
    }
  }, [activeStrategyJob, lastStartedJobId]);

  // effect-layout-ok: background job completion arrives asynchronously via WebSocket/job state.
  useEffect(() => {
    if (!completedStartedJob) return;
    if (completedStartedJob.status === 'done') {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
      setShowNextSteps(true);
      setLastStartedJobId(null);
    } else if (completedStartedJob.status === 'error') {
      setError(completedStartedJob.error || completedStartedJob.message || 'Failed to generate strategy');
      setLastStartedJobId(null);
    } else if (completedStartedJob.status === 'cancelled') {
      setError('Strategy generation was cancelled');
      setLastStartedJobId(null);
    }
  }, [completedStartedJob, queryClient, workspaceId]);

  const runStartJob = async (strategyMode: 'full' | 'incremental' = 'full') => {
    if (generating) return;
    setStartingStrategyJob(true);
    setShowNextSteps(false);
    setError(null);
    try {
      const jobId = await startJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, {
        mode: strategyMode,
        workspaceId,
        ...buildStrategyGenerationParams(),
      });
      if (jobId) {
        setLastStartedJobId(jobId);
      } else {
        setError('Failed to start keyword strategy generation');
      }
    } catch (err) {
      console.error('KeywordStrategy operation failed:', err);
      setError('Failed to generate strategy');
    } finally {
      setStartingStrategyJob(false);
    }
  };

  const generateStrategy = async (strategyMode: 'full' | 'incremental' = 'full') => {
    // When local data needs a refresh, open the ordering prompt instead of immediately running.
    // Incremental runs bypass the prompt (user already chose a mode explicitly).
    if (strategyMode === 'full' && localSync?.localNeedsRefresh) {
      setRefreshOrderingPromptOpen(true);
      return;
    }
    await runStartJob(strategyMode);
  };

  return {
    startingStrategyJob,
    lastStartedJobId,
    error,
    setError,
    showNextSteps,
    setShowNextSteps,
    refreshOrderingPromptOpen,
    setRefreshOrderingPromptOpen,
    dismissedRefreshAt,
    setDismissedRefreshAt,
    activeStrategyJob,
    generating,
    runStartJob,
    generateStrategy,
    refresh,
  };
}
