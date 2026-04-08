import type { MeetingBriefMetrics } from '../../../../shared/types/meeting-brief.js';

interface Props {
  metrics: MeetingBriefMetrics;
}

interface MetricTileProps {
  label: string;
  value: string | number | null;
  unit?: string;
}

function MetricTile({ label, value, unit }: MetricTileProps) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 border border-zinc-800 rounded-lg bg-zinc-900/50">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="text-xl font-semibold text-blue-400">
        {value != null ? `${value}${unit ?? ''}` : '—'}
      </span>
    </div>
  );
}

export function AtAGlanceStrip({ metrics }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      <MetricTile
        label="Site Health"
        value={metrics.siteHealthScore}
        unit="/100"
      />
      <MetricTile
        label="Ranking Opps"
        value={metrics.openRankingOpportunities}
      />
      <MetricTile
        label="In Pipeline"
        value={metrics.contentInPipeline}
        unit=" pieces"
      />
      <MetricTile
        label="Win Rate"
        value={metrics.overallWinRate}
        unit="%"
      />
      <MetricTile
        label="Critical Issues"
        value={metrics.criticalIssues}
      />
    </div>
  );
}
