/**
 * useOperatorSteering — The Issue operator-steering verbs (spec §11/§12).
 *
 * - useQuery: GET the two override maps (wording + sortOrder). `enabled` is gated on the caller's
 *   flag (theIssueEnabled) AND workspaceId, so flag-OFF makes ZERO network calls (byte-identical).
 * - three mutations (editWording / reorder / addManualRec). Each invalidates the admin rec set
 *   (queryKeys.admin.recommendations — the cockpit read), the shared client-facing rec cache
 *   (queryKeys.shared.recommendations), AND the override maps (queryKeys.admin.operatorOverrides).
 * - useWorkspaceEvents on RECOMMENDATIONS_UPDATED — the second half of the WS contract (the routes
 *   broadcast it after every steering mutation); the handler invalidates the same three caches so
 *   external mutations (another admin session, the weekly regen) refresh the cockpit + overrides.
 *
 * Overrides apply ONLY at display boundaries server-side — this hook never bakes them into the
 * stored rec blob; it just surfaces the maps the steering UI reads back.
 */
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import { useWorkspaceEvents } from '../useWorkspaceEvents';
import {
  createManualRec,
  editRecWording,
  getOperatorOverrides,
  reorderRecs,
} from '../../api/operatorSteering';
import type {
  CreateManualRecPayload,
  OperatorOverridesResponse,
  RecWordingOverridePayload,
} from '../../../shared/types/rec-operator-steering';
import type { Recommendation } from '../../../shared/types/recommendations';

export interface UseOperatorSteeringResult {
  /** recId → { title?, insight? } override map (display-only). */
  wording: Record<string, { title?: string; insight?: string }>;
  /** recId → client-facing sort position (lower = earlier). */
  sortOrder: Record<string, number>;
  /** Correct a rec's wording (title/insight). Empty/absent fields clear that override. */
  editWording: (recId: string, payload: RecWordingOverridePayload) => void;
  /** Reorder the client-facing running order — the curated recs in desired order. */
  reorder: (recIds: string[]) => void;
  /** Add a rec the system missed (operator-authored). */
  addManualRec: (payload: CreateManualRecPayload) => void;
  /** True while any of the three steering mutations is in flight. */
  isPending: boolean;
  /** True while the override maps are loading (false when the flag gate is off). */
  isLoading: boolean;
}

/**
 * @param workspaceId - The workspace whose recs to steer.
 * @param enabled - The composed flag gate (theIssueEnabled). When false, no fetch/mutation runs.
 */
export function useOperatorSteering(
  workspaceId: string,
  enabled: boolean = true,
): UseOperatorSteeringResult {
  const qc = useQueryClient();
  const queryEnabled = !!workspaceId && enabled;
  const key = queryKeys.admin.operatorOverrides(workspaceId);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.admin.recommendations(workspaceId) });
    qc.invalidateQueries({ queryKey: queryKeys.shared.recommendations(workspaceId) });
    qc.invalidateQueries({ queryKey: queryKeys.admin.operatorOverrides(workspaceId) });
  };

  const query = useQuery({
    queryKey: key,
    queryFn: () => getOperatorOverrides(workspaceId),
    enabled: queryEnabled,
    staleTime: 5 * 60 * 1000, // 5 min — overrides change only on explicit steering mutations.
    refetchOnWindowFocus: false,
  });

  const wordingMutation = useMutation<Recommendation, Error, { recId: string; payload: RecWordingOverridePayload }>({
    mutationFn: ({ recId, payload }) => editRecWording(workspaceId, recId, payload),
    onSuccess: invalidate,
  });
  const reorderMutation = useMutation<OperatorOverridesResponse, Error, string[]>({
    mutationFn: (recIds) => reorderRecs(workspaceId, recIds),
    onSuccess: invalidate,
  });
  const manualMutation = useMutation<Recommendation, Error, CreateManualRecPayload>({
    mutationFn: (payload) => createManualRec(workspaceId, payload),
    onSuccess: invalidate,
  });

  // ── Both-halves WS handler (CLAUDE.md §Data Flow Rule #2) ─────────
  const wsHandlers = useMemo(
    () => ({
      [WS_EVENTS.RECOMMENDATIONS_UPDATED]: () => {
        qc.invalidateQueries({ queryKey: queryKeys.admin.recommendations(workspaceId) });
        qc.invalidateQueries({ queryKey: queryKeys.shared.recommendations(workspaceId) });
        qc.invalidateQueries({ queryKey: queryKeys.admin.operatorOverrides(workspaceId) });
      },
    }),
    [qc, workspaceId],
  );
  useWorkspaceEvents(queryEnabled ? workspaceId || undefined : undefined, wsHandlers);

  return {
    wording: query.data?.wording ?? {},
    sortOrder: query.data?.sortOrder ?? {},
    editWording: (recId, payload) => wordingMutation.mutate({ recId, payload }),
    reorder: (recIds) => reorderMutation.mutate(recIds),
    addManualRec: (payload) => manualMutation.mutate(payload),
    isPending: wordingMutation.isPending || reorderMutation.isPending || manualMutation.isPending,
    isLoading: queryEnabled ? query.isLoading : false,
  };
}
