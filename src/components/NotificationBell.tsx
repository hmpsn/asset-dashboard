import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bell, TrendingDown, Flag, MessageSquare, ClipboardCheck, Clipboard,
  AlertTriangle, X,
} from 'lucide-react';

interface NotificationItem {
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

interface NotificationBellProps {
  onSelectWorkspace: (workspaceId: string, tab: string) => void;
}

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function NotificationBell({ onSelectWorkspace }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const [overviewRes, anomalyRes] = await Promise.all([
        fetch('/api/workspace-overview').then(r => r.ok ? r.json() : []),
        fetch('/api/anomalies').then(r => r.ok ? r.json() : []),
      ]);

      const workspaces: WorkspaceSummary[] = Array.isArray(overviewRes) ? overviewRes : [];
      const anomalies: AnomalySummary[] = (Array.isArray(anomalyRes) ? anomalyRes : []).filter((a: AnomalySummary) => !a.dismissedAt);

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
          color: 'text-red-400',
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
          color: 'text-amber-400',
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
            color: 'text-red-400',
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
            color: 'text-amber-400',
            icon: Clipboard,
            workspaceId: ws.id,
            workspaceName: ws.name,
            tab: 'seo-briefs',
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
      }

      // Fetch churn signals across all workspaces
      try {
        const churnPromises = workspaces.map(ws =>
          fetch(`/api/churn-signals/${ws.id}`).then(r => r.ok ? r.json() : []).then((signals: ChurnSignal[]) =>
            (Array.isArray(signals) ? signals : [])
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
              color: signal.severity === 'critical' ? 'text-red-400' : 'text-amber-400',
              icon: Flag,
              workspaceId: signal.workspaceId,
              workspaceName: signal.workspaceName,
              tab: 'workspace-settings',
            });
          }
        }
      } catch { /* churn fetch failed, skip */ }

      setItems(notifications);
    } catch { /* silent */ }
  }, []);

  // Fetch on mount + poll every 5 min
  useEffect(() => {
    let active = true;
    const run = () => { if (active) fetchNotifications(); };
    run();
    const interval = setInterval(run, POLL_INTERVAL);
    return () => { active = false; clearInterval(interval); };
  }, [fetchNotifications]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const hasItems = items.length > 0;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(prev => !prev)}
        title="Notifications"
        className={`p-2 rounded-lg transition-all relative ${
          open ? 'text-teal-400 bg-teal-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
        }`}
      >
        <Bell className="w-4 h-4" />
        {hasItems && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#0f1219]" />
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-72 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <span className="text-xs font-semibold text-zinc-200">Notifications</span>
            <div className="flex items-center gap-2">
              {hasItems && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 tabular-nums">
                  {items.length}
                </span>
              )}
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {items.length > 0 ? (
              <div className="divide-y divide-zinc-800/50">
                {items.map(item => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        if (item.workspaceId) onSelectWorkspace(item.workspaceId, item.tab);
                        setOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-zinc-800/30 transition-colors text-left"
                    >
                      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${item.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium text-zinc-200 truncate">{item.label}</div>
                        <div className="text-[10px] text-zinc-500 truncate">{item.sub}</div>
                      </div>
                      <AlertTriangle className="w-3 h-3 text-zinc-700 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-8 text-center">
                <Bell className="w-5 h-5 text-zinc-600 mx-auto mb-2" />
                <div className="text-xs text-zinc-500">All clear — nothing needs attention</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
