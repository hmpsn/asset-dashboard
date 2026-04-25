import { Icon } from '../ui';
import { Layers, TrendingUp, AlertTriangle } from 'lucide-react';

interface TopicCluster {
  topic: string;
  keywords: string[];
  ownedCount: number;
  totalCount: number;
  coveragePercent: number;
  avgPosition?: number;
  topCompetitor?: string;
  topCompetitorCoverage?: number;
  gap: string[];
}

export interface TopicClustersProps {
  clusters: TopicCluster[];
}

const coverageColor = (pct: number) =>
  pct >= 70 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
  : pct >= 40 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
  : 'text-red-400 bg-red-500/10 border-red-500/20';

const coverageBarColor = (pct: number) =>
  pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';

export function TopicClusters({ clusters }: TopicClustersProps) {
  if (clusters.length === 0) return null;

  return (
    <div className="bg-[var(--surface-2)] border border-teal-500/20 p-5 rounded-[var(--radius-signature)]">
      <h4 className="t-caption-sm font-semibold text-teal-300 mb-1 flex items-center gap-1.5">
        <Icon as={Layers} size="md" className="text-teal-300" /> Topical Authority
      </h4>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">Topic clusters ranked by coverage gap — lowest coverage = biggest opportunity.</p>
      <div className="space-y-2">
        {clusters.slice(0, 10).map((cluster, i) => (
          <div key={i} className="px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)]">
            <div className="flex items-center justify-between">
              <span className="t-ui font-medium text-[var(--brand-text-bright)] capitalize">{cluster.topic}</span>
              <div className="flex items-center gap-2">
                <span className={`t-caption-sm font-medium px-1.5 py-0.5 rounded border ${coverageColor(cluster.coveragePercent)}`}>
                  {cluster.coveragePercent}% coverage
                </span>
                <span className="t-micro text-[var(--brand-text-muted)]">{cluster.ownedCount}/{cluster.totalCount} kws</span>
              </div>
            </div>
            {/* Coverage bar */}
            <div className="mt-1.5 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${coverageBarColor(cluster.coveragePercent)}`} style={{ width: `${cluster.coveragePercent}%` }} />
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                {cluster.avgPosition && (
                  <span className="t-caption-sm text-[var(--brand-text)] flex items-center gap-0.5">
                    <Icon as={TrendingUp} size="sm" />Avg pos #{cluster.avgPosition}
                  </span>
                )}
                {cluster.topCompetitor && cluster.topCompetitorCoverage && (
                  <span className="t-caption-sm text-orange-400 flex items-center gap-0.5">
                    <Icon as={AlertTriangle} size="sm" className="text-orange-400" />{cluster.topCompetitor}: {cluster.topCompetitorCoverage}%
                  </span>
                )}
              </div>
            </div>
            {cluster.gap.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {cluster.gap.slice(0, 5).map((kw, ki) => (
                  <span key={ki} className="t-caption-sm px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
                    {kw}
                  </span>
                ))}
                {cluster.gap.length > 5 && (
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">+{cluster.gap.length - 5} more</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
