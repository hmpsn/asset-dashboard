import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { googleBusinessProfile } from '../../api/googleBusinessProfile';
import { queryKeys } from '../../lib/queryKeys';
import type { WorkspaceGbpMappingsUpdateRequest } from '../../../shared/types/google-business-profile';
import type {
  GbpReviewResponseDraftRequest,
  GbpReviewResponseSendToClientRequest,
  GbpReviewResponseUpdateRequest,
} from '../../../shared/types/google-business-profile';

export function useGbpConnectionStatus() {
  return useQuery({
    queryKey: queryKeys.admin.gbpConnection(),
    queryFn: () => googleBusinessProfile.status(),
    staleTime: 60 * 1000,
  });
}

export function useGbpAuthUrl() {
  return useMutation({
    mutationFn: (input: { workspaceId?: string; returnTo?: string } = {}) =>
      googleBusinessProfile.authUrl(input.workspaceId, input.returnTo),
  });
}

export function useGbpSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId?: string) => googleBusinessProfile.sync(workspaceId),
    onSuccess: (_data, workspaceId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpConnection() });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpAccounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpLocations() });
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpWorkspaceMappings(workspaceId) });
      }
    },
  });
}

export function useGbpDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId?: string) => googleBusinessProfile.disconnect(workspaceId),
    onSuccess: (_data, workspaceId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpConnection() });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpAccounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpLocations() });
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpWorkspaceMappings(workspaceId) });
      }
    },
  });
}

export function useGbpAccounts() {
  return useQuery({
    queryKey: queryKeys.admin.gbpAccounts(),
    queryFn: () => googleBusinessProfile.accounts(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useGbpLocations() {
  return useQuery({
    queryKey: queryKeys.admin.gbpLocations(),
    queryFn: () => googleBusinessProfile.locations(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useWorkspaceGbpMappings(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.gbpWorkspaceMappings(workspaceId),
    queryFn: () => googleBusinessProfile.workspaceMappings(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  });
}

export function useUpdateWorkspaceGbpMappings(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkspaceGbpMappingsUpdateRequest) =>
      googleBusinessProfile.updateWorkspaceMappings(workspaceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpWorkspaceMappings(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpConnection() });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.localSeoLocations(workspaceId) });
    },
  });
}

export function useGbpAuthenticatedReviews(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.gbpAuthenticatedReviews(workspaceId),
    queryFn: () => googleBusinessProfile.authenticatedReviews(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  });
}

export function useSyncGbpAuthenticatedReviews(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => googleBusinessProfile.syncAuthenticatedReviews(workspaceId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpAuthenticatedReviews(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.localGbpReviews(workspaceId) });
    },
  });
}

export function useGbpReviewResponses(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.gbpReviewResponses(workspaceId),
    queryFn: () => googleBusinessProfile.reviewResponses(workspaceId),
    enabled: !!workspaceId,
    staleTime: 30 * 1000,
  });
}

function invalidateGbpReviewResponses(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string) {
  queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpReviewResponses(workspaceId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.admin.gbpAuthenticatedReviews(workspaceId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceDeliverables(workspaceId) });
}

export function useDraftGbpReviewResponse(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: GbpReviewResponseDraftRequest) =>
      googleBusinessProfile.draftReviewResponse(workspaceId, body),
    onSettled: () => invalidateGbpReviewResponses(queryClient, workspaceId),
  });
}

export function useUpdateGbpReviewResponse(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ responseId, body }: { responseId: string; body: GbpReviewResponseUpdateRequest }) =>
      googleBusinessProfile.updateReviewResponse(workspaceId, responseId, body),
    onSettled: () => invalidateGbpReviewResponses(queryClient, workspaceId),
  });
}

export function useSendGbpReviewResponseToClient(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ responseId, body }: { responseId: string; body?: GbpReviewResponseSendToClientRequest }) =>
      googleBusinessProfile.sendReviewResponseToClient(workspaceId, responseId, body ?? {}),
    onSettled: () => invalidateGbpReviewResponses(queryClient, workspaceId),
  });
}

export function useApproveAndPublishGbpReviewResponse(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (responseId: string) =>
      googleBusinessProfile.approveAndPublishReviewResponse(workspaceId, responseId),
    onSettled: () => invalidateGbpReviewResponses(queryClient, workspaceId),
  });
}

export function useRetryGbpReviewResponsePublish(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (responseId: string) =>
      googleBusinessProfile.retryReviewResponsePublish(workspaceId, responseId),
    onSettled: () => invalidateGbpReviewResponses(queryClient, workspaceId),
  });
}
