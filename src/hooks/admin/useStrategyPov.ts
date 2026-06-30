/**
 * useStrategyPov — React Query hook for The Issue's drafted point of view (Lane B / 1C).
 *
 * - useQuery: GET the resolved POV (operator override ∪ AI draft).
 * - useMutation(edit): PATCH operator edits — OPTIMISTIC (the editor debounces; the UI must not
 *   flicker on each keystroke-batch). Rolls back on error.
 * - useMutation(generate / regenerate): POST — sets the cache directly from the response.
 * - useWorkspaceEvents: the second half of the WS contract — the server broadcasts
 *   STRATEGY_POV_GENERATED on generate/regenerate/operator-edit; this handler invalidates the
 *   query so the cockpit reflects external mutations.
 *
 * `enabled` is gated on the caller's flag (theIssueEnabled) AND workspaceId. Flag-OFF → no fetch,
 * no network traffic, no behavior change (byte-identical OFF).
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import { useWorkspaceEvents } from '../useWorkspaceEvents';
import { strategyPovApi, type StrategyPovEdit } from '../../api/strategyPov';
import type { StrategyPov } from '../../../shared/types/strategy-pov';

interface PovResponse {
  pov: StrategyPov | null;
  unchanged?: boolean;
}

export interface UseStrategyPovResult {
  pov: StrategyPov | null;
  isLoading: boolean;
  isError: boolean;
  /** Operator edit (debounced by the editor). Optimistic. */
  edit: (edit: StrategyPovEdit) => void;
  editPending: boolean;
  generate: () => void;
  regenerate: () => void;
  isGenerating: boolean;
  generateError: unknown;
  /** True when the last generate returned unchanged:true (data hadn't changed). */
  wasUnchanged: boolean;
}

/**
 * @param workspaceId - The workspace whose POV to manage.
 * @param enabled - The composed flag gate (theIssueEnabled). When false, no fetch/mutation runs.
 */
export function useStrategyPov(workspaceId: string, enabled: boolean = true): UseStrategyPovResult {
  const qc = useQueryClient();
  const queryEnabled = !!workspaceId && enabled;
  const key = queryKeys.admin.strategyPov(workspaceId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => strategyPovApi.get(workspaceId),
    enabled: queryEnabled,
    staleTime: 10 * 60 * 1000, // 10 min — POV changes only on explicit generate/edit.
    refetchOnWindowFocus: false,
  });

  const editMutation = useMutation({
    mutationFn: (edit: StrategyPovEdit) => strategyPovApi.edit(workspaceId, edit),
    onMutate: async (edit) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PovResponse>(key);
      if (previous?.pov) {
        qc.setQueryData<PovResponse>(key, {
          ...previous,
          pov: { ...previous.pov, ...edit },
        });
      }
      return { previous };
    },
    onError: (_err, _edit, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (data) => {
      qc.setQueryData(key, data);
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => strategyPovApi.generate(workspaceId),
    onSuccess: (data) => qc.setQueryData(key, data),
  });

  const regenerateMutation = useMutation({
    mutationFn: () => strategyPovApi.regenerate(workspaceId),
    onSuccess: (data) => qc.setQueryData(key, data),
  });

  // ── Both-halves WS handler (CLAUDE.md §Data Flow Rule #2) ─────────
  const wsHandlers = useMemo(
    () => ({
      [WS_EVENTS.STRATEGY_POV_GENERATED]: () =>
        qc.invalidateQueries({ queryKey: queryKeys.admin.strategyPov(workspaceId) }),
    }),
    [qc, workspaceId],
  );
  useWorkspaceEvents(workspaceId || undefined, wsHandlers);

  return {
    pov: query.data?.pov ?? null,
    isLoading: queryEnabled ? query.isLoading : false,
    isError: queryEnabled ? query.isError : false,
    edit: (edit: StrategyPovEdit) => editMutation.mutate(edit),
    editPending: editMutation.isPending,
    generate: () => generateMutation.mutate(),
    regenerate: () => regenerateMutation.mutate(),
    isGenerating: generateMutation.isPending || regenerateMutation.isPending,
    generateError: generateMutation.error,
    wasUnchanged: generateMutation.data?.unchanged ?? false,
  };
}
