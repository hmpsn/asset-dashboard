// src/components/client/OutcomeSummary.tsx
// Outcome scorecard for the client portal — tiered display of win rates and outcomes.

import { TrendingUp, TrendingDown, Minus, BarChart3, CheckCircle2, Clock, Trophy } from 'lucide-react';
import { SectionCard, EmptyState, Skeleton, StatCard } from '../ui';
import { FeatureFlag } from '../ui/FeatureFlag';
import { TierGate } from '../ui/TierGate';
import { useClientOutcomeSummary } from '../../hooks/client/useClientOutcomes';
// scoreColor helpers used locally via winRateColor()
import type { Tier } from '../ui/TierGate';
import type { OutcomeScorecard, ActionType, LearningsTrend } from '../../../shared/types/outcome-tracking';

const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  insight_acted_on: 'Insight applied',
  content_published: 'Content published',
  brief_created: 'Content brief created',
  strategy_keyword_added: 'Keyword added',
  schema_deployed: 'Schema deployed',
  audit_fix_applied: 'Technical fix',
  content_refreshed: 'Content refreshed',
  internal_link_added: 'Internal link added',
  meta_updated: 'Meta update',
  voice_calibrated: 'Voice calibrated',
};

function TrendIcon({ trend }: { trend: LearningsTrend }) {
  if (trend === 'improving') return <TrendingUp className="w-4 h-4 text-green-400" />;
  if (trend === 'declining') return <TrendingDown className="w-4 h-4 text-red-400" />;
  return <Minus className="w-4 h-4 text-zinc-400" />;
}

function winRateColor(rate: number): string {
  if (rate >= 0.6) return 'text-green-400';
  if (rate >= 0.4) return 'text-amber-400';
  return 'text-red-400';
}

function winRateBg(rate: number): string {
  if (rate >= 0.6) return 'bg-green-500/10 border-green-500/20';
  if (rate >= 0.4) return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-red-500/10 border-red-500/20';
}

interface OutcomeSummaryProps {
  workspaceId: string;
  tier: Tier;
}

// --- Free tier: top 3 wins as plain text --------------------------------

function TopThreeWins({ scorecard }: { scorecard: OutcomeScorecard }) {
  const topCategories = [...scorecard.byCategory]
    .filter(c => c.winRate > 0 && c.scored > 0)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 3);

  if (topCategories.length === 0) {
    return (
      <p className="text-sm text-zinc-500 italic">
        Not enough scored results yet — check back after your first recommendations are measured.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {topCategories.map(cat => (
        <li key={cat.actionType} className="flex items-start gap-2 text-sm text-zinc-300">
          <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
          <span>
            <span className="font-medium text-zinc-100">
              {ACTION_TYPE_LABELS[cat.actionType]}
            </span>
            {' '}worked {Math.round(cat.winRate * 100)}% of the time
            {' '}across {cat.scored} measured {cat.scored === 1 ? 'action' : 'actions'}.
          </span>
        </li>
      ))}
    </ul>
  );
}

// --- Growth tier: full scorecard with win rates -------------------------

