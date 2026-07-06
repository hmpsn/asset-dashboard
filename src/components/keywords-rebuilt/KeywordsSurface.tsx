// @ds-rebuilt
import { Button, PageHeader, LensSwitcher, SearchField, Toolbar, ToolbarSpacer, FilterChip } from '../ui';
import {
  KEYWORDS_SURFACE_FILTERS,
  KEYWORDS_SURFACE_LENSES,
  useKeywordsSurfaceState,
} from './useKeywordsSurfaceState';

interface KeywordsSurfaceProps {
  workspaceId: string;
}

export function KeywordsSurface({ workspaceId }: KeywordsSurfaceProps) {
  const state = useKeywordsSurfaceState();
  const activeFilterLabel = KEYWORDS_SURFACE_FILTERS.find((filter) => filter.id === state.filter)?.label ?? 'All';

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="Keywords"
        subtitle="Rankings, opportunities, pages, clusters, and lifecycle state in one rebuild pilot."
      />

      <Toolbar label="Keyword view controls" className="w-full">
        <LensSwitcher
          id="keywords-rebuilt-lens"
          options={KEYWORDS_SURFACE_LENSES.map((lens) => ({ value: lens.id, label: lens.label }))}
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

      <section
        aria-label="Keyword surface scaffold"
        className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="t-h2 text-[var(--brand-text-bright)]">{activeFilterLabel}</h2>
            <p className="t-caption-sm text-[var(--brand-text-muted)]">
              Sort {state.sort.key} {state.sort.direction}; page {state.page}
            </p>
          </div>
          {state.selectedKeyword && (
            <Button
              onClick={state.closeKeyword}
              variant="secondary"
              size="sm"
            >
              {state.selectedKeyword}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
