import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, businessPriorities as bizPrioritiesApi } from '../../../api';
import { queryKeys } from '../../../lib/queryKeys';
import type {
  BusinessPrioritiesConflictResponse,
  BusinessPriority,
} from '../../../../shared/types/business-priorities';

export type StrategyBusinessPriority = BusinessPriority;

interface UseStrategyBusinessPrioritiesOptions {
  workspaceId?: string;
  setToast?: (msg: string) => void;
}

export function useStrategyBusinessPriorities({ workspaceId, setToast }: UseStrategyBusinessPrioritiesOptions) {
  const queryClient = useQueryClient();
  const [newPriority, setNewPriority] = useState('');
  const [newPriorityCategory, setNewPriorityCategory] = useState('growth');

  const query = useQuery({
    queryKey: queryKeys.client.strategyGuidance(workspaceId ?? ''),
    queryFn: () => bizPrioritiesApi.get(workspaceId!),
    enabled: Boolean(workspaceId),
  });

  const mutation = useMutation({
    mutationFn: (newList: StrategyBusinessPriority[]) => {
      if (!workspaceId) throw new Error('Workspace is required');
      return bizPrioritiesApi.save(workspaceId, {
        priorities: newList,
        expectedUpdatedAt: query.data?.updatedAt ?? null,
      });
    },
    onSuccess: (data) => {
      if (workspaceId) {
        queryClient.setQueryData(queryKeys.client.strategyGuidance(workspaceId), {
          priorities: data.priorities,
          updatedAt: data.updatedAt,
        });
      }
      setToast?.('Business priorities saved - they will shape your next strategy');
    },
    onError: (err) => {
      if (workspaceId && err instanceof ApiError && err.status === 409) {
        const body = err.body as Partial<BusinessPrioritiesConflictResponse> | undefined;
        if (body && Array.isArray(body.priorities)) {
          queryClient.setQueryData(queryKeys.client.strategyGuidance(workspaceId), {
            priorities: body.priorities,
            updatedAt: body.updatedAt ?? null,
          });
        } else {
          queryClient.invalidateQueries({ queryKey: queryKeys.client.strategyGuidance(workspaceId) });
        }
        setToast?.('Business priorities changed elsewhere - latest priorities loaded');
        return;
      }
      setToast?.('Failed to save priorities');
    },
  });

  const savePriorities = useCallback(async (newList: StrategyBusinessPriority[]) => {
    if (!workspaceId || query.isError) return;
    try {
      await mutation.mutateAsync(newList);
    } catch {
      // onError owns user-facing recovery; UI callers intentionally fire-and-forget.
    }
  }, [workspaceId, query.isError, mutation]);

  return {
    priorities: query.data?.priorities ?? [],
    prioritiesLoaded: !query.isLoading,
    prioritiesError: query.isError,
    reloadPriorities: query.refetch,
    newPriority,
    setNewPriority,
    newPriorityCategory,
    setNewPriorityCategory,
    savingPriorities: mutation.isPending,
    savePriorities,
  };
}
