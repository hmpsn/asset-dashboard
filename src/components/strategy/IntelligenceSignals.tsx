import { useState } from 'react';
import { useIntelligenceSignals } from '../../hooks/admin/useIntelligenceSignals.js';
import { useRecomputeSignals } from '../../hooks/admin/useRecomputeSignals.js';
import { SectionCard } from '../ui/SectionCard.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Badge, Button, Icon } from '../ui';
import { TrendingUp, AlertTriangle, Target, RefreshCw } from 'lucide-react'; // trend-icon-ok — icon usage here is signal-category decoration, not a directional metric trend readout.
import { timeAgo } from '../../lib/timeAgo.js';
import type { StrategySignal } from '../../../shared/types/insights.js';

interface Props {
  workspaceId: string;
  title?: string;
  subtitle?: string;
  initialLimit?: number;
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

export function IntelligenceSignals({
  workspaceId,
  title = 'Intelligence Signals',
  subtitle,
  initialLimit = 10,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useIntelligenceSignals(workspaceId);
  const recompute = useRecomputeSignals(workspaceId);
  const signals = data?.signals ?? [];
  const visibleSignals = expanded ? signals : signals.slice(0, initialLimit);

  // Right-aligned freshness caption + manual recompute (teal action). Lives in the SectionCard `action`
  // slot. The caption only renders once a computedAt is known.
  const headerAction = (
    <div className="flex items-center gap-2">
      {data?.computedAt && (
        <span className="t-caption-sm text-[var(--brand-text-muted)]">
          Computed {timeAgo(data.computedAt, { style: 'long' })}
        </span>
      )}
      <Button variant="link" size="sm" icon={RefreshCw} loading={recompute.isPending} onClick={() => recompute.mutate()}>
        Recompute now
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <SectionCard
        title={title}
        subtitle={subtitle}
        iconChip={!!subtitle}
        titleIcon={<Icon as={TrendingUp} size="md" className="text-[var(--blue)]" />}
      >
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)]" />
          ))}
        </div>
      </SectionCard>
    );
  }

  if (!signals.length) {
    return (
      <SectionCard
        title={title}
        subtitle={subtitle}
        iconChip={!!subtitle}
        titleIcon={<Icon as={TrendingUp} size="md" className="text-[var(--blue)]" />}
        action={headerAction}
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
      title={title}
      subtitle={subtitle}
      iconChip={!!subtitle}
      titleIcon={<Icon as={TrendingUp} size="md" className="text-[var(--blue)]" />}
      titleExtra={<Badge label={`${signals.length}`} tone="blue" />}
      action={headerAction}
    >
      <div className="space-y-2">
        {visibleSignals.map(signal => {
          const SignalIcon = iconMap[signal.type];
          const color = colorMap[signal.type];
          return (
            <div
              key={signal.insightId}
              className="flex items-start gap-3 p-3 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/30 hover:bg-[var(--surface-3)]/50 transition-colors"
            >
              <Icon as={SignalIcon} size="sm" className={`mt-0.5 ${color} shrink-0`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="t-body font-medium text-[var(--brand-text-bright)] truncate">
                    {signal.keyword}
                  </span>
                  <Badge
                    label={badgeLabelMap[signal.type]}
                    tone={badgeColorMap[signal.type]}
                  />
                </div>
                <p className="t-caption text-[var(--brand-text)] mt-0.5">{signal.detail}</p>
              </div>
            </div>
          );
        })}
        {signals.length > initialLimit && (
          <div className="flex justify-center pt-1">
            <Button variant="ghost" size="sm" onClick={() => setExpanded((open) => !open)}>
              {expanded ? 'Show fewer signals' : `Show all ${signals.length} signals`}
            </Button>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
