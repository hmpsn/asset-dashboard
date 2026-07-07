import { useQuery } from '@tanstack/react-query';
import { get, getSafe, getOptional } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import type { WorkspaceOverviewItem } from '../../../shared/types/workspace-overview';

interface ActivityEntry {
  id: string;
  workspaceId: string;
  type: string;
  title: string;
  description?: string;
  createdAt: string;
}

interface AnomalySummary {
  id: string;
  workspaceId: string;
  workspaceName: string;
  severity: 'critical' | 'warning' | 'positive';
  title: string;
  acknowledgedAt?: string;
  dismissedAt?: string;
}

type PresenceMap = Record<string, Array<{ userId: string; email: string; name?: string; role: string; connectedAt: string; lastSeen: string }>>;

export interface WorkspaceOverviewData {
  workspaces: WorkspaceOverviewItem[];
  recentActivity: ActivityEntry[];
  anomalies: AnomalySummary[];
  presence: PresenceMap;
  timeSaved: { totalHoursSaved: number; operationCount: number } | null;
}

export type { WorkspaceOverviewItem as WorkspaceSummary, ActivityEntry, AnomalySummary, PresenceMap };

/**
 * Single aggregated query for the workspace overview (command center).
 * Replaces 6 useState + Promise.all useEffect in WorkspaceOverview.tsx.
 */
export function useWorkspaceOverviewData() {
  return useQuery<WorkspaceOverviewData>({
    queryKey: queryKeys.admin.workspaceOverview(),
    queryFn: async () => {
      const [workspaces, recentActivity, anomalies, presence, timeSaved] = await Promise.all([
        get<WorkspaceOverviewItem[]>('/api/workspace-overview'),
        getSafe<ActivityEntry[]>('/api/activity?limit=15', []),
        getSafe<AnomalySummary[]>('/api/anomalies', []),
        getOptional<PresenceMap>('/api/presence').then(v => v ?? {}).catch(() => ({} as PresenceMap)),
        getOptional<{ totalHoursSaved: number; operationCount: number }>(`/api/ai/time-saved?since=${new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()}`).catch(() => null),
      ]);
      return {
        workspaces: Array.isArray(workspaces) ? workspaces : [],
        recentActivity: Array.isArray(recentActivity) ? recentActivity : [],
        anomalies: Array.isArray(anomalies) ? anomalies.filter((a: AnomalySummary) => !a.dismissedAt) : [],
        presence: (presence && typeof presence === 'object' ? presence : {}) as PresenceMap,
        timeSaved: (timeSaved && typeof timeSaved === 'object' ? timeSaved : null) as { totalHoursSaved: number; operationCount: number } | null,
      };
    },
    staleTime: 60_000,
  });
}
