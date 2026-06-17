import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target } from 'lucide-react';
import { SectionCard, EmptyState, ErrorState, Skeleton, Icon, Button } from '../ui';
import { useAdminRecommendationSet } from '../../hooks/admin/useAdminRecommendations';
import { RecommendationRow } from '../admin/recommendations/RecommendationRow';
import { buildRecFixContext } from '../../lib/recTypeTab';
import { recActCategory, ACT_CATEGORIES, type ActCategory } from '../../lib/recCategoryMap';
import { adminPath } from '../../routes';
import type { Recommendation } from '../../../shared/types/recommendations';

interface ActQueueProps {
  workspaceId: string;
}

type Filter = 'all' | ActCategory;

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  content: 'Content',
  technical: 'Technical',
  'quick-win': 'Quick wins',
};

const byImpact = (a: Recommendation, b: Recommendation) =>
  (b.opportunity?.value ?? b.impactScore) - (a.opportunity?.value ?? a.impactScore);

/**
 * Strategy v2 Act zone — the single impact-ranked "what to do next" queue. Surfaces the unified
 * recommendation set (content gaps, decay, cannibalization, quick wins, lost queries, etc. — all
 * already first-class rec types) sorted by opportunity value, with filter chips (All / Content /
 * Technical / Quick wins) and one-click Fix CTAs. Replaces the legacy quick-wins / LHF /
 * content-gaps / keyword-gaps sections when the strategy-command-center flag is on.
 */
export function ActQueue({ workspaceId }: ActQueueProps) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const { data: set, isLoading, isError, refetch } = useAdminRecommendationSet(workspaceId);

  const onFix = useCallback((rec: Recommendation) => {
    const { tab, fixContext } = buildRecFixContext(rec);
    navigate(adminPath(workspaceId, tab), { state: { fixContext } });
  }, [navigate, workspaceId]);

  // Active = not dismissed AND not completed (matches the server's recommendation-summary contract);
  // impact-sorted. .filter() returns a fresh array, so sorting it never mutates the cached set.
  const active = useMemo(
    () => (set?.recommendations ?? [])
      .filter((r) => r.status !== 'dismissed' && r.status !== 'completed')
      .sort(byImpact),
    [set],
  );

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: active.length, content: 0, technical: 0, 'quick-win': 0 };
    for (const r of active) c[recActCategory(r.type)] += 1;
    return c;
  }, [active]);

  const visible = filter === 'all' ? active : active.filter((r) => recActCategory(r.type) === filter);
  const titleIcon = <Icon as={Target} size="md" className="text-accent-brand" />;

  if (isLoading) {
    return (
      <SectionCard title="What to do next" titleIcon={titleIcon}>
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      </SectionCard>
    );
  }

  if (isError) {
    return (
      <SectionCard title="What to do next" titleIcon={titleIcon}>
        <ErrorState
          type="general"
          title="Couldn't load recommendations"
          message="There was a problem loading your action queue. Please try again."
          action={{ label: 'Retry', onClick: () => void refetch() }}
        />
      </SectionCard>
    );
  }

  if (active.length === 0) {
    return (
      <SectionCard title="What to do next" titleIcon={titleIcon}>
        <EmptyState
          icon={Target}
          title="No actions right now"
          description="Your strategy is on track — no open recommendations to act on."
        />
      </SectionCard>
    );
  }

  const filters: Filter[] = ['all', ...ACT_CATEGORIES];

  return (
    <SectionCard title="What to do next" titleIcon={titleIcon}>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {filters.map((f) => (
          <Button
            key={f}
            onClick={() => setFilter(f)}
            variant="ghost"
            size="sm"
            className={`px-3 py-1 rounded-[var(--radius-md)] t-caption-sm font-medium transition-colors ${
              filter === f ? 'bg-teal-600 text-white' : 'bg-[var(--surface-3)]/50 text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]'
            }`}
          >
            {FILTER_LABELS[f]} {counts[f]}
          </Button>
        ))}
      </div>
      <div className="space-y-2">
        {visible.map((rec) => <RecommendationRow key={rec.id} rec={rec} onFixCta={onFix} />)}
        {visible.length === 0 && (
          <p className="t-caption text-[var(--brand-text-muted)] py-2">No {FILTER_LABELS[filter].toLowerCase()} actions.</p>
        )}
      </div>
    </SectionCard>
  );
}
