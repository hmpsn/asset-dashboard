import { useNavigate } from 'react-router-dom';
import { Target, Loader2, Check, Plus, ArrowUpRight } from 'lucide-react';
import { Badge, Button, SectionCard, Icon, IconButton, InlineBanner } from '../ui';
import { kdColor } from '../page-intelligence/pageIntelligenceDisplay';
import { keywordTrackingKey } from '../../lib/keywordTracking';
import { buildHubDeepLinkQuery } from '../../lib/keywordHubDeepLink';
import { adminPath } from '../../routes';
import { useShowMore } from '../../hooks/useShowMore';
import type { SiteTargetKeywordsProps } from './types';

export function SiteTargetKeywords({
  workspaceId,
  siteKeywords,
  siteKeywordMetrics,
  trackedKeywords,
  trackingPending,
  trackingErrors,
  onTrack,
  maxVisible,
}: SiteTargetKeywordsProps) {
  const navigate = useNavigate();
  const { visible, hiddenCount, expanded, toggle, canExpand } = useShowMore(siteKeywords, maxVisible);

  return (
    <SectionCard
      title="Site Target Keywords"
      titleIcon={<Icon as={Target} size="md" className="text-accent-brand" />}
    >
      <div className="space-y-1">
        {visible.map((kw: string, i: number) => {
          const key = keywordTrackingKey(kw);
          const metrics = siteKeywordMetrics?.find((m: { keyword: string; volume: number; difficulty: number }) => keywordTrackingKey(m.keyword) === key);
          const tracked = trackedKeywords.has(key);
          const isPendingTrack = trackingPending.has(key);
          const trackError = trackingErrors.get(key);
          return (
            <div key={i} className="flex flex-col gap-0.5">
              <div className="inline-flex items-center gap-1.5 t-caption-sm text-accent-brand">
                <Badge label={kw} tone="teal" />
                {metrics && (metrics.volume > 0 || metrics.difficulty > 0) && (
                  <>
                    {metrics.volume > 0 && <span className="t-caption-sm text-[var(--brand-text-muted)] font-mono">{metrics.volume.toLocaleString()}/mo</span>}
                    {metrics.difficulty > 0 && <span className={`t-caption-sm font-mono ${kdColor(metrics.difficulty)}`}>KD {metrics.difficulty}%</span>}
                  </>
                )}
                <IconButton
                  onClick={() => onTrack(kw)}
                  title={isPendingTrack ? 'Adding...' : tracked ? 'Tracking' : 'Track'}
                  label={isPendingTrack ? 'Adding...' : tracked ? 'Tracking' : 'Track'}
                  icon={isPendingTrack ? Loader2 : tracked ? Check : Plus}
                  size="sm"
                  variant="ghost"
                  disabled={isPendingTrack}
                  className={`ml-0.5 ${isPendingTrack ? 'animate-spin text-[var(--brand-text-muted)]' : tracked ? 'text-accent-success' : 'text-[var(--brand-text-muted)] hover:text-accent-brand'}`}
                />
                <IconButton
                  onClick={() => navigate(adminPath(workspaceId, 'seo-keywords') + buildHubDeepLinkQuery({ keyword: kw }))}
                  title="View in Hub"
                  label="View in Hub"
                  icon={ArrowUpRight}
                  size="sm"
                  variant="ghost"
                  className="ml-0.5 text-[var(--brand-text-muted)] hover:text-accent-brand"
                />
              </div>
              {trackError && (
                <InlineBanner size="sm" icon={false} className="mt-1">
                  {trackError}
                </InlineBanner>
              )}
            </div>
          );
        })}
      </div>
      {canExpand && (
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          aria-expanded={expanded}
          className="mt-3 w-full text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </Button>
      )}
    </SectionCard>
  );
}
