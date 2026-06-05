import { TrendingUp } from 'lucide-react'; // trend-icon-ok — title/empty-state icon is decorative context, not a metric trend badge.
import { useNavigate } from 'react-router-dom';
import { SectionCard, EmptyState, Icon, TrendBadge, Button } from '../ui';
import { adminPath } from '../../routes';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';

interface RankEntry {
  query: string;
  position: number;
  previousPosition?: number;
  change?: number;
}

interface RankingsSnapshotProps {
  ranks: RankEntry[];
  gscPropertyUrl?: string;
  workspaceId: string;
  className?: string;
}

export function RankingsSnapshot({ ranks, gscPropertyUrl, workspaceId, className }: RankingsSnapshotProps) {
  const navigate = useNavigate();
  // Wave 4 P4: the standalone Rank Tracker folds into the Keyword Hub when ON;
  // route to seo-keywords (with the tracked segment) instead of seo-ranks.
  // Flag-OFF byte-identical: still navigates to seo-ranks.
  const keywordHubEnabled = useFeatureFlag('keyword-hub');
  const ranksTab = keywordHubEnabled ? 'seo-keywords' : 'seo-ranks';
  return (
    <SectionCard
      title="Top Rankings"
      titleIcon={<Icon as={TrendingUp} size="md" className="text-teal-400" />}
      action={ranks.length > 0 ? (
        <Button
          variant="link"
          size="sm"
          onClick={() => navigate(adminPath(workspaceId, ranksTab))}
          className="no-underline text-teal-400 hover:text-teal-300"
        >
          View All →
        </Button>
      ) : undefined}
      className={className}
      noPadding
    >
      {ranks.length > 0 ? (
        <div className="divide-y divide-[var(--brand-border)]">
          {ranks.slice(0, 6).map((r, i) => (
            <div key={i} className="flex items-center gap-2.5 px-4 py-2">
              <span className="t-caption-sm text-[var(--brand-text-muted)] truncate flex-1">{r.query}</span>
              <span className="t-caption-sm font-medium text-[var(--brand-text-bright)] tabular-nums w-6 text-right">{Math.round(r.position)}</span>
              {r.change != null ? (
                <TrendBadge
                  value={Math.round(r.change)}
                  suffix=""
                  hideOnZero={false}
                  className="t-caption-sm w-8 justify-end"
                />
              ) : (
                <TrendBadge value={0} hideOnZero={false} iconOnly className="t-caption-sm w-8 justify-end" />
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={TrendingUp} title={gscPropertyUrl ? 'No keywords tracked yet' : 'Connect GSC to track rankings'} className="py-8" />
      )}
    </SectionCard>
  );
}
