import { useState } from 'react';
import type { FeedInsight, SummaryCount } from '../../../shared/types/insights.js';
import type { InsightDomain } from '../../../shared/types/analytics.js';
import { InsightFeedItem } from './InsightFeedItem.js';
import { InsightSkeleton } from './InsightSkeleton.js';
import { SummaryPills } from './SummaryPills.js';

interface InsightFeedProps {
  feed: FeedInsight[];
  summary?: SummaryCount[];
  loading?: boolean;
  domain?: InsightDomain;
  limit?: number;
  showPills?: boolean;
  showFilterChips?: boolean;
  onViewAll?: () => void;
}

const FILTER_CHIPS = [
  { key: null, label: 'All' },
  { key: 'drops', label: 'Drops' },
  { key: 'opportunities', label: 'Opportunities' },
  { key: 'wins', label: 'Wins' },
] as const;

export function InsightFeed({ feed, summary, loading, domain, limit, showPills, showFilterChips, onViewAll }: InsightFeedProps) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  let filtered = domain ? feed.filter(f => f.domain === domain || f.domain === 'cross') : feed;

  if (activeFilter) {
    filtered = filtered.filter(f => {
      if (activeFilter === 'drops') return f.severity === 'critical' || f.severity === 'warning';
      if (activeFilter === 'opportunities') return f.severity === 'opportunity';
      if (activeFilter === 'wins') return f.severity === 'positive';
      if (activeFilter === 'schema') return f.type === 'serp_opportunity';
      if (activeFilter === 'decay') return f.type === 'content_decay';
      return true;
    });
  }

  const totalFiltered = filtered.length;
  const displayed = limit ? filtered.slice(0, limit) : filtered;

  return (
    <div className="space-y-3">
      {showPills && summary && (
        <SummaryPills counts={summary} activeFilter={activeFilter} onFilter={setActiveFilter} loading={loading} />
      )}
      {showFilterChips && (
        <div className="flex gap-1.5">
          {FILTER_CHIPS.map(chip => (
            <button
              key={chip.key ?? 'all'}
              onClick={() => setActiveFilter(chip.key)}
              className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                activeFilter === chip.key ? 'bg-teal-600 text-white' : 'bg-zinc-800/50 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
      {loading ? (
        <InsightSkeleton count={limit ?? 5} />
      ) : displayed.length > 0 ? (
        <div className="space-y-1.5">
          {displayed.map(item => (
            <InsightFeedItem key={item.id} insight={item} />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-xs text-zinc-500">
          {activeFilter ? 'No insights match this filter' : 'No insights available yet — check back after analytics sync'}
        </div>
      )}
      {onViewAll && totalFiltered > (limit ?? Infinity) && (
        <div className="text-center pt-1">
          <button onClick={onViewAll} className="text-[11px] text-teal-400 hover:text-teal-300 transition-colors">
            View all {totalFiltered} insights →
          </button>
        </div>
      )}
    </div>
  );
}
