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
 */
import { useState } from 'react';
import {
  CheckCircle,
  Clock,
  AlertTriangle,
  Layers,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import {
  SectionCard,
  EmptyState,
  Skeleton,
  Badge,
  TabBar,
  Icon,
  Button,
  ClickableRow,
} from '../ui/index.js';
import { scoreColorClass } from '../ui/constants.js';
import { useAdminRecommendationSet, useAdminUndismissRecommendation } from '../../hooks/admin/useAdminRecommendations.js';
import type { Recommendation } from '../../../shared/types/recommendations.js';

interface Props {
  workspaceId: string;
}

const PRIORITY_ORDER: Recommendation['priority'][] = ['fix_now', 'fix_soon', 'fix_later', 'ongoing'];

const PRIORITY_LABELS: Record<Recommendation['priority'], string> = {
  fix_now:  'Fix Now',
  fix_soon: 'Fix Soon',
  fix_later: 'Fix Later',
  ongoing:  'Ongoing',
};

const PRIORITY_TONES: Record<Recommendation['priority'], 'red' | 'amber' | 'blue' | 'zinc'> = {
  fix_now:  'red',
  fix_soon: 'amber',
  fix_later: 'blue',
  ongoing:  'zinc',
};

const STATUS_LABELS: Record<Recommendation['status'], string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  dismissed:   'Dismissed',
};

const STATUS_TONES: Record<Recommendation['status'], 'zinc' | 'teal' | 'emerald' | 'blue'> = {
  pending:     'zinc',
  in_progress: 'teal',
  completed:   'emerald',
  dismissed:   'zinc',
};

type ViewTab = 'active' | 'dismissed';

/** Format a dollar-per-week emv value for display. */
function formatEmv(emv: number): string {
  if (emv < 1) return '<$1/wk';
  if (emv >= 10_000) return `$${(emv / 1000).toFixed(0)}k/wk`;
  if (emv >= 1_000) return `$${(emv / 1000).toFixed(1)}k/wk`;
  return `$${Math.round(emv).toLocaleString()}/wk`;
}

/** OV breakdown bars — renders up to top 3 components by contribution. */
function OvBreakdown({ rec }: { rec: Recommendation }) {
  if (!rec.opportunity || rec.opportunity.components.length === 0) return null;
  const top = [...rec.opportunity.components]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);
  const maxContrib = Math.max(...top.map(c => c.contribution), 0.0001);
  return (
    <div className="mt-2 pt-2 border-t border-[var(--brand-border)]/40 space-y-1.5">
      <div className="t-caption-sm text-[var(--brand-text-muted)]">OV breakdown</div>
      {top.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-16 flex-shrink-0">
            <span className="t-caption-sm font-medium text-[var(--brand-text)] capitalize">{c.dimension}</span>
          </div>
          <div className="flex-1 min-w-0 h-1.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] overflow-hidden">
            <div
              className="h-full rounded-[var(--radius-pill)] bg-blue-500"
              style={{ width: `${Math.max(6, Math.round((c.contribution / maxContrib) * 100))}%` }}
            />
          </div>
          <span className="t-caption-sm text-[var(--brand-text-muted)] truncate min-w-0 flex-1">{c.evidence}</span>
        </div>
      ))}
    </div>
  );
}

