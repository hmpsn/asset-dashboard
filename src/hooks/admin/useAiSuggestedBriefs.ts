/**
 * useAiSuggestedBriefs — React Query hooks for AI-suggested briefs in the pipeline.
 *
 * Data source: /api/suggested-briefs/:workspaceId (the persisted store, not the
 * ephemeral insight-feedback signal path). The store is the single source of truth
 * for dismiss/snooze lifecycle. Mutations broadcast SUGGESTED_BRIEF_UPDATED →
 * wsInvalidation already re-fetches aiSuggestedBriefs on that event.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { suggestedBriefsApi } from '../../api/suggested-briefs.js';
import { queryKeys } from '../../lib/queryKeys';
import type { SuggestedBrief } from '../../api/suggested-briefs.js';

export type { SuggestedBrief };

export function useAiSuggestedBriefs(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.admin.aiSuggestedBriefs(workspaceId),
    queryFn: ({ signal }) => suggestedBriefsApi.list(workspaceId, false, signal),
    staleTime: 5 * 60 * 1000,
    enabled: !!workspaceId && enabled,
  });
}

export function useDismissSuggestedBrief(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (briefId: string) => suggestedBriefsApi.dismiss(workspaceId, briefId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.admin.aiSuggestedBriefs(workspaceId) });
    },
  });
}

export function useSnoozeSuggestedBrief(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ briefId, until }: { briefId: string; until: string }) =>
      suggestedBriefsApi.snooze(workspaceId, briefId, until),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.admin.aiSuggestedBriefs(workspaceId) });
    },
  });
}

export function useAcceptSuggestedBrief(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (briefId: string) => suggestedBriefsApi.update(workspaceId, briefId, 'accepted'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.admin.aiSuggestedBriefs(workspaceId) });
    },
  });
}
