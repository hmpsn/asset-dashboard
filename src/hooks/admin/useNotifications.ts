import { useQuery } from '@tanstack/react-query';
import {
  Bell, TrendingDown, Flag, MessageSquare, ClipboardCheck, Clipboard, Layers,
} from 'lucide-react';
import { workspaceOverview, anomalies as anomaliesApi, churnSignals } from '../../api/misc';
import { queryKeys } from '../../lib/queryKeys';

export interface NotificationItem {
  id: string;
  label: string;
  sub: string;
  color: string;
  icon: typeof Bell;
  workspaceId?: string;
  workspaceName?: string;
  tab: string;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  requests: { new: number };
  approvals: { pending: number };
  contentRequests?: { pending: number };
  workOrders?: { pending: number };
  contentPlan?: { review: number };
  clientSignals?: { new: number };
}

interface AnomalySummary {
  workspaceId: string;
  workspaceName: string;
  severity: 'critical' | 'warning' | 'positive';
  dismissedAt?: string;
}

interface ChurnSignal {
  workspaceId: string;
  severity: string;
  title: string;
}

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

async function fetchNotifications(): Promise<NotificationItem[]> {
  const [overviewRes, anomalyRes] = await Promise.all([
    workspaceOverview.list().catch(() => []),
    anomaliesApi.listAll().catch(() => []),
  ]);

  const workspaces: WorkspaceSummary[] = (Array.isArray(overviewRes) ? overviewRes : []) as WorkspaceSummary[];
  const anomalies: AnomalySummary[] = ((Array.isArray(anomalyRes) ? anomalyRes : []) as AnomalySummary[]).filter((a) => !a.dismissedAt);

  const notifications: NotificationItem[] = [];

  // Critical anomalies grouped by workspace
  const criticalByWs: Record<string, { count: number; name: string }> = {};
  const warningByWs: Record<string, { count: number; name: string }> = {};
  anomalies.forEach(a => {
    if (a.severity === 'critical') {
      if (!criticalByWs[a.workspaceId]) criticalByWs[a.workspaceId] = { count: 0, name: a.workspaceName };
      criticalByWs[a.workspaceId].count++;
    } else if (a.severity === 'warning') {
      if (!warningByWs[a.workspaceId]) warningByWs[a.workspaceId] = { count: 0, name: a.workspaceName };
      warningByWs[a.workspaceId].count++;
    }
  });

  for (const [wsId, data] of Object.entries(criticalByWs)) {
    notifications.push({
      id: `anomaly-critical-${wsId}`,
      label: `${data.count} critical anomal${data.count > 1 ? 'ies' : 'y'}`,
      sub: data.name,
      color: 'text-red-400/80',
      icon: TrendingDown,
      workspaceId: wsId,
      workspaceName: data.name,
      tab: 'home',
    });
  }

  for (const [wsId, data] of Object.entries(warningByWs)) {
    notifications.push({
      id: `anomaly-warning-${wsId}`,
      label: `${data.count} warning anomal${data.count > 1 ? 'ies' : 'y'}`,
      sub: data.name,
      color: 'text-amber-400/80',
      icon: TrendingDown,
      workspaceId: wsId,
      workspaceName: data.name,
      tab: 'home',
    });
  }

  // Per-workspace notifications
  for (const ws of workspaces) {
    if (ws.requests.new > 0) {
      notifications.push({
        id: `requests-${ws.id}`,
        label: `${ws.requests.new} new request${ws.requests.new > 1 ? 's' : ''}`,
        sub: ws.name,
        color: 'text-red-400/80',
        icon: MessageSquare,
        workspaceId: ws.id,
        workspaceName: ws.name,
        tab: 'requests',
      });
    }
    if (ws.approvals.pending > 0) {
      notifications.push({
        id: `approvals-${ws.id}`,
        label: `${ws.approvals.pending} pending approval${ws.approvals.pending > 1 ? 's' : ''}`,
        sub: ws.name,
        color: 'text-teal-400',
        icon: ClipboardCheck,
        workspaceId: ws.id,
        workspaceName: ws.name,
        tab: 'seo-editor',
      });
    }
    if ((ws.contentRequests?.pending || 0) > 0) {
      notifications.push({
        id: `content-${ws.id}`,
        label: `${ws.contentRequests!.pending} content brief${ws.contentRequests!.pending > 1 ? 's' : ''} awaiting review`,
        sub: ws.name,
        color: 'text-amber-400/80',
        icon: Clipboard,
        workspaceId: ws.id,
        workspaceName: ws.name,
        tab: 'content-pipeline',
      });
    }
    if ((ws.workOrders?.pending || 0) > 0) {
      notifications.push({
        id: `orders-${ws.id}`,
        label: `${ws.workOrders!.pending} unfulfilled work order${ws.workOrders!.pending > 1 ? 's' : ''}`,
        sub: ws.name,
        color: 'text-teal-400',
        icon: ClipboardCheck,
        workspaceId: ws.id,
        workspaceName: ws.name,
        tab: 'workspace-settings',
      });
    }
    if ((ws.contentPlan?.review || 0) > 0) {
      notifications.push({
        id: `content-plan-${ws.id}`,
        label: `${ws.contentPlan!.review} content plan cell${ws.contentPlan!.review > 1 ? 's' : ''} need${ws.contentPlan!.review === 1 ? 's' : ''} review`,
        sub: ws.name,
        color: 'text-amber-400/80',
        icon: Layers,
        workspaceId: ws.id,
        workspaceName: ws.name,
        tab: 'content-pipeline',
      });
    }
    if ((ws.clientSignals?.new || 0) > 0) {
      notifications.push({
        id: `signals-${ws.id}`,
        label: `${ws.clientSignals!.new} new client signal${ws.clientSignals!.new > 1 ? 's' : ''}`,
        sub: ws.name,
        color: 'text-teal-400',
        icon: MessageSquare,
        workspaceId: ws.id,
        workspaceName: ws.name,
        tab: 'requests',
      });
    }
  }

  // Fetch churn signals across all workspaces
  try {
    const churnPromises = workspaces.map(ws =>
      churnSignals.list(ws.id).then((signals) =>
        (Array.isArray(signals) ? signals as ChurnSignal[] : [])
          .filter(s => s.severity === 'critical' || s.severity === 'warning')
          .map(s => ({ ...s, workspaceId: ws.id, workspaceName: ws.name }))
      ).catch(() => [])
    );
    const churnResults = await Promise.all(churnPromises);
    for (const signals of churnResults) {
      for (const signal of signals) {
        notifications.push({
          id: `churn-${signal.workspaceId}-${signal.title}`,
          label: signal.title,
          sub: signal.workspaceName,
          color: signal.severity === 'critical' ? 'text-red-400/80' : 'text-amber-400/80',
          icon: Flag,
          workspaceId: signal.workspaceId,
          workspaceName: signal.workspaceName,
          tab: 'workspace-settings',
        });
      }
    }
  } catch { /* churn fetch failed, skip */ }

  return notifications;
}

/**
 * Shared hook for admin notification items.
 *
 * Uses React Query so multiple NotificationBell instances share one cached
 * result instead of each independently polling the API every 5 minutes.
 */
export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.admin.notifications(),
    queryFn: fetchNotifications,
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  });
}
