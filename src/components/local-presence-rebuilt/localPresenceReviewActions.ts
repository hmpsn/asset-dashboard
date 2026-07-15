// @ds-rebuilt
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { post } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type {
  GbpReviewResponseSummary,
} from '../../../shared/types/google-business-profile';

export interface GbpReviewManualDraftRequest {
  reviewResourceName: string;
  draftText: string;
}

export interface GbpReviewDraftAndSendRequest extends GbpReviewManualDraftRequest {
  note?: string;
}

interface GbpReviewDraftAndSendResponse {
  response: GbpReviewResponseSummary;
  deliverable: {
    id: string;
    type: string;
  };
}

function invalidateReviewResponseReads(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpReviewResponses(workspaceId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpAuthenticatedReviews(workspaceId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceDeliverables(workspaceId) });
}

export function useManualGbpReviewResponseDraft(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: GbpReviewManualDraftRequest) =>
      post<GbpReviewResponseSummary>(
        `/api/google-business-profile/workspaces/${workspaceId}/review-responses/manual-draft`,
        body,
      ),
    onSettled: () => invalidateReviewResponseReads(queryClient, workspaceId),
  });
}

export function useDraftAndSendGbpReviewResponse(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: GbpReviewDraftAndSendRequest) =>
      post<GbpReviewDraftAndSendResponse>(
        `/api/google-business-profile/workspaces/${workspaceId}/review-responses/draft-and-send`,
        body,
      ),
    onSettled: () => invalidateReviewResponseReads(queryClient, workspaceId),
  });
}
