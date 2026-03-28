import { useIntelligenceSignals } from '../../hooks/admin/useIntelligenceSignals.js';
import { SectionCard } from '../ui/SectionCard.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Badge } from '../ui/Badge.js';
import { TrendingUp, AlertTriangle, Target } from 'lucide-react';
import type { StrategySignal } from '../../../shared/types/insights.js';

interface Props {
  workspaceId: string;
}

const iconMap = {
  momentum: TrendingUp,
  misalignment: AlertTriangle,
  content_gap: Target,
} as const;

const colorMap = {
  momentum: 'text-emerald-400',
  misalignment: 'text-amber-400',
  content_gap: 'text-blue-400',
} as const;

const badgeColorMap: Record<StrategySignal['type'], 'emerald' | 'amber' | 'blue'> = {
  momentum: 'emerald',
  misalignment: 'amber',
  content_gap: 'blue',
};

const badgeLabelMap: Record<StrategySignal['type'], string> = {
  momentum: 'Gaining',
  misalignment: 'Misaligned',
  content_gap: 'Gap',
};

export function IntelligenceSignals({ workspaceId }: Props) {
  const { data, isLoading } = useIntelligenceSignals(workspaceId);
  const signals = data?.signals ?? [];

  if (isLoading) {
    return (
      <SectionCard
        title="Intelligence Signals"
        titleIcon={<TrendingUp className="w-4 h-4 text-teal-400" />}
      >
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-zinc-800/50 rounded-lg" />
          ))}
        </div>
      </SectionCard>
    );
  }

  if (!signals.length) {
    return (
      <SectionCard
        title="Intelligence Signals"
        titleIcon={<TrendingUp className="w-4 h-4 text-teal-400" />}
      >
        <EmptyState
          icon={TrendingUp}
          title="No intelligence signals yet"
          description="Signals appear when the insight engine detects strategy-relevant patterns"
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Intelligence Signals"
      titleIcon={<TrendingUp className="w-4 h-4 text-teal-400" />}
      titleExtra={<Badge label={`${signals.length}`} color="teal" />}
    >
      <div className="space-y-2">
        {signals.slice(0, 10).map(signal => {
          const Icon = iconMap[signal.type];
          const color = colorMap[signal.type];
          return (
            <div
              key={signal.insightId}
              className="flex items-start gap-3 p-3 rounded-lg bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors"
            >
              <Icon className={`w-4 h-4 mt-0.5 ${color} shrink-0`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200 truncate">
                    {signal.keyword}
                  </span>
                  <Badge
                    label={badgeLabelMap[signal.type]}
                    color={badgeColorMap[signal.type]}
                  />
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">{signal.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
