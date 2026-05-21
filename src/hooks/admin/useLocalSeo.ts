import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { localSeo } from '../../api/localSeo';
import { queryKeys } from '../../lib/queryKeys';
import type { LocalSeoLocationLookupRequest, LocalSeoMarketUpdateRequest, LocalSeoRefreshRequest } from '../../../shared/types/local-seo';

export function useLocalSeo(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.localSeo(workspaceId),
    queryFn: () => localSeo.get(workspaceId),
    enabled: !!workspaceId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useLocalSeoRefresh(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LocalSeoRefreshRequest = {}) => localSeo.refresh(workspaceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.localSeo(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordCommandCenter(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(workspaceId) });
    },
  });
}

export function useLocalSeoUpdate(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LocalSeoMarketUpdateRequest) => localSeo.update(workspaceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.localSeo(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordCommandCenter(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(workspaceId) });
    },
  });
}

export function useLocalSeoLocationLookup(workspaceId: string) {
  return useMutation({
    mutationFn: (body: LocalSeoLocationLookupRequest) => localSeo.locationLookup(workspaceId, body),
  });
}
