/**
 * AdminRecommendationQueue — full admin recommendations surface.
 *
 * Replaces the borrowed InsightsEngine client component that was mounted with
 * tier="premium" hardcoded in WorkspaceHome. This surface:
 *
 *  - Shows the full queue (all statuses including dismissed)
 *  - Has an "Active" tab (pending + in_progress + completed) and a "Dismissed" tab
 *  - Shows the full OV breakdown per rec (including emvPerWeek — admin-only data)
 *  - Provides an "Un-dismiss" action on the Dismissed tab
 *  - Uses React Query (useAdminRecommendationSet) — no hand-rolled state+fetch
 *  - Invalidates cache via useWorkspaceEvents via the centralised wsInvalidation
 *    registry (RECOMMENDATIONS_UPDATED already invalidates admin.recommendations)
 *
 * The per-rec row + OV breakdown are shared with the Strategy Decision Queue via
 * src/components/admin/recommendations/RecommendationRow.
 */
import { useState } from 'react';
import {
  CheckCircle,
  Clock,
  AlertTriangle,
  Layers,
  TrendingUp,
} from 'lucide-react';
import {
  SectionCard,
  EmptyState,
  Skeleton,
  TabBar,
  Icon,
} from '../ui/index.js';
import { useAdminRecommendationSet, useAdminUndismissRecommendation } from '../../hooks/admin/useAdminRecommendations.js';
import { RecommendationRow, PRIORITY_ORDER, PRIORITY_LABELS } from './recommendations/RecommendationRow.js';
import type { Recommendation } from '../../../shared/types/recommendations.js';

interface Props {
  workspaceId: string;
}

type ViewTab = 'active' | 'dismissed';

export function AdminRecommendationQueue({ workspaceId }: Props) {
  const [tab, setTab] = useState<ViewTab>('active');
  const { data: set, isLoading } = useAdminRecommendationSet(workspaceId);
  const undismissMutation = useAdminUndismissRecommendation(workspaceId);

  const allRecs = set?.recommendations ?? [];
  const activeRecs = allRecs.filter(r => r.status !== 'dismissed');
  const dismissedRecs = allRecs.filter(r => r.status === 'dismissed');

  // Group active recs by priority for the Active tab
  const groupedActive = new Map<Recommendation['priority'], Recommendation[]>();
  for (const priority of PRIORITY_ORDER) {
    const recs = activeRecs
      .filter(r => r.priority === priority)
      .sort((a, b) => (b.opportunity?.value ?? b.impactScore) - (a.opportunity?.value ?? a.impactScore));
    if (recs.length > 0) groupedActive.set(priority, recs);
  }

  const titleIcon = <Icon as={TrendingUp} size="md" className="text-accent-brand" />;
  const title = set
    ? `Recommendations (${activeRecs.filter(r => r.status === 'pending' || r.status === 'in_progress').length} active)`
    : 'Recommendations';

  if (isLoading) {
    return (
      <SectionCard title="Recommendations" titleIcon={titleIcon}>
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={title} titleIcon={titleIcon} noPadding>
      <div className="px-4 pt-3">
        {/* tab-deeplink-ok: embedded inside WorkspaceHome, not a route target — no URL deep-link support needed */}
        <TabBar
          tabs={[
            { id: 'active', label: `Active (${activeRecs.length})` },
            { id: 'dismissed', label: `Dismissed (${dismissedRecs.length})` },
          ]}
          active={tab}
          onChange={(id) => setTab(id as ViewTab)}
        />
      </div>

      <div className="p-4 space-y-4">
        {tab === 'active' && (
          <>
            {groupedActive.size === 0 ? (
              <EmptyState
                icon={CheckCircle}
                title="No active recommendations"
                description="All recommendations are completed or dismissed. Regenerate after the next audit for fresh priorities."
              />
            ) : (
              Array.from(groupedActive.entries()).map(([priority, recs]) => (
                <div key={priority}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Icon
                      as={priority === 'fix_now' ? AlertTriangle : priority === 'fix_soon' ? Clock : Layers}
                      size="sm"
                      className={
                        priority === 'fix_now' ? 'text-red-400' :
                        priority === 'fix_soon' ? 'text-amber-400' :
                        'text-[var(--brand-text-muted)]'
                      }
                    />
                    <span className="t-caption-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wide">
                      {PRIORITY_LABELS[priority]} ({recs.length})
                    </span>
                  </div>
                  <div className="space-y-2">
                    {recs.map(rec => (
                      <RecommendationRow key={rec.id} rec={rec} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {tab === 'dismissed' && (
          <>
            {dismissedRecs.length === 0 ? (
              <EmptyState
                icon={CheckCircle}
                title="No dismissed recommendations"
                description="Recommendations your client has dismissed will appear here. You can un-dismiss any to return them to the active queue."
              />
            ) : (
              <div className="space-y-2">
                {dismissedRecs
                  .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                  .map(rec => (
                    <RecommendationRow
                      key={rec.id}
                      rec={rec}
                      showUndismiss
                      onUndismiss={(recId) => undismissMutation.mutate(recId)}
                    />
                  ))}
              </div>
            )}
          </>
        )}

        {/* Summary footer */}
        {set && activeRecs.length > 0 && (
          <div className="pt-2 border-t border-[var(--brand-border)]/40 flex gap-4 flex-wrap">
            {set.summary.trafficAtRisk > 0 && (
              <div className="flex items-center gap-1.5">
                <Icon as={AlertTriangle} size="sm" className="text-amber-400" />
                <span className="t-caption text-[var(--brand-text-muted)]">
                  <span className="font-medium text-[var(--brand-text)]">
                    {set.summary.trafficAtRisk.toLocaleString()}
                  </span> clicks at risk
                </span>
              </div>
            )}
            {(set.summary.estimatedRecoverableClicks ?? 0) > 0 && (
              <div className="flex items-center gap-1.5">
                <Icon as={TrendingUp} size="sm" className="text-emerald-400" />
                <span className="t-caption text-[var(--brand-text-muted)]">
                  <span className="font-medium text-emerald-400">
                    ~{(set.summary.estimatedRecoverableClicks ?? 0).toLocaleString()}
                  </span> clicks recoverable
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
