import { Fragment } from 'react';
import { Badge, Icon, IconButton, InlineBanner } from '../ui';
import { ArrowUpRight, Eye, Users, Loader2, Check, Plus, FileText } from 'lucide-react';
import { adminPath } from '../../routes';
import { buildHubDeepLinkQuery } from '../../lib/keywordHubDeepLink';
import { keywordTrackingKey } from '../../lib/keywordTracking';

interface KeywordGapItem {
  keyword: string;
  volume: number;
  difficulty: number;
  competitorPosition: number;
  competitorDomain: string;
}

export interface KeywordGapsProps {
  keywordGaps: KeywordGapItem[];
  difficultyColor: (kd?: number) => string;
  /** When workspaceId + navigate are provided, each row gets a "View in Hub" link. */
  workspaceId?: string;
  navigate?: (path: string) => void;
  /**
   * Inline keyword-tracking (the Reference-band "Competitor evidence" surface, Phase 4b). When `onTrack`
   * is provided, each row gets a Track button. Omitted in the legacy layout → no Track button, byte-identical.
   */
  trackedKeywords?: Set<string>;
  trackingPending?: Set<string>;
  trackingErrors?: Map<string, string>;
  onTrack?: (kw: string) => void;
  /**
   * Create-brief affordance (Strategy v2 Competitive tab, Phase 5). When `onCreateBrief` is provided,
   * each row gets a "Create brief" button that turns a competitor-gap keyword into a content brief.
   * Omitted in the legacy/Overview layout → no button, byte-identical.
   */
  onCreateBrief?: (keyword: string) => void;
}

export function KeywordGaps({
  keywordGaps,
  difficultyColor,
  workspaceId,
  navigate,
  trackedKeywords,
  trackingPending,
  trackingErrors,
  onTrack,
  onCreateBrief,
}: KeywordGapsProps) {
  if (keywordGaps.length === 0) return null;

  const showHubLink = !!(workspaceId && navigate);
  const showTrack = !!onTrack;
  const showCreateBrief = !!onCreateBrief;

  return (
    <div className="bg-[var(--surface-2)] border border-orange-500/20 p-5 rounded-[var(--radius-signature)]">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h4 className="t-caption-sm font-semibold text-orange-300 flex items-center gap-1.5">
          <Icon as={Users} size="md" className="text-orange-300" /> Raw Competitor Evidence
        </h4>
        <Badge tone="orange" size="sm" label="Evidence only" icon={Eye} />
      </div>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">
        Provider terms competitors rank for. These stay visible for auditability, but selected strategy actions are filtered separately.
      </p>
      <div className="space-y-1">
        {keywordGaps.map((gap, i) => {
          const tkey = showTrack ? keywordTrackingKey(gap.keyword) : '';
          const tracked = showTrack && !!trackedKeywords?.has(tkey);
          const isPendingTrack = showTrack && !!trackingPending?.has(tkey);
          const trackError = showTrack ? trackingErrors?.get(tkey) : undefined;
          return (
            <Fragment key={i}>
              <div className="flex items-center justify-between px-2.5 py-1.5 bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)]">
                <span className="t-caption-sm text-[var(--brand-text-bright)]">{gap.keyword}</span>
                <div className="flex items-center gap-2">
                  <span className="t-mono text-[var(--brand-text-muted)]">{gap.volume.toLocaleString()}/mo</span>
                  <span className={`t-mono ${difficultyColor(gap.difficulty)}`}>KD {gap.difficulty}%</span>
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">{gap.competitorDomain} #{gap.competitorPosition}</span>
                  {showTrack && (
                    <IconButton
                      onClick={() => onTrack!(gap.keyword)}
                      title={isPendingTrack ? 'Adding...' : tracked ? 'Tracking' : 'Track'}
                      label={isPendingTrack ? 'Adding...' : tracked ? 'Tracking' : 'Track'}
                      icon={isPendingTrack ? Loader2 : tracked ? Check : Plus}
                      size="sm"
                      variant="ghost"
                      disabled={isPendingTrack}
                      className={isPendingTrack ? 'animate-spin text-[var(--brand-text-muted)]' : tracked ? 'text-accent-success' : 'text-[var(--brand-text-muted)] hover:text-accent-brand'}
                    />
                  )}
                  {showHubLink && (
                    <IconButton
                      onClick={() => navigate!(adminPath(workspaceId!, 'seo-keywords') + buildHubDeepLinkQuery({ keyword: gap.keyword }))}
                      title="View in Hub"
                      label="View in Hub"
                      icon={ArrowUpRight}
                      size="sm"
                      variant="ghost"
                      className="text-[var(--brand-text-muted)] hover:text-accent-brand"
                    />
                  )}
                  {showCreateBrief && (
                    <IconButton
                      onClick={() => onCreateBrief!(gap.keyword)}
                      title="Create brief"
                      label="Create brief"
                      icon={FileText}
                      size="sm"
                      variant="ghost"
                      className="text-[var(--brand-text-muted)] hover:text-accent-brand"
                    />
                  )}
                </div>
              </div>
              {showTrack && trackError && (
                <InlineBanner size="sm" icon={false}>{trackError}</InlineBanner>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
