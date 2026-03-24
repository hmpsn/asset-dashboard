import { useQuery } from '@tanstack/react-query';
import { contentBriefs, contentRequests } from '../../api/content';

export function useAdminBriefsList(wsId: string) {
  return useQuery({
    queryKey: ['admin-briefs', wsId],
    queryFn: () => contentBriefs.list(wsId),
  });
}

export function useAdminRequestsList(wsId: string) {
  return useQuery({
    queryKey: ['admin-requests', wsId],
    queryFn: () => contentRequests.list(wsId),
  });
}
