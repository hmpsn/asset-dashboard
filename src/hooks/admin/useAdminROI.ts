import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type { ROIData } from '../../../shared/types/roi';

export function useAdminROI(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.roi(workspaceId),
    queryFn: () => get<ROIData>(`/api/public/roi/${workspaceId}`),
    staleTime: 10 * 60 * 1000, // 10 minutes
    retry: 2,
    enabled: !!workspaceId,
  });
}
