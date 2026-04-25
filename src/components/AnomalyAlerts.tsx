import { useState } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Activity, X, Check, RefreshCw, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useAnomalyAlerts } from '../hooks/admin';
import { post } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { timeAgo } from '../lib/timeAgo';
import { Icon, Tooltip } from './ui';

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
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/5',
    badge: 'bg-emerald-500/20 text-emerald-400/80',
    icon: 'text-emerald-400/80',
  },
};

const SOURCE_LABELS: Record<string, string> = {
  gsc: 'Search Console',
  ga4: 'Analytics',
  audit: 'Site Health',
};

function SeverityIcon({ severity }: { severity: 'critical' | 'warning' | 'positive' }) {
  const cls = SEVERITY_STYLES[severity].icon;
  if (severity === 'positive') return <Icon as={TrendingUp} size="md" className={cls} />;
  if (severity === 'critical') return <Icon as={TrendingDown} size="md" className={cls} />;
  return <Icon as={AlertTriangle} size="md" className={cls} />;
}

export function AnomalyAlerts({ workspaceId, isAdmin = false, compact = false }: AnomalyAlertsProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const queryClient = useQueryClient();

  // React Query hook replaces manual useEffect fetching
  const { data: anomalies = [], isLoading } = useAnomalyAlerts(workspaceId, isAdmin);

  const handleDismiss = async (id: string) => {
    try {
      await post(`/api/anomalies/${id}/dismiss`);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.anomalyAlerts(workspaceId) });
    } catch (err) { console.error('AnomalyAlerts operation failed:', err); }
  };

  const handleAcknowledge = async (id: string) => {
    try {
      await post(`/api/anomalies/${id}/acknowledge`);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.anomalyAlerts(workspaceId) });
    } catch (err) { console.error('AnomalyAlerts operation failed:', err); }
  };

  const handleRefresh = async () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.anomalyAlerts(workspaceId) });
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
      // pr-check-disable-next-line -- asymmetric signature radius for anomaly compact card; not a section card
      <div className={`border px-3 py-2 rounded-[var(--radius-signature)] ${
        critical.length > 0 ? 'border-red-500/30 bg-red-500/5' :
        warnings.length > 0 ? 'border-amber-500/30 bg-amber-500/5' :
        'border-emerald-500/30 bg-emerald-500/5'
      }`}>
        <div className="flex items-center gap-2">
          <Icon as={Activity} size="sm" className={
            critical.length > 0 ? 'text-red-400/80' :
            warnings.length > 0 ? 'text-amber-400/80' :
            'text-emerald-400/80'
          } />
          <span className="t-caption text-[var(--brand-text-bright)]">
            {totalAlerts > 0 && <span className="font-medium">{totalAlerts} alert{totalAlerts !== 1 ? 's' : ''}</span>}
            {totalAlerts > 0 && positive.length > 0 && ' · '}
            {positive.length > 0 && <span className="text-emerald-400/80">{positive.length} positive</span>}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 text-xs font-medium text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors">
          <Icon as={Activity} size="sm" className="text-[var(--brand-text)]" />
          Anomaly Alerts
          {critical.length > 0 && <span className="px-1.5 py-0.5 rounded t-caption-sm bg-red-500/20 text-red-400/80">{critical.length}</span>}
          {warnings.length > 0 && <span className="px-1.5 py-0.5 rounded t-caption-sm bg-amber-500/20 text-amber-400/80">{warnings.length}</span>}
          {positive.length > 0 && <span className="px-1.5 py-0.5 rounded t-caption-sm bg-emerald-500/20 text-emerald-400/80">{positive.length}</span>}
          {collapsed ? <Icon as={ChevronDown} size="xs" /> : <Icon as={ChevronUp} size="xs" />}
        </button>
        {isAdmin && (
          <Tooltip content="Re-scan now">
            <button onClick={handleScan} disabled={isLoading}
              className="p-1 text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors disabled:opacity-50">
              <Icon as={RefreshCw} size="xs" className={isLoading ? 'animate-spin' : ''} />
            </button>
          </Tooltip>
        )}
      </div>

      {!collapsed && (
        <>
          {/* AI Summary */}
          {aiSummary && (
            <div className="flex gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--surface-3)]/50 border border-[var(--brand-border-hover)]/50">
              <Icon as={Sparkles} size="sm" className="text-purple-400 flex-shrink-0 mt-0.5" />
              <p className="t-caption text-[var(--brand-text)] leading-relaxed">{aiSummary}</p>
            </div>
          )}

          {/* Anomaly cards */}
          <div className="space-y-2">
            {anomalies.map(anomaly => {
              const style = SEVERITY_STYLES[anomaly.severity];
              const isExpanded = expanded === anomaly.id;

              return (
                <div key={anomaly.id} className={`border ${style.border} ${style.bg} overflow-hidden transition-all rounded-[var(--radius-signature)]`}>
                  <div className="flex items-start gap-2 px-3 py-3 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : anomaly.id)}>
                    <SeverityIcon severity={anomaly.severity} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="t-caption font-medium text-[var(--brand-text-bright)] truncate">{anomaly.title}</span>
                        {anomaly.acknowledgedAt && <Icon as={Check} size="xs" className="text-[var(--brand-text-muted)] flex-shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`t-caption-sm px-1.5 py-0.5 rounded ${style.badge}`}>{SOURCE_LABELS[anomaly.source]}</span>
                        <span className="t-caption-sm text-[var(--brand-text-dim)]">{timeAgo(anomaly.detectedAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isAdmin && (
                        <button onClick={e => { e.stopPropagation(); handleDismiss(anomaly.id); }} aria-label="Dismiss"
                          className="p-1 text-[var(--brand-text-dim)] hover:text-[var(--brand-text)] transition-colors">
                          <Icon as={X} size="xs" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-3 pb-3 pt-0 border-t border-[var(--brand-border)]/50">
                      <p className="t-caption text-[var(--brand-text)] leading-relaxed mt-3">{anomaly.description}</p>
                      <div className="flex items-center gap-3 mt-3">
                        <div className="t-caption-sm">
                          <span className="text-[var(--brand-text-muted)]">Previous: </span>
                          <span className="text-[var(--brand-text-bright)] font-medium">{anomaly.previousValue.toLocaleString()}</span>
                        </div>
                        <div className="t-caption-sm">
                          <span className="text-[var(--brand-text-muted)]">Current: </span>
                          <span className="text-[var(--brand-text-bright)] font-medium">{anomaly.currentValue.toLocaleString()}</span>
                        </div>
                        <div className={`t-caption-sm font-medium ${anomaly.changePct > 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                          {anomaly.changePct > 0 ? '+' : ''}{anomaly.changePct}%
                        </div>
                      </div>
                      {isAdmin && !anomaly.acknowledgedAt && (
                        <button onClick={() => handleAcknowledge(anomaly.id)}
                          className="mt-2 t-caption-sm px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--surface-3)] border border-[var(--brand-border-hover)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:border-[var(--brand-text-dim)] transition-colors">
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
