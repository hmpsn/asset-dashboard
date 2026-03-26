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
