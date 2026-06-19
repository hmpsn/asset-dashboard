/**
 * DecisionQueue — the "do this next" lead of the Strategy Decide band.
 *
 * Surfaces the platform's already-computed prioritized recommendations (the #1 plus the
 * fix-now / fix-soon buckets) with one-click Fix CTAs. Admin-only: uses the admin
 * recommendation route (full OpportunityScore incl. emvPerWeek) and renders the shared
 * RecommendationRow. Rendered only in the decision-bands layout (flag on).
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target } from 'lucide-react';
import { SectionCard, EmptyState, Skeleton, Icon } from '../ui';
import { useAdminRecommendationSet } from '../../hooks/admin/useAdminRecommendations';
import { RecommendationRow } from '../admin/recommendations/RecommendationRow';
import { buildRecFixContext } from '../../lib/recTypeTab';
import { adminPath } from '../../routes';
import type { Recommendation } from '../../../shared/types/recommendations';
import type { DecisionQueueProps } from './types';

const byOpportunity = (a: Recommendation, b: Recommendation) =>
  (b.opportunity?.value ?? b.impactScore) - (a.opportunity?.value ?? a.impactScore);

export function DecisionQueue({ workspaceId }: DecisionQueueProps) {
  const navigate = useNavigate();
  const { data: set, isLoading } = useAdminRecommendationSet(workspaceId);

  const onFix = useCallback((rec: Recommendation) => {
    const { tab, fixContext } = buildRecFixContext(rec);
    navigate(adminPath(workspaceId, tab), { state: { fixContext } });
  }, [navigate, workspaceId]);

  const titleIcon = <Icon as={Target} size="md" className="text-accent-brand" />;

  if (isLoading) {
    return (
      <SectionCard title="Do this next" titleIcon={titleIcon}>
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
        </div>
      </SectionCard>
    );
  }

  // Active = not dismissed AND not completed — matches the server's computeRecommendationSummary
  // contract. (Completing a rec sets status but leaves priority fix_now/fix_soon, so a
  // status-only filter would surface a done item with a live Fix CTA.)
  const active = (set?.recommendations ?? []).filter(r => r.status !== 'dismissed' && r.status !== 'completed'); // incomplete-rec-filter-ok — pre-v3-lifecycle component; cut in P4 cleanup
  const topRec = set?.summary.topRecommendationId
    ? active.find(r => r.id === set.summary.topRecommendationId)
    : undefined;
  const urgent = active
    .filter(r => r.priority === 'fix_now' || r.priority === 'fix_soon')
    .sort(byOpportunity);

  // Lead with the #1 recommendation, then the fix-now / fix-soon queue (deduped).
  const seen = new Set<string>();
  const ordered: Recommendation[] = [];
  for (const rec of [...(topRec ? [topRec] : []), ...urgent]) {
    if (!seen.has(rec.id)) { seen.add(rec.id); ordered.push(rec); }
  }

  return (
    <SectionCard title="Do this next" titleIcon={titleIcon}>
      {ordered.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No urgent actions"
          description="Your strategy is on track — no fix-now or fix-soon recommendations right now."
        />
      ) : (
        <div className="space-y-2">
          {ordered.map(rec => (
            <RecommendationRow key={rec.id} rec={rec} onFixCta={onFix} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
