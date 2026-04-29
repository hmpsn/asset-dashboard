// ── Briefing Drafts React Query hooks ───────────────────────────────────────
// Admin React Query hooks for the briefing review queue. List query +
// 4 mutations (publish, edit-stories, approve, skip, generate-now). All invalidate
// queryKeys.admin.briefingDrafts(workspaceId) on success.
//
// The frontend WS handler for `briefing:generated` and `briefing:published`
// also invalidates this key — see T1.19 (WorkspaceHome.tsx wire-in).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { briefingApi } from '../../api/briefing';
import { queryKeys } from '../../lib/queryKeys';
import type { BriefingStory } from '../../../shared/types/briefing';

export function useBriefingDrafts(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.briefingDrafts(workspaceId),
    queryFn: () => briefingApi.listDrafts(workspaceId),
    enabled: !!workspaceId,
  });
}

export function usePublishBriefing(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, adminNote }: { draftId: string; adminNote?: string }) =>
      briefingApi.publish(workspaceId, draftId, adminNote),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
  });
}

export function useEditBriefingStories(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, stories }: { draftId: string; stories: BriefingStory[] }) =>
      briefingApi.updateStories(workspaceId, draftId, stories),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
  });
}

export function useApproveBriefing(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, adminNote }: { draftId: string; adminNote?: string }) =>
      briefingApi.approve(workspaceId, draftId, adminNote),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
  });
}

export function useSkipBriefing(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, adminNote }: { draftId: string; adminNote: string }) =>
      briefingApi.skip(workspaceId, draftId, adminNote),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
  });
}

export function useGenerateBriefingNow(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => briefingApi.generateNow(workspaceId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
  });
}