function FullScorecard({ scorecard }: { scorecard: OutcomeScorecard }) {
  const winPct = Math.round(scorecard.overallWinRate * 100);
  const strongPct = Math.round(scorecard.strongWinRate * 100);

  return (
    <div className="space-y-4">
      {/* Aggregate stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Overall win rate"
          value={`${winPct}%`}
          valueColor={winRateColor(scorecard.overallWinRate)}
        />
        <StatCard
          label="Strong wins"
          value={`${strongPct}%`}
          valueColor={winRateColor(scorecard.strongWinRate)}
        />
        <StatCard
          label="Actions tracked"
          value={scorecard.totalTracked.toString()}
        />
        <StatCard
          label="Pending results"
          value={scorecard.pendingMeasurement.toString()}
          valueColor="text-zinc-400"
        />
      </div>

      {/* Trend indicator */}
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <TrendIcon trend={scorecard.trend} />
        <span>
          {scorecard.trend === 'improving' && 'Your results are trending in the right direction.'}
          {scorecard.trend === 'stable' && 'Results are holding steady.'}
          {scorecard.trend === 'declining' && 'Some metrics need attention — we\'re on it.'}
        </span>
      </div>

      {/* Category breakdown */}
      {scorecard.byCategory.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">By recommendation type</p>
          <div className="space-y-1.5">
            {scorecard.byCategory
              .filter(c => c.scored > 0)
              .sort((a, b) => b.winRate - a.winRate)
              .map(cat => {
                const pct = Math.round(cat.winRate * 100);
                return (
                  <div
                    key={cat.actionType}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${winRateBg(cat.winRate)}`}
                  >
                    <span className="text-zinc-300">{ACTION_TYPE_LABELS[cat.actionType]}</span>
                    <div className="flex items-center gap-3 text-right">
                      <span className={`font-semibold ${winRateColor(cat.winRate)}`}>{pct}%</span>
                      <span className="text-xs text-zinc-500">{cat.scored} scored</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Premium tier: full scorecard + detailed breakdown ------------------

function PremiumBreakdown({ scorecard }: { scorecard: OutcomeScorecard }) {
  const totalWins = scorecard.byCategory.reduce((sum, c) => sum + Math.round(c.winRate * c.scored), 0);
  const totalScored = scorecard.totalScored;

  return (
    <div className="space-y-6">
      <FullScorecard scorecard={scorecard} />

      {/* Detailed breakdown panel */}
      <SectionCard variant="subtle">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Detailed breakdown</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-xs text-zinc-500">Total scored actions</p>
            <p className="text-xl font-semibold text-zinc-100">{totalScored}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-zinc-500">Confirmed wins</p>
            <p className="text-xl font-semibold text-green-400">{totalWins}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-zinc-500">Pending measurement</p>
            <p className="text-xl font-semibold text-zinc-300">{scorecard.pendingMeasurement}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-zinc-500">Strong wins (top score)</p>
            <p className={`text-xl font-semibold ${winRateColor(scorecard.strongWinRate)}`}>
              {Math.round(scorecard.strongWinRate * 100)}%
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// --- Main component -----------------------------------------------------

export default function OutcomeSummary({ workspaceId, tier }: OutcomeSummaryProps) {
  const { data: scorecard, isLoading } = useClientOutcomeSummary(workspaceId);

  return (
    <FeatureFlag flag="outcome-client-reporting">
      <SectionCard>
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="w-4 h-4 text-teal-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Your results</h3>
          <span className="text-xs text-zinc-500 ml-auto flex items-center gap-1">
            <Clock className="w-3 h-3" /> Measured over 90 days
          </span>
        </div>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-8 w-1/2" />
          </div>
        )}

        {!isLoading && !scorecard && (
          <EmptyState
            icon={BarChart3}
            title="Results are on the way"
            description="Once your first recommendations are measured, you'll see your outcomes here. Check back in 7–14 days."
          />
        )}

        {!isLoading && scorecard && (
          <>
            {/* Free: top 3 wins text only */}
            {tier === 'free' && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-400">
                  Here's what's been working for your site so far:
                </p>
                <TopThreeWins scorecard={scorecard} />
                <TierGate
                  tier={tier}
                  required="growth"
                  feature="Full outcome scorecard"
                  teaser="See win rates by recommendation type and track your full results history."
                >
                  {/* blurred preview rendered by TierGate */}
                  <FullScorecard scorecard={scorecard} />
                </TierGate>
              </div>
            )}

            {/* Growth: full scorecard */}
            {tier === 'growth' && (
              <div className="space-y-4">
                <FullScorecard scorecard={scorecard} />
                <TierGate
                  tier={tier}
                  required="premium"
                  feature="Detailed outcome breakdown"
                  teaser="Unlock the full breakdown with confirmed wins, strong-win rate, and category-level metrics."
                  compact
                >
                  {/* compact gate renders inline */}
                  <></>
                </TierGate>
              </div>
            )}

            {/* Premium: full + detailed breakdown */}
            {tier === 'premium' && (
              <PremiumBreakdown scorecard={scorecard} />
            )}
          </>
        )}
      </SectionCard>
    </FeatureFlag>
  );
}
