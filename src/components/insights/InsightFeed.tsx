import { useState } from 'react';
import type { FeedInsight, SummaryCount } from '../../../shared/types/insights.js';
import { INSIGHT_FILTER_KEYS, type InsightDomain } from '../../../shared/types/analytics.js';
import { InsightFeedItem } from './InsightFeedItem.js';
import { InsightSkeleton } from './InsightSkeleton.js';
import { SummaryPills } from './SummaryPills.js';
import { Button } from '../ui';

interface InsightFeedProps {
  feed: FeedInsight[];
  summary?: SummaryCount[];
  loading?: boolean;
  domain?: InsightDomain;
  limit?: number;
  showPills?: boolean;
  showFilterChips?: boolean;
  onViewAll?: () => void;
  workspaceId?: string;
}

const FILTER_CHIPS = [
  { key: null, label: 'All' },
  { key: INSIGHT_FILTER_KEYS.DROPS, label: 'Drops' },
  { key: INSIGHT_FILTER_KEYS.OPPORTUNITIES, label: 'Opportunities' },
  { key: INSIGHT_FILTER_KEYS.WINS, label: 'Wins' },
] as const;

export function InsightFeed({ feed, summary, loading, domain, limit, showPills, showFilterChips, onViewAll, workspaceId }: InsightFeedProps) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  let filtered = domain ? feed.filter(f => f.domain === domain || f.domain === 'cross') : feed;

  if (activeFilter) {
    filtered = filtered.filter(f => {
      if (activeFilter === INSIGHT_FILTER_KEYS.DROPS) return f.severity === 'critical' || f.severity === 'warning';
      if (activeFilter === INSIGHT_FILTER_KEYS.OPPORTUNITIES) return f.severity === 'opportunity';
      if (activeFilter === INSIGHT_FILTER_KEYS.WINS) return f.severity === 'positive';
      if (activeFilter === INSIGHT_FILTER_KEYS.SCHEMA) return f.type === 'serp_opportunity';
      if (activeFilter === INSIGHT_FILTER_KEYS.DECAY) return f.type === 'content_decay';
      return true;
    });
  }

  const totalFiltered = filtered.length;
  const effectiveLimit = expanded ? undefined : limit;
  const displayed = effectiveLimit ? filtered.slice(0, effectiveLimit) : filtered;
  const hasMore = limit && !expanded && totalFiltered > limit;

  return (
    <div className="space-y-3">
      {showPills && summary && (
        <SummaryPills counts={summary} activeFilter={activeFilter} onFilter={setActiveFilter} loading={loading} />
      )}
      {showFilterChips && (
        <div className="flex gap-1.5">
          {FILTER_CHIPS.map(chip => (
            <Button
              key={chip.key ?? 'all'}
              onClick={() => setActiveFilter(chip.key)}
              variant="ghost"
              size="sm"
              className={`px-3 py-1 rounded-[var(--radius-md)] t-caption-sm font-medium transition-colors ${
                activeFilter === chip.key ? 'bg-teal-600 text-white' : 'bg-[var(--surface-3)]/50 text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]'
              }`}
            >
              {chip.label}
            </Button>
          ))}
        </div>
      )}
      {loading ? (
        <InsightSkeleton count={limit ?? 5} />
      ) : displayed.length > 0 ? (
        <div className="space-y-1.5">
          {displayed.map(item => (
            <InsightFeedItem key={item.id} insight={item} workspaceId={workspaceId} />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-xs text-[var(--brand-text-muted)]">
          {activeFilter ? 'No insights match this filter' : 'No insights available yet — check back after analytics sync'}
        </div>
      )}
      {onViewAll && totalFiltered > (limit ?? Infinity) && !expanded && (
        <div className="text-center pt-1">
          <Button onClick={onViewAll} variant="ghost" size="sm" className="t-caption-sm text-teal-400 hover:text-teal-300 transition-colors !px-0 !py-0">
            View all {totalFiltered} insights →
          </Button>
        </div>
      )}
      {!onViewAll && hasMore && (
        <div className="text-center pt-1">
          <Button onClick={() => setExpanded(true)} variant="ghost" size="sm" className="t-caption-sm text-teal-400 hover:text-teal-300 transition-colors !px-0 !py-0">
            Show all {totalFiltered} insights →
          </Button>
        </div>
      )}
      {expanded && limit && totalFiltered > limit && (
        <div className="text-center pt-1">
          <Button onClick={() => setExpanded(false)} variant="ghost" size="sm" className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors !px-0 !py-0">
            Show less
          </Button>
        </div>
      )}
    </div>
  );
}
