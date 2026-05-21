import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { localSeo } from '../../api/localSeo';
import { queryKeys } from '../../lib/queryKeys';
import type { LocalSeoRefreshRequest } from '../../../shared/types/local-seo';

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
    },
  });
}
