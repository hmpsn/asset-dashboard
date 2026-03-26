import { useQuery } from '@tanstack/react-query';
import { get, getSafe, getOptional } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';

interface WorkspaceSummary {
  id: string;
  name: string;
  webflowSiteId: string | null;
  webflowSiteName: string | null;
  hasGsc: boolean;
  hasGa4: boolean;
  hasPassword: boolean;
  audit: {
    score: number;
    totalPages: number;
    errors: number;
    warnings: number;
    previousScore?: number;
    lastAuditDate?: string;
  } | null;
  requests: { total: number; new: number; active: number; latestDate: string | null };
  approvals: { pending: number; total: number };
  contentRequests?: { pending: number; inProgress: number; delivered: number; total: number };
  workOrders?: { pending: number; total: number };
  churnSignals?: { critical: number; warning: number };
  pageStates?: { issueDetected: number; inReview: number; approved: number; rejected: number; live: number; total: number };
  tier?: 'free' | 'growth' | 'premium';
  isTrial?: boolean;
  trialDaysRemaining?: number;
}

interface ActivityEntry {
  id: string;
  workspaceId: string;
  type: string;
  title: string;
  description?: string;
  createdAt: string;
}

interface FeedbackItem {
  id: string;
  workspaceId: string;
  type: 'bug' | 'feature' | 'general';
  title: string;
  description: string;
  status: 'new' | 'acknowledged' | 'fixed' | 'wontfix';
  context?: { currentTab?: string };
  submittedBy?: string;
  replies: Array<{ id: string; author: 'team' | 'client'; content: string; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
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
  workspaces: WorkspaceSummary[];
  recentActivity: ActivityEntry[];
  anomalies: AnomalySummary[];
  feedback: FeedbackItem[];
  presence: PresenceMap;
  timeSaved: { totalHoursSaved: number; operationCount: number } | null;
}

export type { WorkspaceSummary, ActivityEntry, FeedbackItem, AnomalySummary, PresenceMap };

/**
 * Single aggregated query for the workspace overview (command center).
 * Replaces 6 useState + Promise.all useEffect in WorkspaceOverview.tsx.
 */
export function useWorkspaceOverviewData() {
  return useQuery<WorkspaceOverviewData>({
    queryKey: queryKeys.admin.workspaceOverview(),
    queryFn: async () => {
      const [workspaces, recentActivity, anomalies, presence, feedback, timeSaved] = await Promise.all([
        get<WorkspaceSummary[]>('/api/workspace-overview'),
        getSafe<ActivityEntry[]>('/api/activity?limit=15', []),
        getSafe<AnomalySummary[]>('/api/anomalies', []),
        getOptional<PresenceMap>('/api/presence').then(v => v ?? {}).catch(() => ({} as PresenceMap)),
        getSafe<FeedbackItem[]>('/api/feedback', []),
        getOptional<{ totalHoursSaved: number; operationCount: number }>(`/api/ai/time-saved?since=${new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()}`).catch(() => null),
      ]);
      return {
        workspaces: Array.isArray(workspaces) ? workspaces : [],
        recentActivity: Array.isArray(recentActivity) ? recentActivity : [],
        anomalies: Array.isArray(anomalies) ? anomalies.filter((a: AnomalySummary) => !a.dismissedAt) : [],
        feedback: Array.isArray(feedback) ? feedback : [],
        presence: (presence && typeof presence === 'object' ? presence : {}) as PresenceMap,
        timeSaved: (timeSaved && typeof timeSaved === 'object' ? timeSaved : null) as { totalHoursSaved: number; operationCount: number } | null,
      };
    },
    staleTime: 60_000,
  });
}