/** Single recommendation row card, expanded to show full OV detail. */
function RecRow({ rec, showUndismiss, onUndismiss }: {
  rec: Recommendation;
  showUndismiss?: boolean;
  onUndismiss?: (recId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ovScore = rec.opportunity?.value ?? rec.impactScore;

  return (
    <div className="rounded-[var(--radius-md)] bg-[var(--surface-3)] border border-[var(--brand-border)]/60">
      {/* Header row */}
      <ClickableRow
        onClick={() => setExpanded(e => !e)}
        className="flex items-start gap-3 p-3"
        aria-expanded={expanded}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <Badge
              label={PRIORITY_LABELS[rec.priority]}
              tone={PRIORITY_TONES[rec.priority]}
              size="sm"
              shape="pill"
            />
            {rec.status !== 'dismissed' && (
              <Badge
                label={STATUS_LABELS[rec.status]}
                tone={STATUS_TONES[rec.status]}
                size="sm"
                variant="outline"
                shape="pill"
              />
            )}
            {rec.opportunity && (
              <Badge
                label={`OV ${Math.round(ovScore)}`}
                tone="blue"
                size="sm"
                variant="outline"
                shape="pill"
              />
            )}
            {rec.opportunity?.emvPerWeek != null && rec.opportunity.emvPerWeek > 0 && (
              <span className={`t-caption font-medium ${scoreColorClass(rec.impactScore)}`}>
                {formatEmv(rec.opportunity.emvPerWeek)}
              </span>
            )}
          </div>
          <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{rec.title}</div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] line-clamp-1 mt-0.5">{rec.insight}</div>
        </div>
        <Icon
          as={expanded ? ChevronDown : ChevronRight}
          size="sm"
          className="text-[var(--brand-text-muted)] flex-shrink-0 mt-0.5"
        />
      </ClickableRow>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-[var(--brand-border)]/40 pt-2.5 space-y-2">
          {/* Description */}
          <p className="t-caption text-[var(--brand-text)]">{rec.description}</p>

          {/* Affected pages */}
          {rec.affectedPages.length > 0 && (
            <div>
              <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] mb-0.5">
                Affected pages ({rec.affectedPages.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {rec.affectedPages.slice(0, 6).map(p => (
                  <span key={p} className="t-caption-sm text-[var(--brand-text)] bg-[var(--surface-1)] border border-[var(--brand-border)] rounded px-1.5 py-0.5 truncate max-w-[200px]">{p}</span>
                ))}
                {rec.affectedPages.length > 6 && (
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">+{rec.affectedPages.length - 6} more</span>
                )}
              </div>
            </div>
          )}

          {/* Traffic metrics */}
          {(rec.trafficAtRisk > 0 || rec.impressionsAtRisk > 0) && (
            <div className="flex gap-4">
              {rec.trafficAtRisk > 0 && (
                <div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">Traffic at risk</div>
                  <div className="t-ui font-medium text-blue-400">{rec.trafficAtRisk.toLocaleString()} clicks</div>
                </div>
              )}
              {rec.impressionsAtRisk > 0 && (
                <div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">Impressions at risk</div>
                  <div className="t-ui font-medium text-blue-400">{rec.impressionsAtRisk.toLocaleString()}</div>
                </div>
              )}
            </div>
          )}

          {/* Full OV breakdown */}
          <OvBreakdown rec={rec} />

          {/* Admin-only: estimated gain + EMV detail */}
          <div className="flex items-start gap-4 pt-0.5">
            {rec.estimatedGain && (
              <div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Estimated gain</div>
                <div className="t-caption text-[var(--brand-text-bright)]">{rec.estimatedGain}</div>
              </div>
            )}
            {rec.opportunity?.emvPerWeek != null && rec.opportunity.emvPerWeek > 0 && (
              <div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">EMV/wk (admin)</div>
                <div className={`t-caption font-medium ${scoreColorClass(rec.impactScore)}`}>
                  {formatEmv(rec.opportunity.emvPerWeek)}
                </div>
              </div>
            )}
            {rec.opportunity?.confidence != null && (
              <div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Confidence</div>
                <div className="t-caption text-[var(--brand-text)]">{Math.round(rec.opportunity.confidence * 100)}%</div>
              </div>
            )}
          </div>

          {/* Un-dismiss action */}
          {showUndismiss && onUndismiss && (
            <div className="pt-1">
              <Button
                size="sm"
                variant="secondary"
                icon={RotateCcw}
                iconPosition="left"
                onClick={(e) => { e.stopPropagation(); onUndismiss(rec.id); }}
              >
                Un-dismiss
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
                      <RecRow key={rec.id} rec={rec} />
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
                    <RecRow
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
