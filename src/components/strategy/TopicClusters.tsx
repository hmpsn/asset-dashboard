import { Button, Icon } from '../ui';
import { scoreBgBarClass, scoreBgClass, scoreColorClass } from '../ui/constants';
import { Check, Layers, BarChart3, AlertTriangle } from 'lucide-react';
import { useShowMore } from '../../hooks/useShowMore';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useOutcomeActions, useRecordOutcomeAction } from '../../hooks/admin/useOutcomes';

interface TopicCluster {
  topic: string;
  keywords: string[];
  ownedCount: number;
  totalCount: number;
  coveragePercent: number;
  avgPosition?: number;
  topCompetitor?: string;
  topCompetitorCoverage?: number;
  gap: string[];
}

export interface TopicClustersProps {
  clusters: TopicCluster[];
  workspaceId?: string;
  /** When provided, caps the list at N items with a "Show N more / Show less" toggle.
   *  When absent/undefined, renders the full list — byte-identical to the previous behavior. */
  maxVisible?: number;
}

const coverageBorderClass = (pct: number) =>
  pct >= 80 ? 'border-emerald-500/20'
  : pct >= 60 ? 'border-amber-500/20'
  : 'border-red-500/20';

const coverageColor = (pct: number) =>
  `${scoreColorClass(pct)} ${scoreBgClass(pct)} ${coverageBorderClass(pct)}`;

export function TopicClusters({ clusters, workspaceId, maxVisible }: TopicClustersProps) {
  const keepEnabled = useFeatureFlag('strategy-keywords-managed-set');

  // Keep affordance: durable via tracked_actions (NOT a column on topic_clusters — that table is
  // delete-then-reinsert on regen). Filter to sourceType='topic_cluster' so other action types
  // don't collide. Hooks must stay above any early-return (Rules of Hooks).
  const { data: keptActions } = useOutcomeActions(workspaceId ?? '', 'topic_cluster_keep');
  const keepMutation = useRecordOutcomeAction(workspaceId ?? '');
  const keptKeys = new Set(
    (keptActions ?? [])
      .filter(a => a.sourceType === 'topic_cluster')
      .map(a => a.sourceId)
      .filter((id): id is string => id != null),
  );

  // When maxVisible is absent: preserve original hard cap at 10 with no toggle (byte-identical).
  // When maxVisible is provided: use useShowMore for the cap + toggle affordance.
  const capped = maxVisible === undefined ? clusters.slice(0, 10) : clusters;
  const { visible, hiddenCount, expanded, toggle, canExpand } = useShowMore(capped, maxVisible);

  if (clusters.length === 0) return null;

  return (
    <div className="bg-[var(--surface-2)] border border-teal-500/20 p-5 rounded-[var(--radius-signature)]">
      <h4 className="t-caption-sm font-semibold text-teal-300 mb-1 flex items-center gap-1.5">
        <Icon as={Layers} size="md" className="text-teal-300" /> Topical Authority
      </h4>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">
        Topic clusters ranked by coverage gap. Coverage includes ranked keywords plus mapped page/title matches; avg position only reflects ranked terms.
      </p>
      <div className="space-y-2">
        {visible.map((cluster, i) => {
          const clusterSourceId = `cluster:${cluster.topic}`;
          const isKept = keptKeys.has(clusterSourceId);
          return (
            <div key={i} className="px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)]">
              <div className="flex items-center justify-between">
                <span className="t-body font-medium text-[var(--brand-text-bright)] capitalize">{cluster.topic}</span>
                <div className="flex items-center gap-2">
                  <span className={`t-caption-sm font-medium px-1.5 py-0.5 rounded-[var(--radius-sm)] border ${coverageColor(cluster.coveragePercent)}`}>
                    {cluster.coveragePercent}% coverage
                  </span>
                  <span className="t-micro text-[var(--brand-text-muted)]">{cluster.ownedCount}/{cluster.totalCount} covered</span>
                </div>
              </div>
              {/* Coverage bar */}
              <div className="mt-1.5 h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
                <div className={`h-full rounded-[var(--radius-pill)] transition-all ${scoreBgBarClass(cluster.coveragePercent)}`} style={{ width: `${cluster.coveragePercent}%` }} />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {cluster.avgPosition && (
                    <span className="t-caption-sm text-[var(--brand-text)] flex items-center gap-0.5">
                      <Icon as={BarChart3} size="sm" />Ranking avg #{cluster.avgPosition}
                    </span>
                  )}
                  {cluster.topCompetitor && cluster.topCompetitorCoverage && (
                    <span className="t-caption-sm text-orange-400 flex items-center gap-0.5">
                      <Icon as={AlertTriangle} size="sm" className="text-orange-400" />{cluster.topCompetitor}: {cluster.topCompetitorCoverage}%
                    </span>
                  )}
                </div>
                {keepEnabled && workspaceId && (
                  <Button
                    onClick={() => {
                      if (!isKept) {
                        keepMutation.mutate({
                          actionType: 'topic_cluster_keep',
                          sourceType: 'topic_cluster',
                          sourceId: clusterSourceId,
                          targetKeyword: cluster.topic,
                        });
                      }
                    }}
                    variant="ghost"
                    size="sm"
                    disabled={isKept || keepMutation.isPending}
                    aria-label={isKept ? 'Kept' : 'Keep this cluster'}
                    className={`gap-1 px-2 py-0.5 rounded-[var(--radius-lg)] border t-caption-sm font-medium transition-colors ${
                      isKept
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 cursor-default'
                        : 'bg-[var(--surface-3)]/40 border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:border-[var(--brand-border-hover)]'
                    }`}
                  >
                    <Icon as={Check} size="sm" /> {isKept ? 'Kept' : 'Keep'}
                  </Button>
                )}
              </div>
              {cluster.gap.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {cluster.gap.slice(0, 5).map((kw, ki) => (
                    <span key={ki} className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] badge-span-ok bg-teal-500/10 text-teal-400 border border-teal-500/20">
                      {kw}
                    </span>
                  ))}
                  {cluster.gap.length > 5 && (
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">+{cluster.gap.length - 5} more</span>
                  )}
                </div>
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
    </div>
  );
}
