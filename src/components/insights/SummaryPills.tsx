import type { SummaryCount } from '../../../shared/types/insights.js';
import { Skeleton } from '../ui';

const PILL_COLORS: Record<string, { dot: string; activeBg: string }> = {
  red: { dot: 'bg-red-400', activeBg: 'bg-red-500/15 border-red-500/30' },
  amber: { dot: 'bg-amber-400', activeBg: 'bg-amber-500/15 border-amber-500/30' },
  green: { dot: 'bg-emerald-400', activeBg: 'bg-emerald-500/15 border-emerald-500/30' },   // legacy alias
  emerald: { dot: 'bg-emerald-400', activeBg: 'bg-emerald-500/15 border-emerald-500/30' },
  blue: { dot: 'bg-blue-400', activeBg: 'bg-blue-500/15 border-blue-500/30' },
  purple: { dot: 'bg-purple-400', activeBg: 'bg-purple-500/15 border-purple-500/30' },
};

interface SummaryPillsProps {
  counts: SummaryCount[];
  activeFilter: string | null;
  onFilter: (filterKey: string | null) => void;
  loading?: boolean;
}

export function SummaryPills({ counts, activeFilter, onFilter, loading }: SummaryPillsProps) {
  if (loading) {
    return (
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28 rounded-[var(--radius-lg)]" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex gap-2 flex-wrap">
      {counts.map(pill => {
        const colors = PILL_COLORS[pill.color] ?? PILL_COLORS.blue;
        const isActive = activeFilter === pill.filterKey;
        return (
          <button
            key={pill.filterKey}
            onClick={() => onFilter(isActive ? null : pill.filterKey)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] text-xs transition-all border ${
              isActive ? colors.activeBg : 'bg-[var(--surface-3)]/50 border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]'
            }`}
          >
            <span className={`w-2 h-2 rounded-[var(--radius-pill)] ${colors.dot}`} />
            <span className="text-[var(--brand-text-bright)] font-semibold tabular-nums">{pill.count}</span>
            <span className="text-[var(--brand-text-muted)]">{pill.label}</span>
          </button>
        );
      })}
    </div>
  );
}
