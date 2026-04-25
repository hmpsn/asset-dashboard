import { Icon } from '../ui';
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
    <div className="bg-[var(--surface-2)] border border-emerald-500/20 p-5 rounded-[var(--radius-signature)]">
      <h4 className="t-caption-sm font-semibold text-emerald-300 mb-1 flex items-center gap-1.5">
        <Icon as={TrendingUp} size="sm" className="text-emerald-300" /> Quick Wins
      </h4>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">High-impact changes that can be implemented immediately.</p>
      <div className="space-y-2">
        {quickWins.map((qw, i) => {
          const impactColor = qw.estimatedImpact === 'high' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : qw.estimatedImpact === 'medium' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-[var(--brand-text)] bg-zinc-700/30 border-zinc-600/20';
          return (
            <div key={i} className="px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)]">
              <div className="flex items-center justify-between">
                <span className="t-mono text-[var(--brand-text-muted)]">{qw.pagePath}</span>
                <div className="flex items-center gap-2">
                  <span className={`t-caption-sm font-medium px-1.5 py-0.5 rounded border ${impactColor}`}>{qw.estimatedImpact} impact</span>
                  {qw.roiScore != null && qw.roiScore > 0 && (
                    <span className="t-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">ROI {qw.roiScore}</span>
                  )}
                </div>
              </div>
              <div className="t-caption-sm text-[var(--brand-text-bright)] mt-1 font-medium">{qw.action}</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{qw.rationale}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
