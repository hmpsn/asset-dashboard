import { useState } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Target, ChevronDown, Loader2, FileSearch } from 'lucide-react';
import type { FeedInsight } from '../../../shared/types/insights.js';
import { useDiagnosticForInsight, useRunDiagnostic } from '../../hooks/admin/useDiagnostics.js';
import { useFeatureFlag } from '../../hooks/useFeatureFlag.js';

const SEVERITY_CONFIG = {
  critical: { icon: TrendingDown, bg: 'bg-red-500/8', text: 'text-red-400/80', badge: 'Critical' },
  warning: { icon: AlertTriangle, bg: 'bg-amber-500/8', text: 'text-amber-400/80', badge: 'Warning' },
  opportunity: { icon: Target, bg: 'bg-blue-500/10', text: 'text-blue-400', badge: 'Opportunity' },
  positive: { icon: TrendingUp, bg: 'bg-emerald-500/10', text: 'text-emerald-400', badge: 'Win' },
} as const;

function DiagnosticCTA({ workspaceId, insightId }: { workspaceId: string; insightId: string }) {
  const { data } = useDiagnosticForInsight(workspaceId, insightId);
  const { mutate: run, isPending } = useRunDiagnostic(workspaceId);
  const report = data?.report;

  if (report?.status === 'completed') {
    return (
      <a
        href={`/ws/${workspaceId}/diagnostics?report=${report.id}`}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-teal-400 hover:text-teal-300"
      >
        <FileSearch className="w-3.5 h-3.5" />
        View Diagnostic Report
      </a>
    );
  }

  if (report?.status === 'running' || isPending) {
    return (
      <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Analyzing...
      </div>
    );
  }

  if (report?.status === 'failed') {
    return (
      <button
        onClick={() => run(insightId)}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300"
      >
        <FileSearch className="w-3.5 h-3.5" />
        Retry Diagnostic
      </button>
    );
  }

  return (
    <button
      onClick={() => run(insightId)}
      className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-teal-400 hover:text-teal-300"
    >
      <FileSearch className="w-3.5 h-3.5" />
      Run Deep Diagnostic
    </button>
  );
}

export function InsightFeedItem({ insight, workspaceId }: { insight: FeedInsight; workspaceId?: string }) {
  const config = SEVERITY_CONFIG[insight.severity];
  const Icon = config.icon;
  const hasDetails = insight.details && insight.details.length > 0;
  const [expanded, setExpanded] = useState(false);
  const diagnosticsEnabled = useFeatureFlag('deep-diagnostics');
  const showDiagnosticCTA = diagnosticsEnabled && workspaceId && insight.type === 'anomaly_digest';

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      <div
        className={`px-3 py-2.5 flex items-center gap-3 ${hasDetails ? 'cursor-pointer hover:bg-zinc-800/30 transition-colors' : ''}`}
        onClick={hasDetails ? () => setExpanded(!expanded) : undefined}
      >
        <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${config.bg}`}>
          <Icon className={`w-3.5 h-3.5 ${config.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-zinc-200 font-medium truncate">
            {insight.title} <span className="text-zinc-500 font-normal">— {insight.headline}</span>
          </div>
          {insight.context && (
            <div className="text-[11px] text-zinc-500 truncate mt-0.5">{insight.context}</div>
          )}
        </div>
        <span className={`px-2 py-0.5 rounded text-[9px] font-medium flex-shrink-0 ${config.bg} ${config.text}`}>
          {config.badge}
        </span>
        {hasDetails && (
          <ChevronDown className={`w-3.5 h-3.5 text-zinc-600 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        )}
      </div>
      {expanded && hasDetails && (
        <div className="px-3 pb-2.5 pt-0 ml-10">
          <div className="border-t border-zinc-800/50 pt-2 space-y-1">
            {insight.details!.map((line, i) => (
              <div key={i} className="text-[11px] text-zinc-400 font-mono truncate">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
      {showDiagnosticCTA && (
        <div className="px-3 pb-2.5 ml-10">
          <DiagnosticCTA workspaceId={workspaceId} insightId={insight.id} />
        </div>
      )}
    </div>
  );
}
