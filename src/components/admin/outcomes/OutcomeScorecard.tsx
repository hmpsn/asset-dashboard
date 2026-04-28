import { BarChart2, Minus, Activity } from 'lucide-react';
import { TrendBadge } from '../../ui/TrendBadge';
import {
  MetricRing,
  SectionCard,
  StatCard,
  EmptyState,
  Skeleton,
  StatCardSkeleton,
  SectionCardSkeleton,
  Badge,
  scoreColor,
  scoreBgBarClass,
} from '../../ui';
import { useOutcomeScorecard } from '../../../hooks/admin/useOutcomes';
import { ACTION_TYPE_LABELS } from './outcomeConstants';

interface Props {
  workspaceId: string;
}

function TrendIcon({ trend }: { trend: 'improving' | 'stable' | 'declining' }) {
  if (trend === 'improving') return <TrendBadge value={1} iconOnly hideOnZero={false} size="md" />;
  if (trend === 'declining') return <TrendBadge value={-1} iconOnly hideOnZero={false} size="md" />;
  return <Minus className="w-4 h-4 text-[var(--brand-text)]" />;
}

function TrendLabel({ trend }: { trend: 'improving' | 'stable' | 'declining' }) {
  const map = {
    improving: { label: 'Improving', color: 'text-emerald-400' },
    stable: { label: 'Stable', color: 'text-[var(--brand-text)]' },
    declining: { label: 'Declining', color: 'text-red-400' },
  };
  const { label, color } = map[trend];
  return <span className={`text-xs font-medium ${color}`}>{label}</span>;
}

export default function OutcomeScorecard({ workspaceId }: Props) {
  const { data: scorecard, isLoading, error, refetch } = useOutcomeScorecard(workspaceId);

  if (isLoading) {
    return (
      <div className="space-y-5">
        {/* Win rate ring + stat cards */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="flex flex-col items-center justify-center bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] p-6">
            <Skeleton className="w-36 h-36 rounded-full" />
            <Skeleton className="w-20 h-3 mt-3" />
          </div>
          <div className="lg:col-span-3 grid grid-cols-3 gap-3">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
        </div>
        <SectionCardSkeleton lines={5} />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={BarChart2}
        title="Could not load scorecard"
        description="There was a problem loading outcome data. Try refreshing the page."
        action={
          <button
            onClick={() => refetch()}
            className="text-xs px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 transition-colors"
          >
            Retry
          </button>
        }
      />
    );
  }

  if (!scorecard) {
    return (
      <EmptyState
        icon={BarChart2}
        title="Outcomes tracking is active"
        description="As you act on insights and publish content, results will appear here."
      />
    );
  }

  const winRateScore = Math.round(scorecard.overallWinRate * 100);

  return (
    <div className="space-y-5">
      {/* Top row: ring + stat cards */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Win rate ring */}
        <SectionCard noPadding className="flex flex-col items-center justify-center gap-3 py-6 px-4">
          <MetricRing score={winRateScore} size={144} />
          <div className="flex flex-col items-center gap-1">
            <span className="t-caption text-[var(--brand-text-muted)] uppercase tracking-wider font-medium">Overall Win Rate</span>
            <div className="flex items-center gap-1.5">
              <TrendIcon trend={scorecard.trend} />
              <TrendLabel trend={scorecard.trend} />
            </div>
          </div>
        </SectionCard>

        {/* Stat cards */}
        <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            label="Total Tracked"
            value={scorecard.totalTracked}
            icon={Activity}
            iconColor="#60a5fa"
            valueColor="text-blue-400"
            sub="actions logged"
            staggerIndex={0}
          />
          <StatCard
            label="Total Scored"
            value={scorecard.totalScored}
            icon={BarChart2}
            iconColor={scoreColor(winRateScore)}
            valueColor={winRateScore >= 80 ? 'text-emerald-400' : winRateScore >= 60 ? 'text-amber-400' : 'text-red-400'}
            sub={`${Math.round(scorecard.strongWinRate * 100)}% strong wins`}
            staggerIndex={1}
          />
          <StatCard
            label="Pending Measurement"
            value={scorecard.pendingMeasurement}
            icon={Minus}
            iconColor="#a1a1aa"
            sub="awaiting results"
            staggerIndex={2}
          />
        </div>
      </div>

      {/* Category breakdown */}
      {scorecard.byCategory.length > 0 && (
        <SectionCard title="Win Rate by Action Type" titleIcon={<BarChart2 className="w-4 h-4 text-blue-400" />}>
          <div className="space-y-3">
            {scorecard.byCategory.map((cat) => {
              const pct = Math.round(cat.winRate * 100);
              return (
                <div key={cat.actionType} className="flex items-center gap-3">
                  <span className="text-xs text-[var(--brand-text)] w-36 shrink-0">
                    {ACTION_TYPE_LABELS[cat.actionType] ?? cat.actionType}
                  </span>
                  <div className="flex-1 h-2 bg-[var(--surface-1)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${scoreBgBarClass(pct)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className="text-xs font-semibold w-8 text-right"
                      style={{ color: scoreColor(pct) }}
                    >
                      {pct}%
                    </span>
                    <Badge label={`${cat.scored}/${cat.count}`} color="zinc" />
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
