// @ds-rebuilt
import { useKeywordCommandCenterSummary } from '../../hooks/admin/useKeywordCommandCenter';
import { Button, PageHeader, LensSwitcher, SearchField, Toolbar, ToolbarSpacer, FilterChip, MetricTile, Skeleton } from '../ui';
import { KeywordDrawer } from './KeywordDrawer';
import { KeywordsLenses } from './KeywordsLenses';
import {
  KEYWORDS_SURFACE_FILTERS,
  KEYWORDS_SURFACE_LENSES,
  type KeywordsSurfaceLens,
  useKeywordsSurfaceState,
} from './useKeywordsSurfaceState';

interface KeywordsSurfaceProps {
  workspaceId: string;
}

const MONEY_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const LENS_FILTER_HINTS: Partial<Record<KeywordsSurfaceLens, string>> = {
  rankings: 'tracked',
  pages: 'page_assigned',
};

function lensCount(summary: ReturnType<typeof useKeywordCommandCenterSummary>['data'], lens: KeywordsSurfaceLens): number | undefined {
  if (!summary) return undefined;
  if (lens === 'clusters') return summary.topicClusters?.length;
  if (lens === 'lifecycle') return summary.counts.total;
  if (lens === 'opportunities') return summary.counts.total;
  const filterId = LENS_FILTER_HINTS[lens];
  if (!filterId) return undefined;
  return summary.filters.find((filter) => filter.id === filterId)?.count;
}

export function KeywordsSurface({ workspaceId }: KeywordsSurfaceProps) {
  const state = useKeywordsSurfaceState();
  const activeFilterLabel = KEYWORDS_SURFACE_FILTERS.find((filter) => filter.id === state.filter)?.label ?? 'All';
  const summary = useKeywordCommandCenterSummary(workspaceId);
  const counts = summary.data?.counts;
  const trafficValue = summary.data?.trafficValueMonthly;

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="Keywords"
        subtitle="Rankings, opportunities, pages, clusters, and lifecycle state in one rebuild pilot."
      />

      <Toolbar label="Keyword view controls" className="w-full">
        <LensSwitcher
          id="keywords-rebuilt-lens"
          options={KEYWORDS_SURFACE_LENSES.map((lens) => ({
            value: lens.id,
            label: lens.label,
            count: lensCount(summary.data, lens.id),
          }))}
          value={state.lens}
          onChange={(value) => state.setLens(value as typeof state.lens)}
          size="sm"
        />
        <SearchField
          value={state.searchInput}
          onChange={state.setSearchInput}
          placeholder="Search keywords"
          className="min-w-[220px] flex-1"
        />
        <ToolbarSpacer />
        <span className="t-caption text-[var(--brand-text-muted)]" data-testid="keywords-workspace-id">
          {workspaceId}
        </span>
      </Toolbar>

      <div className="flex flex-wrap gap-2" aria-label="Keyword filters">
        {KEYWORDS_SURFACE_FILTERS.map((filter) => (
          <FilterChip
            key={filter.id}
            label={filter.label}
            active={state.filter === filter.id}
            onClick={() => state.setFilter(filter.id)}
          />
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {summary.isLoading && !summary.data ? (
          Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-[92px] w-full" />
          ))
        ) : (
          <>
            <MetricTile label="Total" value={counts?.total ?? 0} sub={activeFilterLabel} accent="var(--blue)" />
            <MetricTile label="In Strategy" value={counts?.inStrategy ?? 0} accent="var(--teal)" />
            <MetricTile label="Tracked" value={counts?.tracked ?? 0} accent="var(--blue)" />
            <MetricTile label="Needs Review" value={counts?.needsReview ?? 0} accent="var(--amber)" />
            <MetricTile
              label="Monthly Value"
              value={typeof trafficValue === 'number' ? MONEY_FORMAT.format(trafficValue) : 'No source'}
              sub="Display-only"
              accent="var(--emerald)"
            />
          </>
        )}
      </div>

      {state.selectedKeyword && (
        <div className="flex justify-end">
          <Button onClick={state.closeKeyword} variant="secondary" size="sm">
            {state.selectedKeyword}
          </Button>
        </div>
      )}

      <KeywordsLenses workspaceId={workspaceId} state={state} summary={summary.data} />
      <KeywordDrawer
        workspaceId={workspaceId}
        keyword={state.selectedKeyword}
        onClose={state.closeKeyword}
      />
    </div>
  );
}
