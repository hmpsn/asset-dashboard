/**
 * useAutoSendPolicy — React Query hook for The Issue's trust ladder (Phase 4, Lane C).
 *
 * - useQuery: GET the per-archetype trust state for the 2 eligible buckets
 *   (quick_win, technical) — earned / enabled / consecutiveCycles.
 * - useMutation(setEnabled): PATCH a single archetype's `enabled` reward. The server
 *   rejects enabling a not-yet-earned/ineligible archetype, so the mutation surfaces the
 *   error via `updateError`. On success the response (the full updated policy set) is
 *   written straight into the cache.
 * - useWorkspaceEvents: the second half of the WS contract — the server broadcasts
 *   STRATEGY_AUTOSEND_POLICY_UPDATED on every PATCH and on every crediting send that
 *   advances the streak counter (manual OR the cron's auto-send — the credit chokepoint
 *   broadcasts when it actually changes consecutiveCycles, not on the same-week no-op);
 *   this handler invalidates the query so the ladder reflects external mutations.
 *
 * `enabled` is gated on the caller's flag (theIssueEnabled) AND workspaceId. Flag-OFF →
 * no fetch, no network traffic, no behavior change (byte-identical OFF).
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import { useWorkspaceEvents } from '../useWorkspaceEvents';
import { autoSendPolicyApi } from '../../api/autoSendPolicy';
import {
  AUTOSEND_TRUST_THRESHOLD,
  type AutoSendEligibleArchetype,
  type AutoSendPolicyResponse,
  type AutoSendPolicyRow,
} from '../../../shared/types/strategy-autosend';

export interface UseAutoSendPolicyResult {
  /** The 2 eligible archetypes' trust state (empty until loaded). */
  policies: AutoSendPolicyRow[];
  /** AUTOSEND_TRUST_THRESHOLD (3) — falls back to the constant before the fetch resolves. */
  threshold: number;
  isLoading: boolean;
  isError: boolean;
  /** Flip an archetype's auto-send reward on/off. Server-validated (earned + eligible). */
  setEnabled: (archetype: AutoSendEligibleArchetype, enabled: boolean) => void;
  isUpdating: boolean;
  updateError: unknown;
}

interface SetEnabledArgs {
  archetype: AutoSendEligibleArchetype;
  enabled: boolean;
}

/**
 * @param workspaceId - The workspace whose trust ladder to manage.
 * @param enabled - The composed flag gate (theIssueEnabled). When false, no fetch/mutation runs.
 */
export function useAutoSendPolicy(
  workspaceId: string,
  enabled: boolean = true,
): UseAutoSendPolicyResult {
  const qc = useQueryClient();
  const queryEnabled = !!workspaceId && enabled;
  const key = queryKeys.admin.autoSendPolicy(workspaceId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => autoSendPolicyApi.get(workspaceId),
    enabled: queryEnabled,
    staleTime: 5 * 60 * 1000, // 5 min — cycles tick at most weekly; the WS event covers live updates.
    refetchOnWindowFocus: false,
  });

  const updateMutation = useMutation({
    mutationFn: ({ archetype, enabled: next }: SetEnabledArgs) =>
      autoSendPolicyApi.setEnabled(workspaceId, archetype, next),
    onSuccess: (data) => {
      qc.setQueryData<AutoSendPolicyResponse>(key, data);
    },
  });

  // ── Both-halves WS handler (CLAUDE.md §Data Flow Rule #2) ─────────
  const wsHandlers = useMemo(
    () => ({
      [WS_EVENTS.STRATEGY_AUTOSEND_POLICY_UPDATED]: () =>
        qc.invalidateQueries({ queryKey: queryKeys.admin.autoSendPolicy(workspaceId) }),
    }),
    [qc, workspaceId],
  );
  useWorkspaceEvents(workspaceId || undefined, wsHandlers);

  return {
    policies: query.data?.policies ?? [],
    threshold: query.data?.threshold ?? AUTOSEND_TRUST_THRESHOLD,
    isLoading: queryEnabled ? query.isLoading : false,
    isError: queryEnabled ? query.isError : false,
    setEnabled: (archetype, next) => updateMutation.mutate({ archetype, enabled: next }),
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.error,
  };
}
