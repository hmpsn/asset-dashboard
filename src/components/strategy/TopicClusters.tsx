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
  pct >= 70 ? 'text-green-400 bg-green-500/10 border-green-500/20'
  : pct >= 40 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
  : 'text-red-400 bg-red-500/10 border-red-500/20';

const coverageBarColor = (pct: number) =>
  pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';

export function TopicClusters({ clusters }: TopicClustersProps) {
  if (clusters.length === 0) return null;

  return (
    <div className="bg-zinc-900 rounded-xl border border-violet-500/20 p-4">
      <h4 className="text-xs font-semibold text-violet-300 mb-1 flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5" /> Topical Authority
      </h4>
      <p className="text-[11px] text-zinc-500 mb-3">Topic clusters ranked by coverage gap — lowest coverage = biggest opportunity.</p>
      <div className="space-y-2">
        {clusters.slice(0, 10).map((cluster, i) => (
          <div key={i} className="px-3 py-2.5 bg-zinc-800/40 rounded-lg border border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-200 capitalize">{cluster.topic}</span>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${coverageColor(cluster.coveragePercent)}`}>
                  {cluster.coveragePercent}% coverage
                </span>
                <span className="text-[10px] text-zinc-500">{cluster.ownedCount}/{cluster.totalCount} kws</span>
              </div>
            </div>
            {/* Coverage bar */}
            <div className="mt-1.5 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${coverageBarColor(cluster.coveragePercent)}`} style={{ width: `${cluster.coveragePercent}%` }} />
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                {cluster.avgPosition && (
                  <span className="text-[10px] text-zinc-400 flex items-center gap-0.5">
                    <TrendingUp className="w-3 h-3" />Avg pos #{cluster.avgPosition}
                  </span>
                )}
                {cluster.topCompetitor && cluster.topCompetitorCoverage && (
                  <span className="text-[10px] text-orange-400 flex items-center gap-0.5">
                    <AlertTriangle className="w-3 h-3" />{cluster.topCompetitor}: {cluster.topCompetitorCoverage}%
                  </span>
                )}
              </div>
            </div>
            {cluster.gap.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {cluster.gap.slice(0, 5).map((kw, ki) => (
                  <span key={ki} className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                    {kw}
                  </span>
                ))}
                {cluster.gap.length > 5 && (
                  <span className="text-[10px] text-zinc-500">+{cluster.gap.length - 5} more</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
