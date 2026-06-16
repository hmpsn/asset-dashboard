import { Eye, MousePointerClick, Trophy } from 'lucide-react';
import { StatCard, positionColor } from '../ui';
import type { StrategyStatGridProps } from './types';

export function StrategyStatGrid({ filteredPageMap, totalPageCount, totalImpressions, totalClicks, ranked, avgPos }: StrategyStatGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard size="hero" label="Pages Mapped" value={filteredPageMap.length} sub={filteredPageMap.length < totalPageCount ? `${totalPageCount - filteredPageMap.length} below threshold` : undefined} />
      <StatCard size="hero" label="Impressions" value={totalImpressions.toLocaleString()} icon={Eye} sub="last 90 days" />
      <StatCard size="hero" label="Clicks" value={totalClicks.toLocaleString()} icon={MousePointerClick} sub={totalImpressions > 0 ? `${((totalClicks / totalImpressions) * 100).toFixed(1)}% CTR` : undefined} />
      <StatCard size="hero" label="Avg Position" value={ranked.length > 0 ? `#${avgPos.toFixed(1)}` : '—'} icon={Trophy} valueColor={positionColor(avgPos)} sub={`${ranked.length} pages ranking`} />
    </div>
  );
}
