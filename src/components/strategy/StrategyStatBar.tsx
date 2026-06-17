import { CompactStatBar, positionColor } from '../ui';
import type { StrategyStatGridProps } from './types';

/**
 * Reference-band-only compact variant of StrategyStatGrid (Phase 4c). Same four metrics, rendered as
 * one horizontal CompactStatBar instead of four hero StatCards (the Reference band is demoted, so the
 * stats are summarized, not hero-sized). Icons are dropped (CompactStatBar has no icon slot). Legacy
 * keeps the hero StrategyStatGrid.
 */
export function StrategyStatBar({ filteredPageMap, totalPageCount, totalImpressions, totalClicks, ranked, avgPos }: StrategyStatGridProps) {
  const ctr = totalImpressions > 0 ? `${((totalClicks / totalImpressions) * 100).toFixed(1)}% CTR` : undefined;
  return (
    <CompactStatBar
      items={[
        {
          label: 'Pages Mapped',
          value: filteredPageMap.length,
          sub: filteredPageMap.length < totalPageCount ? `${totalPageCount - filteredPageMap.length} below threshold` : undefined,
        },
        { label: 'Impressions', value: totalImpressions.toLocaleString(), sub: 'last 90 days' },
        { label: 'Clicks', value: totalClicks.toLocaleString(), sub: ctr },
        {
          label: 'Avg Position',
          value: ranked.length > 0 ? `#${avgPos.toFixed(1)}` : '—',
          valueColor: positionColor(avgPos),
          sub: `${ranked.length} ranking`,
        },
      ]}
    />
  );
}
