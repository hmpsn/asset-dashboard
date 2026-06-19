import { useNavigate } from 'react-router-dom';
import { Target, Loader2, Check, Plus, ArrowUpRight } from 'lucide-react';
import { Badge, Button, SectionCard, Icon, IconButton, InlineBanner } from '../ui';
import { kdColor } from '../page-intelligence/pageIntelligenceDisplay';
import { keywordTrackingKey } from '../../lib/keywordTracking';
import { buildHubDeepLinkQuery } from '../../lib/keywordHubDeepLink';
import { adminPath } from '../../routes';
import { useShowMore } from '../../hooks/useShowMore';
import type { SiteTargetKeywordsProps } from './types';

/**
 * P3 Lane C — two visual states per keyword row (DISPLAY ONLY; mutation controls are Lane D).
 *
 *  In Set    → teal dot + "In Set" badge  (keyword is in the managed set, removedAt IS NULL)
 *  Candidate → no annotation              (keyword is not in the managed set at all)
 *
 * `managedKeywordSet` is the full ActiveStrategyKeyword[] from useStrategyKeywordSet (Lane D hook).
 * ActiveStrategyKeyword always has removedAt === null, so `'removed'` is not reachable with the
 * current prop type. Lane D widens managedKeywordSet to include removed rows when that state is needed.
 * When absent, the component is byte-identical to its pre-P3 form.
 */
type ManagedState = 'in_set' | 'candidate';

function getManagedState(kw: string, managedKeywordSet: SiteTargetKeywordsProps['managedKeywordSet']): ManagedState {
  if (!managedKeywordSet) return 'candidate';
  // Normalize for comparison: lowercase-trimmed, same as the table's stored keyword.
  const norm = kw.toLowerCase().trim();
  // The set contains ActiveStrategyKeyword (removedAt === null). Full StrategyKeywordSetRow
  // rows with removedAt non-null won't appear here (they're filtered out by the hook).
  // To display "Removed" state we'd need the full set — but the prop only carries active rows.
  // Per the prop contract (managedKeywordSet?: ActiveStrategyKeyword[]) we only know "in set"
  // vs "not in active set". "Removed" state requires Lane D to pass a wider dataset;
  // for now: in_set if present, candidate otherwise. Lane D can extend the prop later.
  const found = managedKeywordSet.find(row => row.keyword === norm);
  return found ? 'in_set' : 'candidate';
}

export function SiteTargetKeywords({
  workspaceId,
  siteKeywords,
  siteKeywordMetrics,
  trackedKeywords,
  trackingPending,
  trackingErrors,
  onTrack,
  maxVisible,
  managedKeywordSet,
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
          const managedState: ManagedState = getManagedState(kw, managedKeywordSet);

          return (
            <div key={i} className="flex flex-col gap-0.5">
              <div className="inline-flex items-center gap-1.5 t-caption-sm text-accent-brand">
                {/* Managed-set state indicator — DISPLAY ONLY */}
                {managedState === 'in_set' && (
                  <>
                    {/* Teal dot — Four Laws: teal for active/in-set state */}
                    <span
                      className="w-1.5 h-1.5 rounded-[var(--radius-pill)] bg-teal-400 flex-shrink-0"
                      aria-label="In managed set"
                    />
                    <Badge label="In Set" tone="teal" size="sm" variant="soft" />
                  </>
                )}
                {/* Lane D widens managedKeywordSet to include removed rows when 'removed' state is needed */}

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
