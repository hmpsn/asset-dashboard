import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { keywordCommandCenter } from '../../api/keywordCommandCenter';
import { queryKeys } from '../../lib/queryKeys';
import type {
  KeywordCommandCenterActionRequest,
  KeywordCommandCenterBulkActionRequest,
  KeywordCommandCenterRowsQuery,
} from '../../../shared/types/keyword-command-center';

export function useKeywordCommandCenterSummary(
  workspaceId: string,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  return useQuery({
    queryKey: queryKeys.admin.keywordCommandCenterSummary(workspaceId),
    queryFn: () => keywordCommandCenter.summary(workspaceId),
    enabled: !!workspaceId && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useKeywordCommandCenterRows(workspaceId: string, query: KeywordCommandCenterRowsQuery) {
  return useQuery({
    queryKey: queryKeys.admin.keywordCommandCenterRows(workspaceId, query),
    queryFn: () => keywordCommandCenter.rows(workspaceId, query),
    enabled: !!workspaceId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useKeywordCommandCenterDetail(workspaceId: string, keyword: string | null) {
  return useQuery({
    queryKey: queryKeys.admin.keywordCommandCenterDetail(workspaceId, keyword ?? ''),
    queryFn: () => keywordCommandCenter.detail(workspaceId, keyword ?? ''),
    enabled: !!workspaceId && !!keyword,
    staleTime: 2 * 60 * 1000,
  });
}

export function useKeywordCommandCenterAction(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: KeywordCommandCenterActionRequest) => keywordCommandCenter.action(workspaceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordCommandCenter(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingKeywords(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingLatest(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingHistory(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(workspaceId) });
    },
  });
}

export function useKeywordCommandCenterBulkAction(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: KeywordCommandCenterBulkActionRequest) => keywordCommandCenter.bulkAction(workspaceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordCommandCenter(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingKeywords(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingLatest(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingHistory(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(workspaceId) });
    },
  });
}
