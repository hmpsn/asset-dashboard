import { ArrowUpRight } from 'lucide-react';
import { Badge, ClickableRow, Icon, SectionCard } from '../ui';
import { adminPath } from '../../routes';
import type { RankingDistributionProps } from './types';

export function RankingDistribution({
  filteredPageMap,
  ranked,
  top3,
  top10,
  top20,
  beyond20,
  notRankingCount,
  intentCounts,
  workspaceId,
  navigate,
}: RankingDistributionProps) {
  if (ranked.length === 0) return null;

  // Striking distance (positions 11–20) is the one band with a real Hub filter destination.
  const showStrikingLink = !!(workspaceId && navigate);

  return (
    <SectionCard
      title="Ranking Distribution"
      titleExtra={<span className="t-caption-sm text-[var(--brand-text-muted)] ml-2">{ranked.length} of {filteredPageMap.length} pages with ranking data</span>}
    >
      <div className="flex h-4 rounded-[var(--radius-pill)] overflow-hidden bg-[var(--surface-3)]">
        {top3.length > 0 && <div className="bg-emerald-500 h-full transition-all" style={{ width: `${(top3.length / filteredPageMap.length) * 100}%` }} />}
        {top10.length > 0 && <div className="bg-teal-500 h-full transition-all" style={{ width: `${(top10.length / filteredPageMap.length) * 100}%` }} />}
        {top20.length > 0 && <div className="bg-amber-500 h-full transition-all" style={{ width: `${(top20.length / filteredPageMap.length) * 100}%` }} />}
        {beyond20.length > 0 && <div className="bg-red-500/60 h-full transition-all" style={{ width: `${(beyond20.length / filteredPageMap.length) * 100}%` }} />}
        {notRankingCount > 0 && <div className="bg-[var(--surface-3)] h-full transition-all" style={{ width: `${(notRankingCount / filteredPageMap.length) * 100}%` }} />}
      </div>
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        <div className="flex items-center gap-1.5 t-caption-sm"><div className="w-2.5 h-2.5 rounded-[var(--radius-pill)] bg-emerald-500" /> <span className="text-accent-success font-medium">{top3.length}</span> <span className="text-[var(--brand-text-muted)]">Top 3</span></div>
        <div className="flex items-center gap-1.5 t-caption-sm"><div className="w-2.5 h-2.5 rounded-[var(--radius-pill)] bg-teal-500" /> <span className="text-accent-brand font-medium">{top10.length}</span> <span className="text-[var(--brand-text-muted)]">4–10</span></div>
        {showStrikingLink ? (
          <ClickableRow
            onClick={() => navigate!(adminPath(workspaceId!, 'seo-keywords') + '?tab=striking_distance')}
            title="Review striking-distance keywords in the Keyword Hub"
            // inline-flex + w-auto override ClickableRow's base w-full so the chip stays an inline legend item.
            className="inline-flex w-auto items-center gap-1.5 t-caption-sm rounded-[var(--radius-lg)] px-1 -mx-1 hover:bg-[var(--surface-3)]/50 hover:text-accent-brand transition-colors"
          >
            <div className="w-2.5 h-2.5 rounded-[var(--radius-pill)] bg-amber-500" /> <span className="text-accent-warning font-medium">{top20.length}</span> <span className="text-[var(--brand-text-muted)]">11–20</span>
            <Icon as={ArrowUpRight} size="sm" className="text-[var(--brand-text-muted)]" />
          </ClickableRow>
        ) : (
          <div className="flex items-center gap-1.5 t-caption-sm"><div className="w-2.5 h-2.5 rounded-[var(--radius-pill)] bg-amber-500" /> <span className="text-accent-warning font-medium">{top20.length}</span> <span className="text-[var(--brand-text-muted)]">11–20</span></div>
        )}
        <div className="flex items-center gap-1.5 t-caption-sm"><div className="w-2.5 h-2.5 rounded-[var(--radius-pill)] bg-red-500/60" /> <span className="text-accent-danger font-medium">{beyond20.length}</span> <span className="text-[var(--brand-text-muted)]">20+</span></div>
        <div className="flex items-center gap-1.5 t-caption-sm"><div className="w-2.5 h-2.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)]" /> <span className="text-[var(--brand-text-muted)] font-medium">{notRankingCount}</span> <span className="text-[var(--brand-text-muted)]">Not ranking</span></div>
      </div>
      {Object.keys(intentCounts).length > 1 && (
        <div className="mt-3 pt-3 border-t border-[var(--brand-border)]">
          <div className="t-caption-sm text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">Search Intent Mix</div>
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(intentCounts).sort((a, b) => b[1] - a[1]).map(([intent, count]) => (
              <Badge
                key={intent}
                label={`${intent} (${count})`}
                tone={intent === 'commercial' ? 'blue' : intent === 'informational' ? 'emerald' : intent === 'transactional' ? 'amber' : intent === 'navigational' ? 'teal' : 'zinc'}
                variant="outline"
                shape="pill"
              />
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
