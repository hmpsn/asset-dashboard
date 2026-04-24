import { TrendingUp } from 'lucide-react';

interface QuickWin {
  pagePath: string;
  action: string;
  estimatedImpact: string;
  rationale: string;
  roiScore?: number;
}

export interface QuickWinsProps {
  quickWins: QuickWin[];
}

export function QuickWins({ quickWins }: QuickWinsProps) {
  if (quickWins.length === 0) return null;

  return (
    <div className="bg-zinc-900 border border-emerald-500/20 p-5" style={{ borderRadius: '6px 12px 6px 12px' }}>
      <h4 className="text-xs font-semibold text-emerald-300 mb-1 flex items-center gap-1.5">
        <TrendingUp className="w-3.5 h-3.5" /> Quick Wins
      </h4>
      <p className="text-[11px] text-zinc-500 mb-3">High-impact changes that can be implemented immediately.</p>
      <div className="space-y-2">
        {quickWins.map((qw, i) => {
          const impactColor = qw.estimatedImpact === 'high' ? 'text-emerald-400 bg-green-500/10 border-green-500/20' : qw.estimatedImpact === 'medium' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-zinc-400 bg-zinc-700/30 border-zinc-600/20';
          return (
            <div key={i} className="px-3 py-2.5 bg-zinc-800/40 rounded-lg border border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-zinc-500">{qw.pagePath}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${impactColor}`}>{qw.estimatedImpact} impact</span>
                  {qw.roiScore != null && qw.roiScore > 0 && (
                    <span className="text-[10px] font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">ROI {qw.roiScore}</span>
                  )}
                </div>
              </div>
              <div className="text-[11px] text-zinc-200 mt-1 font-medium">{qw.action}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{qw.rationale}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
