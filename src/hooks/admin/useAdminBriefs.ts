import { useQuery } from '@tanstack/react-query';
import { contentBriefs, contentRequests } from '../../api/content';
import { queryKeys } from '../../lib/queryKeys';

export function useAdminBriefsList(wsId: string) {
  return useQuery({
    queryKey: queryKeys.admin.briefs(wsId),
    queryFn: () => contentBriefs.list(wsId),
  });
}

export function useAdminRequestsList(wsId: string) {
  return useQuery({
    queryKey: queryKeys.admin.requests(wsId),
    queryFn: () => contentRequests.list(wsId),
  });
}

export function useAdminBriefTemplateCrossref(wsId: string, keyword: string) {
  const normalizedKeyword = keyword.trim();
  return useQuery({
    queryKey: queryKeys.admin.briefTemplateCrossref(wsId, normalizedKeyword.toLowerCase()),
    queryFn: () => contentBriefs.templateCrossref(wsId, normalizedKeyword),
    enabled: normalizedKeyword.length > 1,
    staleTime: 30_000,
  });
}
