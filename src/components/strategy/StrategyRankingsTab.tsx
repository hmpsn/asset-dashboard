import type { NavigateFunction } from 'react-router-dom';
import { ArrowUpRight, BarChart3 } from 'lucide-react';
import { SectionCard, CompactStatBar, ClickableRow, Icon, EmptyState } from '../ui';
import { RankingDistribution } from './RankingDistribution';
import { adminPath } from '../../routes';
import type { StrategyMetrics } from './types';

interface StrategyRankingsTabProps {
  metrics: StrategyMetrics;
  workspaceId: string;
  navigate: NavigateFunction;
}

/**
 * Strategy v2 Rankings tab — a SUMMARY of ranking position + movements that deep-links into the
 * Keyword Hub for the actual tracking (history, alerts, per-keyword management). It deliberately does
 * NOT rebuild the Hub: position distribution + since-last-refresh movements + striking-distance and
 * "open the Hub" deep-links only.
 */
export function StrategyRankingsTab({ metrics, workspaceId, navigate }: StrategyRankingsTabProps) {
  if (metrics.ranked.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No ranking data yet"
        description="Connect Search Console and refresh your strategy to see ranking distribution and movements."
      />
    );
  }

  const m = metrics.movements;
  return (
    <div className="space-y-8">
      <RankingDistribution
        filteredPageMap={metrics.filteredPageMap}
        ranked={metrics.ranked}
        top3={metrics.top3}
        top10={metrics.top10}
        top20={metrics.top20}
        beyond20={metrics.beyond20}
        notRankingCount={metrics.notRankingCount}
        intentCounts={metrics.intentCounts}
        workspaceId={workspaceId}
        navigate={navigate}
      />

      {/* Movements only render when there is REAL movement data. `previousPosition` is not yet
          rotated on write server-side (improved/declined/lost would be 0), so this gate avoids a
          misleading all-zero / all-"New" card until that producer lands (see spawned follow-up). */}
      {(m.improved + m.declined + m.lost) > 0 && (
        <SectionCard
          title="Position movements"
          titleExtra={<span className="t-caption-sm text-[var(--brand-text-muted)] ml-2">since the previous refresh</span>}
        >
          <CompactStatBar
            className="bg-[var(--surface-3)]/40"
            items={[
              { label: 'Improved', value: m.improved, valueColor: 'text-emerald-400' },
              { label: 'Declined', value: m.declined, valueColor: 'text-red-400' },
              { label: 'New', value: m.new, valueColor: 'text-blue-400' },
              { label: 'Lost', value: m.lost, valueColor: 'text-[var(--brand-text-muted)]' },
            ]}
          />
        </SectionCard>
      )}

      <ClickableRow
        onClick={() => navigate(adminPath(workspaceId, 'seo-keywords'))}
        title="Open the Keyword Hub"
        className="flex items-center justify-between gap-2 t-caption text-accent-brand hover:text-teal-300 transition-colors px-1 -mx-1"
      >
        <span>Full keyword tracking, history &amp; alerts live in the Keyword Hub</span>
        <Icon as={ArrowUpRight} size="sm" />
      </ClickableRow>
    </div>
  );
}
