// src/components/admin/outcomes/OutcomesOverview.tsx
// Cross-workspace outcomes summary — admin only.

import { TrendingUp, TrendingDown, Minus, AlertTriangle, BarChart3, Activity } from 'lucide-react';
import { PageHeader, SectionCard, StatCard, EmptyState, Skeleton, Badge } from '../../ui';
import { FeatureFlag } from '../../ui/FeatureFlag';
import { ErrorBoundary } from '../../ErrorBoundary';
import { useOutcomeOverview } from '../../../hooks/admin/useOutcomes';
import { scoreColorClass } from '../../ui/constants';
import type { WorkspaceOutcomeOverview, LearningsTrend } from '../../../../shared/types/outcome-tracking';

// --- Helpers -----------------------------------------------------------

function trendIcon(trend: LearningsTrend) {
  if (trend === 'improving') return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
  if (trend === 'declining') return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
  return <Minus className="w-3.5 h-3.5 text-zinc-400" />;
}

function trendLabel(trend: LearningsTrend): string {
  if (trend === 'improving') return 'Improving';
  if (trend === 'declining') return 'Declining';
  return 'Stable';
}

function trendColor(trend: LearningsTrend): string {
  if (trend === 'improving') return 'text-emerald-400';
  if (trend === 'declining') return 'text-red-400';
  return 'text-zinc-400';
}

function winRatePct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function winRateClass(rate: number): string {
  return scoreColorClass(rate * 100);
}

// --- Aggregate stats bar ----------------------------------------------

function AggregateStats({ workspaces }: { workspaces: WorkspaceOutcomeOverview[] }) {
  const totalActions = workspaces.reduce((sum, w) => sum + w.activeActions, 0);
  const totalScored = workspaces.reduce((sum, w) => sum + w.scoredLast30d, 0);
  const attentionCount = workspaces.filter(w => w.attentionNeeded).length;

  const winRates = workspaces
    .filter(w => w.scoredLast30d > 0)
    .map(w => w.winRate);
  const avgWinRate = winRates.length > 0
    ? winRates.reduce((sum, r) => sum + r, 0) / winRates.length
    : 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        label="Avg win rate"
        value={winRatePct(avgWinRate)}
        valueColor={winRateClass(avgWinRate)}
      />
      <StatCard
        label="Actions tracked"
        value={totalActions.toString()}
      />
      <StatCard
        label="Scored (30d)"
        value={totalScored.toString()}
        valueColor="text-blue-400"
      />
      <StatCard
        label="Need attention"
        value={attentionCount.toString()}
        valueColor={attentionCount > 0 ? 'text-amber-400' : 'text-zinc-400'}
      />
    </div>
  );
}

// --- Workspace row ----------------------------------------------------

function WorkspaceRow({ ws }: { ws: WorkspaceOutcomeOverview }) {
  const winPct = Math.round(ws.winRate * 100);

  return (
    <tr className="border-t border-zinc-800/60 hover:bg-zinc-800/20 transition-colors">
      {/* Workspace name */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-100">{ws.workspaceName}</span>
          {ws.attentionNeeded && (
            <span title={ws.attentionReason ?? 'Needs attention'}>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            </span>
          )}
        </div>
        {ws.attentionReason && (
          <p className="text-xs text-amber-400/70 mt-0.5">{ws.attentionReason}</p>
        )}
      </td>

      {/* Win rate */}
      <td className={`py-3 px-4 text-sm font-semibold ${winRateClass(ws.winRate)}`}>
        {ws.scoredLast30d > 0 ? `${winPct}%` : <span className="text-zinc-500 font-normal">—</span>}
      </td>

      {/* Trend */}
      <td className="py-3 px-4">
        <div className={`flex items-center gap-1.5 text-xs ${trendColor(ws.trend)}`}>
          {trendIcon(ws.trend)}
          {trendLabel(ws.trend)}
        </div>
      </td>

      {/* Active actions */}
      <td className="py-3 px-4 text-sm text-zinc-300">
        {ws.activeActions}
      </td>

      {/* Scored last 30d */}
      <td className="py-3 px-4 text-sm text-blue-400">
        {ws.scoredLast30d}
      </td>

      {/* Top win summary */}
      <td className="py-3 px-4 max-w-xs">
        {ws.topWin ? (
          <div className="space-y-0.5">
            <p className="text-xs text-zinc-300 truncate">
              {ws.topWin.targetKeyword
                ? `"${ws.topWin.targetKeyword}"`
                : ws.topWin.pageUrl?.replace(/^https?:\/\/[^/]+/, '') ?? 'Unknown page'}
            </p>
            <p className={`text-xs font-medium ${winRateClass(ws.winRate)}`}>
              {ws.topWin.delta.delta_percent >= 0 ? '+' : ''}{ws.topWin.delta.delta_percent.toFixed(1)}% {ws.topWin.delta.primary_metric}
            </p>
          </div>
        ) : (
          <span className="text-xs text-zinc-600">No wins yet</span>
        )}
      </td>

      {/* Attention flag */}
      <td className="py-3 px-4">
        {ws.attentionNeeded ? (
          <Badge label="Review" color="amber" />
        ) : (
          <Badge label="On track" color="green" />
        )}
      </td>
    </tr>
  );
}

// --- Loading skeleton -------------------------------------------------

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

// --- Main component ---------------------------------------------------

export default function OutcomesOverview() {
  const { data: workspaces = [], isLoading } = useOutcomeOverview();

  return (
    <FeatureFlag flag="outcome-dashboard">
      <ErrorBoundary>
        <div className="space-y-6">
          <PageHeader
            title="Outcomes Overview"
            subtitle="Cross-workspace outcome tracking — win rates, trends, and actions that need attention"
          />

          {isLoading && (
            <SectionCard>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
                <TableSkeleton />
              </div>
            </SectionCard>
          )}

          {!isLoading && workspaces.length === 0 && (
            <SectionCard>
              <EmptyState
                icon={BarChart3}
                title="No outcome data yet"
                description="Outcome tracking will populate here once actions are recorded and measurement windows close."
              />
            </SectionCard>
          )}

          {!isLoading && workspaces.length > 0 && (
            <>
              {/* Aggregate stats */}
              <AggregateStats workspaces={workspaces} />

              {/* Workspace table */}
              <SectionCard>
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="w-4 h-4 text-teal-400" />
                  <h3 className="text-sm font-semibold text-zinc-100">All workspaces</h3>
                  <span className="text-xs text-zinc-500 ml-auto">
                    {workspaces.length} {workspaces.length === 1 ? 'workspace' : 'workspaces'}
                  </span>
                </div>

                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-left min-w-[640px]">
                    <thead>
                      <tr className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                        <th className="pb-2 px-4">Workspace</th>
                        <th className="pb-2 px-4">Win rate</th>
                        <th className="pb-2 px-4">Trend</th>
                        <th className="pb-2 px-4">Active</th>
                        <th className="pb-2 px-4">Scored (30d)</th>
                        <th className="pb-2 px-4">Top win</th>
                        <th className="pb-2 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspaces
                        .sort((a, b) => {
                          // Attention-needed first, then by win rate descending
                          if (a.attentionNeeded !== b.attentionNeeded) {
                            return a.attentionNeeded ? -1 : 1;
                          }
                          return b.winRate - a.winRate;
                        })
                        .map(ws => (
                          <WorkspaceRow key={ws.workspaceId} ws={ws} />
                        ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </>
          )}
        </div>
      </ErrorBoundary>
    </FeatureFlag>
  );
}
