/**
 * useOutcomes — React Query hooks for the Outcome Intelligence Engine (admin).
 *
 * Covers: scorecard, action list, single action with outcomes, top wins,
 * timeline, learnings, cross-workspace overview, and add-note mutation.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { outcomesApi } from '../../api/outcomes';

// ── Scorecard ──────────────────────────────────────────────────────────────

export function useOutcomeScorecard(wsId: string) {
  return useQuery({
    queryKey: queryKeys.admin.outcomeScorecard(wsId),
    queryFn: ({ signal }) => outcomesApi.getScorecard(wsId, signal),
    enabled: !!wsId,
  });
}

// ── Action list (filterable by type / score) ───────────────────────────────

export function useOutcomeActions(wsId: string, type?: string, score?: string) {
  return useQuery({
    queryKey: [...queryKeys.admin.outcomeActions(wsId), type ?? '', score ?? ''],
    queryFn: ({ signal }) => outcomesApi.getActions(wsId, type, score, signal),
    enabled: !!wsId,
  });
}

// ── Single action with outcomes ────────────────────────────────────────────

export function useOutcomeAction(wsId: string, actionId: string) {
  return useQuery({
    queryKey: [...queryKeys.admin.outcomeActions(wsId), actionId],
    queryFn: ({ signal }) => outcomesApi.getAction(wsId, actionId, signal),
    enabled: !!wsId && !!actionId,
  });
}

// ── Top wins ───────────────────────────────────────────────────────────────

export function useOutcomeTopWins(wsId: string) {
  return useQuery({
    queryKey: queryKeys.admin.outcomeTopWins(wsId),
    queryFn: ({ signal }) => outcomesApi.getTopWins(wsId, signal),
    enabled: !!wsId,
  });
}

// ── Timeline ───────────────────────────────────────────────────────────────

export function useOutcomeTimeline(wsId: string) {
  return useQuery({
    queryKey: queryKeys.admin.outcomeTimeline(wsId),
    queryFn: ({ signal }) => outcomesApi.getTimeline(wsId, signal),
    enabled: !!wsId,
  });
}

// ── Learnings ──────────────────────────────────────────────────────────────

export function useOutcomeLearnings(wsId: string) {
  return useQuery({
    queryKey: queryKeys.admin.outcomeLearnings(wsId),
    queryFn: ({ signal }) => outcomesApi.getLearnings(wsId, signal),
    enabled: !!wsId,
  });
}

// ── Cross-workspace overview ───────────────────────────────────────────────

export function useOutcomeOverview() {
  return useQuery({
    queryKey: queryKeys.admin.outcomeOverview(),
    queryFn: ({ signal }) => outcomesApi.getOverview(signal),
  });
}

// ── Playbooks ──────────────────────────────────────────────────────────────

export function useOutcomePlaybooks(wsId: string) {
  return useQuery({
    queryKey: queryKeys.admin.outcomePlaybooks(wsId),
    queryFn: ({ signal }) => outcomesApi.getPlaybooks(wsId, signal),
    enabled: !!wsId,
  });
}

// ── Add note mutation ──────────────────────────────────────────────────────

export function useAddOutcomeNote(wsId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ actionId, note }: { actionId: string; note: string }) =>
      outcomesApi.addNote(wsId, actionId, note),
    onSuccess: (_data, { actionId }) => {
      // Invalidate the individual action so the new note is reflected
      void queryClient.invalidateQueries({
        queryKey: [...queryKeys.admin.outcomeActions(wsId), actionId],
      });
    },
  });
}
