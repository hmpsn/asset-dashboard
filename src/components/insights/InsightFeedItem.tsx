import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, TrendingUp, TrendingDown, Target, ChevronDown, Loader2, FileSearch } from 'lucide-react'; // trend-icon-ok — used as severity/status glyphs in feed badges, not directional metric trends.
import { Icon } from '../ui/Icon.js';
import { Button } from '../ui';
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
      <Link
        to={`/ws/${workspaceId}/diagnostics?report=${report.id}`}
        className="mt-3 inline-flex items-center gap-1.5 t-caption font-medium text-teal-400 hover:text-teal-300"
      >
        <Icon as={FileSearch} size="md" />
        View Diagnostic Report
      </Link>
    );
  }

  if (report?.status === 'running' || isPending) {
    return (
      <div className="mt-3 inline-flex items-center gap-1.5 t-caption text-[var(--brand-text-muted)]">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Analyzing...
      </div>
    );
  }

  if (report?.status === 'failed') {
    return (
      <Button
        onClick={() => run(insightId)}
        variant="ghost"
        size="sm"
        className="mt-3 inline-flex items-center gap-1.5 t-caption font-medium text-amber-400 hover:text-amber-300 !px-0 !py-0 bg-transparent hover:bg-transparent"
      >
        <Icon as={FileSearch} size="md" />
        Retry Diagnostic
      </Button>
    );
  }

  return (
    <Button
      onClick={() => run(insightId)}
      variant="ghost"
      size="sm"
      className="mt-3 inline-flex items-center gap-1.5 t-caption font-medium text-teal-400 hover:text-teal-300 !px-0 !py-0 bg-transparent hover:bg-transparent"
    >
      <Icon as={FileSearch} size="md" />
      Run Deep Diagnostic
    </Button>
  );
}

export function InsightFeedItem({ insight, workspaceId }: { insight: FeedInsight; workspaceId?: string }) {
  const config = SEVERITY_CONFIG[insight.severity];
  const SeverityIcon = config.icon;
  const hasDetails = insight.details && insight.details.length > 0;
  const [expanded, setExpanded] = useState(false);
  const diagnosticsEnabled = useFeatureFlag('deep-diagnostics');
  const showDiagnosticCTA = diagnosticsEnabled && workspaceId && insight.type === 'anomaly_digest';

  return (
    <div className="bg-[var(--surface-2)]/50 border border-[var(--brand-border)] rounded-[var(--radius-md)] overflow-hidden">
      <div
        className={`px-3 py-2.5 flex items-center gap-3 ${hasDetails ? 'cursor-pointer hover:bg-[var(--surface-3)]/30 transition-colors' : ''}`}
        onClick={hasDetails ? () => setExpanded(!expanded) : undefined}
      >
        <div className={`w-7 h-7 rounded-[var(--radius-sm)] flex items-center justify-center flex-shrink-0 ${config.bg}`}>
          <Icon as={SeverityIcon} size="md" className={config.text} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="t-caption text-[var(--brand-text-bright)] font-medium truncate">
            {insight.title} <span className="text-[var(--brand-text-muted)] font-normal">— {insight.headline}</span>
          </div>
          {insight.context && (
            <div className="t-caption-sm text-[var(--brand-text-muted)] truncate mt-0.5">{insight.context}</div>
          )}
        </div>
        <span className={`px-2 py-0.5 rounded-[var(--radius-sm)] t-caption-sm font-medium flex-shrink-0 ${config.bg} ${config.text}`}>
          {config.badge}
        </span>
        {hasDetails && (
          <Icon as={ChevronDown} size="md" className={`text-[var(--brand-text-dim)] flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        )}
      </div>
      {expanded && hasDetails && (
        <div className="px-3 pb-2.5 pt-0 ml-10">
          <div className="border-t border-[var(--brand-border)]/50 pt-2 space-y-1">
            {insight.details!.map((line, i) => (
              <div key={i} className="t-caption-sm text-[var(--brand-text)] font-mono truncate">
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
