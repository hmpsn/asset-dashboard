// src/components/client/WeCalledIt.tsx
// "We recommended X. It was implemented. Here's what happened."
// Surfaces confirmed wins where a recommendation was acted on and produced a result.

import { TrendingUp, TrendingDown, Minus, Sparkles, Lightbulb, ArrowUpRight } from 'lucide-react';
import { SectionCard, EmptyState, Skeleton } from '../ui';
import { FeatureFlag } from '../ui/FeatureFlag';
import { TierGate } from '../ui/TierGate';
import { useClientOutcomeWins } from '../../hooks/client/useClientOutcomes';
import type { Tier } from '../ui/TierGate';
import type { OutcomeWinEntry, DeltaSummary, DeltaDirection } from '../../../shared/types/outcome-tracking';

// --- Helpers -----------------------------------------------------------

function deltaDirectionIcon(direction: DeltaDirection) {
  if (direction === 'improved') return <TrendingUp className="w-4 h-4 text-green-400 flex-shrink-0" />;
  if (direction === 'declined') return <TrendingDown className="w-4 h-4 text-red-400 flex-shrink-0" />;
  return <Minus className="w-4 h-4 text-zinc-400 flex-shrink-0" />;
}

function deltaColor(direction: DeltaDirection): string {
  if (direction === 'improved') return 'text-green-400';
  if (direction === 'declined') return 'text-red-400';
  return 'text-zinc-400';
}

function formatDelta(delta: DeltaSummary): string {
  const sign = delta.delta_absolute >= 0 ? '+' : '';
  const pctSign = delta.delta_percent >= 0 ? '+' : '';
  return `${sign}${delta.delta_absolute.toFixed(1)} (${pctSign}${delta.delta_percent.toFixed(1)}%)`;
}

function formatMonth(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Groups entries by calendar month of detectedAt
function groupByMonth(entries: OutcomeWinEntry[]): Map<string, OutcomeWinEntry[]> {
  const groups = new Map<string, OutcomeWinEntry[]>();
  for (const entry of entries) {
    const key = formatMonth(entry.detectedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }
  return groups;
}

// --- Win card ----------------------------------------------------------

function WinCard({ entry }: { entry: OutcomeWinEntry }) {
  const pageLabel = entry.targetKeyword
    ? `"${entry.targetKeyword}"`
    : entry.pageUrl
      ? entry.pageUrl.replace(/^https?:\/\/[^/]+/, '') || '/'
      : 'your site';

  return (
    <div className="border border-green-500/20 bg-green-500/5 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Lightbulb className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100 leading-snug">{entry.recommendation}</p>
          <p className="text-xs text-zinc-500 mt-0.5 truncate">For {pageLabel}</p>
        </div>
      </div>

      {/* Result */}
      <div className="flex items-center gap-2">
        {deltaDirectionIcon(entry.delta.direction)}
        <div className="text-sm">
          <span className="text-zinc-400">{entry.delta.primary_metric}: </span>
          <span className={`font-semibold ${deltaColor(entry.delta.direction)}`}>
            {formatDelta(entry.delta)}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-1 text-xs text-zinc-500">
        <ArrowUpRight className="w-3 h-3" />
        <span>Confirmed {new Date(entry.detectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span>
      </div>
    </div>
  );
}

// --- Tiered views ------------------------------------------------------

/** Growth: top 1 win per month */
function GrowthWins({ wins }: { wins: OutcomeWinEntry[] }) {
  const byMonth = groupByMonth(wins);
  const topPerMonth: OutcomeWinEntry[] = [];

  for (const [, entries] of byMonth) {
    // Pick the win with the highest positive delta percent
    const best = entries
      .filter(e => e.delta.direction === 'improved')
      .sort((a, b) => b.delta.delta_percent - a.delta.delta_percent)[0];
    if (best) topPerMonth.push(best);
  }

  if (topPerMonth.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Wins are building"
        description="Your first confirmed win will appear here once we've measured enough data to prove the impact."
      />
    );
  }

  return (
    <div className="space-y-3">
      {topPerMonth.map(entry => (
        <div key={entry.actionId}>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-2">
            {formatMonth(entry.detectedAt)}
          </p>
          <WinCard entry={entry} />
        </div>
      ))}
    </div>
  );
}

/** Premium: all wins grouped by month */
function PremiumWins({ wins }: { wins: OutcomeWinEntry[] }) {
  const byMonth = groupByMonth(wins);

  if (wins.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Wins are building"
        description="Your first confirmed win will appear here once we've measured enough data to prove the impact."
      />
    );
  }

  return (
    <div className="space-y-6">
      {Array.from(byMonth.entries()).map(([month, entries]) => {
        const improvedEntries = entries
          .filter(e => e.delta.direction === 'improved')
          .sort((a, b) => b.delta.delta_percent - a.delta.delta_percent);
        if (improvedEntries.length === 0) return null;
        return (
          <div key={month} className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">{month}</p>
            {improvedEntries.map(entry => (
              <WinCard key={entry.actionId} entry={entry} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// --- Main component ----------------------------------------------------

interface WeCalledItProps {
  workspaceId: string;
  tier: Tier;
}

export default function WeCalledIt({ workspaceId, tier }: WeCalledItProps) {
  const { data: wins = [], isLoading } = useClientOutcomeWins(workspaceId);

  return (
    <FeatureFlag flag="outcome-client-reporting">
      <SectionCard>
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-4 h-4 text-teal-400" />
          <h3 className="text-sm font-semibold text-zinc-100">We called it</h3>
          <span className="text-xs text-zinc-500 ml-1">— recommended, implemented, proven</span>
        </div>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {!isLoading && (
          <>
            {tier === 'free' && (
              <TierGate
                tier={tier}
                required="growth"
                feature="Proven wins feed"
                teaser="See every recommendation that was implemented and the results it produced."
              >
                {/* Blurred preview rendered by TierGate */}
                <GrowthWins wins={wins.slice(0, 2)} />
              </TierGate>
            )}

            {tier === 'growth' && (
              <div className="space-y-4">
                <GrowthWins wins={wins} />
                {wins.length > 1 && (
                  <TierGate
                    tier={tier}
                    required="premium"
                    feature="Full wins history"
                    teaser="Unlock every confirmed win across all months, not just the top result."
                    compact
                  >
                    <></>
                  </TierGate>
                )}
              </div>
            )}

            {tier === 'premium' && <PremiumWins wins={wins} />}
          </>
        )}
      </SectionCard>
    </FeatureFlag>
  );
}
