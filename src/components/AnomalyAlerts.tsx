import { useState, useCallback } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Activity, X, Check, RefreshCw, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import { useAnomalyAlerts } from '../hooks/admin';
import { get, post } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';

interface Anomaly {
  id: string;
  workspaceId: string;
  workspaceName: string;
  type: string;
  severity: 'critical' | 'warning' | 'positive';
  title: string;
  description: string;
  metric: string;
  currentValue: number;
  previousValue: number;
  changePct: number;
  aiSummary?: string;
  detectedAt: string;
  dismissedAt?: string;
  acknowledgedAt?: string;
  source: 'gsc' | 'ga4' | 'audit';
}

interface AnomalyAlertsProps {
  workspaceId: string;
  isAdmin?: boolean;
  compact?: boolean;
}

const SEVERITY_STYLES = {
  critical: {
    border: 'border-red-500/30',
    bg: 'bg-red-500/5',
    badge: 'bg-red-500/20 text-red-400/80',
    icon: 'text-red-400/80',
  },
  warning: {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/5',
    badge: 'bg-amber-500/20 text-amber-400/80',
    icon: 'text-amber-400/80',
  },
  positive: {
    border: 'border-green-500/30',
    bg: 'bg-green-500/5',
    badge: 'bg-green-500/20 text-emerald-400/80',
    icon: 'text-emerald-400/80',
  },
};

const SOURCE_LABELS: Record<string, string> = {
  gsc: 'Search Console',
  ga4: 'Analytics',
  audit: 'Site Health',
};

function SeverityIcon({ severity }: { severity: 'critical' | 'warning' | 'positive' }) {
  const cls = `w-4 h-4 ${SEVERITY_STYLES[severity].icon}`;
  if (severity === 'positive') return <TrendingUp className={cls} />;
  if (severity === 'critical') return <TrendingDown className={cls} />;
  return <AlertTriangle className={cls} />;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function AnomalyAlerts({ workspaceId, isAdmin = false, compact = false }: AnomalyAlertsProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const queryClient = useQueryClient();

  // React Query hook replaces manual useEffect fetching
  const { data: anomalies = [], isLoading, error } = useAnomalyAlerts(workspaceId, isAdmin);

  useWorkspaceEvents(workspaceId, {
    'anomalies:update': () => {
      queryClient.invalidateQueries({ queryKey: ['anomaly-alerts', workspaceId] });
    },
  });

  const handleDismiss = async (id: string) => {
    try {
      await post(`/api/anomalies/${id}/dismiss`);
      queryClient.invalidateQueries({ queryKey: ['anomaly-alerts', workspaceId] });
    } catch (err) { console.error('AnomalyAlerts operation failed:', err); }
  };

  const handleAcknowledge = async (id: string) => {
    try {
      await post(`/api/anomalies/${id}/acknowledge`);
      queryClient.invalidateQueries({ queryKey: ['anomaly-alerts', workspaceId] });
    } catch (err) { console.error('AnomalyAlerts operation failed:', err); }
  };

  const handleRefresh = async () => {
    queryClient.invalidateQueries({ queryKey: ['anomaly-alerts', workspaceId] });
  };

  const handleScan = async () => {
    try {
      await post('/api/anomalies/scan');
      await handleRefresh();
    } catch (err) { console.error('AnomalyAlerts operation failed:', err); }
  };

  if (isLoading && anomalies.length === 0) return null;
  if (anomalies.length === 0) return null;

  const critical = anomalies.filter(a => a.severity === 'critical');
  const warnings = anomalies.filter(a => a.severity === 'warning');
  const positive = anomalies.filter(a => a.severity === 'positive');

  // Get shared AI summary (first anomaly with one)
  const aiSummary = anomalies.find(a => a.aiSummary)?.aiSummary;

  if (compact) {
    // Compact mode: single-line summary for sidebar/overview
    const totalAlerts = critical.length + warnings.length;
    if (totalAlerts === 0 && positive.length === 0) return null;

    return (
      <div className={`rounded-lg border px-3 py-2 ${
        critical.length > 0 ? 'border-red-500/30 bg-red-500/5' :
        warnings.length > 0 ? 'border-amber-500/30 bg-amber-500/5' :
        'border-green-500/30 bg-green-500/5'
      }`}>
        <div className="flex items-center gap-2">
          <Activity className={`w-3.5 h-3.5 ${
            critical.length > 0 ? 'text-red-400/80' :
            warnings.length > 0 ? 'text-amber-400/80' :
            'text-emerald-400/80'
          }`} />
          <span className="text-[11px] text-zinc-300">
            {totalAlerts > 0 && <span className="font-medium">{totalAlerts} alert{totalAlerts !== 1 ? 's' : ''}</span>}
            {totalAlerts > 0 && positive.length > 0 && ' · '}
            {positive.length > 0 && <span className="text-emerald-400/80">{positive.length} positive</span>}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 text-xs font-medium text-zinc-300 hover:text-zinc-100 transition-colors">
          <Activity className="w-3.5 h-3.5 text-zinc-400" />
          Anomaly Alerts
          {critical.length > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400/80">{critical.length}</span>}
          {warnings.length > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-400/80">{warnings.length}</span>}
          {positive.length > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/20 text-emerald-400/80">{positive.length}</span>}
          {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </button>
        {isAdmin && (
          <button onClick={handleScan} disabled={isLoading} title="Re-scan now"
            className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {/* AI Summary */}
          {aiSummary && (
            <div className="flex gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
              <Sparkles className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-zinc-400 leading-relaxed">{aiSummary}</p>
            </div>
          )}

          {/* Anomaly cards */}
          <div className="space-y-1.5">
            {anomalies.map(anomaly => {
              const style = SEVERITY_STYLES[anomaly.severity];
              const isExpanded = expanded === anomaly.id;

              return (
                <div key={anomaly.id} className={`rounded-lg border ${style.border} ${style.bg} overflow-hidden transition-all`}>
                  <div className="flex items-start gap-2 px-3 py-2 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : anomaly.id)}>
                    <SeverityIcon severity={anomaly.severity} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-zinc-200 truncate">{anomaly.title}</span>
                        {anomaly.acknowledgedAt && <Check className="w-3 h-3 text-zinc-500 flex-shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${style.badge}`}>{SOURCE_LABELS[anomaly.source]}</span>
                        <span className="text-[10px] text-zinc-600">{timeAgo(anomaly.detectedAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isAdmin && (
                        <button onClick={e => { e.stopPropagation(); handleDismiss(anomaly.id); }} title="Dismiss"
                          className="p-1 text-zinc-600 hover:text-zinc-400 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-3 pb-2.5 pt-0 border-t border-zinc-800/50">
                      <p className="text-[11px] text-zinc-400 leading-relaxed mt-2">{anomaly.description}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <div className="text-[10px]">
                          <span className="text-zinc-500">Previous: </span>
                          <span className="text-zinc-300 font-medium">{anomaly.previousValue.toLocaleString()}</span>
                        </div>
                        <div className="text-[10px]">
                          <span className="text-zinc-500">Current: </span>
                          <span className="text-zinc-300 font-medium">{anomaly.currentValue.toLocaleString()}</span>
                        </div>
                        <div className={`text-[10px] font-medium ${anomaly.changePct > 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                          {anomaly.changePct > 0 ? '+' : ''}{anomaly.changePct}%
                        </div>
                      </div>
                      {isAdmin && !anomaly.acknowledgedAt && (
                        <button onClick={() => handleAcknowledge(anomaly.id)}
                          className="mt-2 text-[10px] px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors">
                          Mark as reviewed
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
