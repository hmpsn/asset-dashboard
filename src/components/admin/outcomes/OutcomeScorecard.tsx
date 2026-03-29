import { BarChart2, TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
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
import type { ActionType } from '../../../../shared/types/outcome-tracking';

interface Props {
  workspaceId: string;
}

const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  insight_acted_on: 'Insight',
  content_published: 'Content Published',
  brief_created: 'Brief Created',
  strategy_keyword_added: 'Strategy Update',
  schema_deployed: 'Schema Deployed',
  audit_fix_applied: 'Audit Fix',
  content_refreshed: 'Content Refresh',
  internal_link_added: 'Internal Link',
  meta_updated: 'Meta Update',
  voice_calibrated: 'Voice Calibration',
};

function TrendIcon({ trend }: { trend: 'improving' | 'stable' | 'declining' }) {
  if (trend === 'improving') return <TrendingUp className="w-4 h-4 text-emerald-400" />;
  if (trend === 'declining') return <TrendingDown className="w-4 h-4 text-red-400" />;
  return <Minus className="w-4 h-4 text-zinc-400" />;
}

function TrendLabel({ trend }: { trend: 'improving' | 'stable' | 'declining' }) {
  const map = {
    improving: { label: 'Improving', color: 'text-emerald-400' },
    stable: { label: 'Stable', color: 'text-zinc-400' },
    declining: { label: 'Declining', color: 'text-red-400' },
  };
  const { label, color } = map[trend];
  return <span className={`text-xs font-medium ${color}`}>{label}</span>;
}

export default function OutcomeScorecard({ workspaceId }: Props) {
  const { data: scorecard, isLoading, error } = useOutcomeScorecard(workspaceId);

  if (isLoading) {
    return (
      <div className="space-y-5">
        {/* Win rate ring + stat cards */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="flex flex-col items-center justify-center bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
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

  if (error || !scorecard) {
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
        <SectionCard className="flex flex-col items-center justify-center gap-3 py-6">
          <MetricRing score={winRateScore} size={144} />
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Overall Win Rate</span>
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
                  <span className="text-xs text-zinc-400 w-36 shrink-0">
                    {ACTION_TYPE_LABELS[cat.actionType] ?? cat.actionType}
                  </span>
                  <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
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
