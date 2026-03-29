import { TrendingUp, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SectionCard, EmptyState } from '../ui';
import { adminPath } from '../../routes';

interface RankEntry {
  query: string;
  position: number;
  previousPosition?: number;
  change?: number;
}

interface RankingsSnapshotProps {
  ranks: RankEntry[];
  gscPropertyUrl?: string;
  workspaceId: string;
  className?: string;
}

export function RankingsSnapshot({ ranks, gscPropertyUrl, workspaceId, className }: RankingsSnapshotProps) {
  const navigate = useNavigate();
  return (
    <SectionCard
      title="Top Rankings"
      titleIcon={<TrendingUp className="w-4 h-4 text-teal-400" />}
      action={ranks.length > 0 ? <button onClick={() => navigate(adminPath(workspaceId, 'seo-ranks'))} className="text-[11px] text-teal-400 hover:text-teal-300 transition-colors">View All →</button> : undefined}
      className={className}
      noPadding
    >
      {ranks.length > 0 ? (
        <div className="divide-y divide-zinc-800/50">
          {ranks.slice(0, 6).map((r, i) => (
            <div key={i} className="flex items-center gap-2.5 px-4 py-2">
              <span className="text-[11px] text-zinc-400 truncate flex-1">{r.query}</span>
              <span className="text-[11px] font-medium text-zinc-200 tabular-nums w-6 text-right">{Math.round(r.position)}</span>
              {r.change != null && r.change !== 0 && (
                <span className={`flex items-center text-[11px] font-medium w-8 justify-end ${r.change > 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                  {r.change > 0 ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                  {Math.abs(Math.round(r.change))}
                </span>
              )}
              {(r.change == null || r.change === 0) && <span className="w-8 flex justify-end"><Minus className="w-2.5 h-2.5 text-zinc-600" /></span>}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={TrendingUp} title={gscPropertyUrl ? 'No keywords tracked yet' : 'Connect GSC to track rankings'} className="py-8" />
      )}
    </SectionCard>
  );
}
