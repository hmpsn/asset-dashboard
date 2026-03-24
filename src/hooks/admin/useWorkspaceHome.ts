import { useQuery } from '@tanstack/react-query';
import { workspaceHome, type WorkspaceHomeData } from '../../api/misc';

/**
 * Single aggregated query for the workspace home dashboard.
 * Replaces 12 useState + useEffect + handleRefresh in WorkspaceHome.tsx.
 */
export function useWorkspaceHomeData(workspaceId: string) {
  return useQuery<WorkspaceHomeData>({
    queryKey: ['admin-workspace-home', workspaceId],
    queryFn: () => workspaceHome.get(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}
