// ── Briefing Drafts React Query hooks ───────────────────────────────────────
// Admin React Query hooks for the briefing review queue. List query +
// 5 mutations (publish, approve, edit-stories, skip, generate-now). All
// invalidate queryKeys.admin.briefingDrafts(workspaceId) on success and
// surface a toast on error so admin sees 4xx/5xx state-machine violations
// (e.g. publish on already-published) instead of silent re-enabled buttons.
//
// The frontend WS handler for `briefing:generated` and `briefing:published`
// also invalidates this key — see T1.19 (WorkspaceHome.tsx wire-in).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { briefingApi } from '../../api/briefing';
import { queryKeys } from '../../lib/queryKeys';
import { useToast } from '../../components/Toast';
import type { BriefingStory } from '../../../shared/types/briefing';

function toastErr(toast: ReturnType<typeof useToast>['toast'], fallback: string) {
  return (err: unknown) => {
    const msg = err instanceof Error && err.message ? err.message : fallback;
    toast(msg, 'error');
  };
}

export function useBriefingDrafts(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.briefingDrafts(workspaceId),
    queryFn: () => briefingApi.listDrafts(workspaceId),
    enabled: !!workspaceId,
  });
}

export function usePublishBriefing(workspaceId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ draftId, adminNote }: { draftId: string; adminNote?: string }) =>
      briefingApi.publish(workspaceId, draftId, adminNote),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
    onError: toastErr(toast, 'Failed to publish briefing'),
  });
}

/**
 * Reserved for the in-place story editor (Phase 2 / follow-up). Currently
 * unused by BriefingReviewQueue — admin can only approve/publish/skip the
 * AI-generated stories as-is. Hook is wired so the inline-edit UI lands
 * cleanly when designed.
 */
export function useEditBriefingStories(workspaceId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ draftId, stories }: { draftId: string; stories: BriefingStory[] }) =>
      briefingApi.updateStories(workspaceId, draftId, stories),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
    onError: toastErr(toast, 'Failed to update briefing stories'),
  });
}

export function useApproveBriefing(workspaceId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ draftId, adminNote }: { draftId: string; adminNote?: string }) =>
      briefingApi.approve(workspaceId, draftId, adminNote),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
    onError: toastErr(toast, 'Failed to approve briefing'),
  });
}

export function useSkipBriefing(workspaceId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ draftId, adminNote }: { draftId: string; adminNote: string }) =>
      briefingApi.skip(workspaceId, draftId, adminNote),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(workspaceId) }),
    onError: toastErr(toast, 'Failed to skip briefing'),
  });
}

/**
 * Manual generate-now. Returns 202 immediately; the actual draft lands via
 * the BRIEFING_GENERATED WS event invalidating the same query key, so this
 * mutation does NOT invalidate on success — that would be a no-op refetch
 * (the new draft doesn't exist yet at the moment 202 returns).
 */
export function useGenerateBriefingNow(workspaceId: string) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: () => briefingApi.generateNow(workspaceId),
    onSuccess: () => toast('Generation started — the draft will appear when ready', 'info'),
    onError: toastErr(toast, 'Failed to start briefing generation'),
  });
}
