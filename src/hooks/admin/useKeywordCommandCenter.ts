import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { keywordCommandCenter } from '../../api/keywordCommandCenter';
import { queryKeys } from '../../lib/queryKeys';
import type { KeywordCommandCenterActionRequest } from '../../../shared/types/keyword-command-center';

export function useKeywordCommandCenter(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.keywordCommandCenter(workspaceId),
    queryFn: () => keywordCommandCenter.get(workspaceId),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
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
