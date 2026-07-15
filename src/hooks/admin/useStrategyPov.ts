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
import type { StrategyPov, StrategyPovResponse } from '../../../shared/types/strategy-pov';

let optimisticEditSequence = 0;
const optimisticResponseOwners = new WeakMap<StrategyPovResponse, number>();
const optimisticResponseConfirmedBases = new WeakMap<StrategyPovResponse, StrategyPovResponse>();

function povAuthorityTimestamp(pov: StrategyPov): number {
  const parsed = Date.parse(pov.editedAt ?? pov.generatedAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Preserve the newest server/optimistic POV authority when async responses
 * resolve out of order. A null or lower-version payload is stale once a POV is
 * present. Equal versions use the server-authored edit/generation timestamp;
 * identical server authority may refresh envelope metadata once no pending
 * optimistic edit owns the cache.
 */
export function mergeStrategyPovResponse(
  current: StrategyPovResponse | undefined,
  incoming: StrategyPovResponse,
): StrategyPovResponse {
  if (!current) return incoming;
  if (current.pov && !incoming.pov) return current;
  if (!current.pov) return incoming;
  if (!incoming.pov || incoming.pov.version < current.pov.version) return current;
  if (incoming.pov.version === current.pov.version) {
    const currentTimestamp = povAuthorityTimestamp(current.pov);
    const incomingTimestamp = povAuthorityTimestamp(incoming.pov);
    if (incomingTimestamp < currentTimestamp) return current;
    if (incomingTimestamp === currentTimestamp && optimisticResponseOwners.has(current)) {
      return current;
    }
  }
  return incoming;
}

export interface UseStrategyPovResult {
  pov: StrategyPov | null;
  isLoading: boolean;
  isError: boolean;
  /** GET/read failure only. Generate and regenerate errors remain separate. */
  readError: unknown;
  /** Retry the canonical POV read without invoking generation. */
  retry: () => void;
  /** Operator edit (debounced by the editor). Optimistic. */
  edit: (edit: StrategyPovEdit) => void;
  editPending: boolean;
  generate: () => void;
  regenerate: () => void;
  isGenerating: boolean;
  generateError: unknown;
  /** True when the last generate returned unchanged:true (data hadn't changed). */
  wasUnchanged: boolean;
  /** Server-owned comparison of saved POV inputs with current evidence/voice. */
  refreshAvailable: boolean;
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
    queryFn: async () => {
      const incoming = await strategyPovApi.get(workspaceId);
      return mergeStrategyPovResponse(
        qc.getQueryData<StrategyPovResponse>(key),
        incoming,
      );
    },
    enabled: queryEnabled,
    staleTime: 10 * 60 * 1000, // 10 min — POV changes only on explicit generate/edit.
    refetchOnWindowFocus: false,
  });

  const editMutation = useMutation({
    scope: { id: `strategy-pov-edit:${workspaceId}` },
    mutationFn: (edit: StrategyPovEdit) => strategyPovApi.edit(workspaceId, edit),
    onMutate: async (edit) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<StrategyPovResponse>(key);
      const confirmedBase = previous
        ? optimisticResponseConfirmedBases.get(previous) ?? previous
        : undefined;
      if (previous?.pov) {
        const optimisticEditId = ++optimisticEditSequence;
        const optimistic: StrategyPovResponse = {
          ...previous,
          pov: {
            ...previous.pov,
            ...edit,
          },
        };
        qc.setQueryData<StrategyPovResponse>(key, optimistic);
        const cachedOptimistic = qc.getQueryData<StrategyPovResponse>(key);
        if (cachedOptimistic) {
          optimisticResponseOwners.set(cachedOptimistic, optimisticEditId);
          if (confirmedBase) {
            optimisticResponseConfirmedBases.set(cachedOptimistic, confirmedBase);
          }
        }
        return { confirmedBase, optimisticEditId };
      }
      return { confirmedBase, optimisticEditId: undefined };
    },
    onError: (_err, _edit, ctx) => {
      if (!ctx?.confirmedBase) return;
      const { confirmedBase, optimisticEditId } = ctx;
      qc.setQueryData<StrategyPovResponse>(key, (current) => {
        // Roll back only when this mutation still owns the cache. A later
        // optimistic edit or server response is always stronger authority.
        // Chained optimism carries the original confirmed response so two
        // failures cannot resurrect an earlier optimistic edit.
        if (current && optimisticResponseOwners.get(current) === optimisticEditId) {
          return confirmedBase;
        }
        return current;
      });
    },
    onSuccess: (data) => {
      qc.setQueryData<StrategyPovResponse>(key, (current) =>
        mergeStrategyPovResponse(current, data));
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => strategyPovApi.generate(workspaceId),
    onSuccess: (data) => qc.setQueryData<StrategyPovResponse>(key, (current) =>
      mergeStrategyPovResponse(current, data)),
  });

  const regenerateMutation = useMutation({
    mutationFn: () => strategyPovApi.regenerate(workspaceId),
    onSuccess: (data) => qc.setQueryData<StrategyPovResponse>(key, (current) =>
      mergeStrategyPovResponse(current, data)),
  });

  // ── Both-halves WS handler (CLAUDE.md §Data Flow Rule #2) ─────────
  const wsHandlers = useMemo(
    () => ({
      [WS_EVENTS.STRATEGY_POV_GENERATED]: () =>
        qc.invalidateQueries({ queryKey: queryKeys.admin.strategyPov(workspaceId) }),
      [WS_EVENTS.INTELLIGENCE_CACHE_UPDATED]: () =>
        qc.invalidateQueries({ queryKey: queryKeys.admin.strategyPov(workspaceId) }),
    }),
    [qc, workspaceId],
  );
  useWorkspaceEvents(workspaceId || undefined, wsHandlers);

  return {
    pov: query.data?.pov ?? null,
    isLoading: queryEnabled ? query.isPending : false,
    isError: queryEnabled ? query.isError : false,
    readError: queryEnabled ? query.error : null,
    retry: () => { void query.refetch(); },
    edit: (edit: StrategyPovEdit) => editMutation.mutate(edit),
    editPending: editMutation.isPending,
    generate: () => {
      regenerateMutation.reset();
      generateMutation.mutate();
    },
    regenerate: () => {
      generateMutation.reset();
      regenerateMutation.mutate();
    },
    isGenerating: generateMutation.isPending || regenerateMutation.isPending,
    generateError: regenerateMutation.error ?? generateMutation.error,
    wasUnchanged: generateMutation.data?.unchanged ?? false,
    refreshAvailable: query.data?.refreshAvailable ?? false,
  };
}
