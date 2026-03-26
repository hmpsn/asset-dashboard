import { useQuery } from '@tanstack/react-query';
import { contentPosts } from '../../api/content';
import { workspaces as workspacesApi } from '../../api/workspaces';
import type { GeneratedPost } from '../../../shared/types/content';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';

export function useAdminPostsList(wsId: string) {
  return useQuery({
    queryKey: queryKeys.admin.posts(wsId),
    queryFn: () => contentPosts.list(wsId),
    refetchInterval: (query) => {
      const data = query.state.data;
      return Array.isArray(data) && data.some((p: GeneratedPost) => p.status === 'generating')
        ? 5000
        : false;
    },
  });
}

export function useAdminPost(wsId: string, postId: string) {
  return useQuery({
    queryKey: queryKeys.admin.post(wsId, postId),
    queryFn: () => contentPosts.getById(wsId, postId),
    enabled: !!postId,
    refetchInterval: (query) => {
      const data = query.state.data as GeneratedPost | undefined;
      return data?.status === 'generating' ? 3000 : false;
    },
  });
}

export function useAdminPostVersions(wsId: string, postId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.postVersions(wsId, postId),
    queryFn: () => contentPosts.versions(wsId, postId),
    enabled,
  });
}

export function usePublishTarget(wsId: string) {
  return useQuery({
    queryKey: queryKeys.admin.publishTarget(wsId),
    queryFn: async () => {
      const ws = await workspacesApi.getById(wsId) as Record<string, unknown>;
      return !!(ws && 'publishTarget' in ws && ws.publishTarget);
    },
    staleTime: STALE_TIMES.STABLE,
  });
}
