// @ds-rebuilt
import { useEffect, useMemo, useRef } from 'react';
import { Check, RefreshCw, Search, Upload } from 'lucide-react';
import { normalizePageUrl, matchPageIdentity } from '../../lib/pathUtils';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { WS_EVENTS } from '../../lib/wsEvents';
import {
  useSeoEditorSurfaceData,
  useSeoEditorSurfaceWorkflows,
} from '../../hooks/admin/useSeoEditorRebuilt';
import { SEO_EDITOR_TARGET_TYPES } from '../../../shared/types/seo-editor-write-target';
import {
  Button,
  ErrorState,
  FilterChip,
  FormInput,
  FormSelect,
  GroupBlock,
  Icon,
  InlineBanner,
  LensSwitcher,
  MetricTile,
  PageHeader,
  SearchField,
  Segmented,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import { SeoSuggestionsPanel } from '../editor/SeoSuggestionsPanel';
import { SeoEditorApprovalsPanel } from './SeoEditorApprovalsPanel';
import { SeoEditorPagePanel } from './SeoEditorPagePanel';
import { SeoEditorWorksheet } from './SeoEditorWorksheet';
import type { SeoEditorSurfaceRow } from './seoEditorSurfaceTypes';
import {
  SEO_EDITOR_QUICK_FILTERS,
  SEO_EDITOR_SOURCE_OPTIONS,
  type SeoEditorQuickFilter,
  type SeoEditorSourceScope,
  useSeoEditorSurfaceState,
} from './useSeoEditorSurfaceState';

interface SeoEditorSurfaceProps {
  workspaceId: string;
}

function rowMatchesSearch(row: SeoEditorSurfaceRow, search: string): boolean {
  if (!search) return true;
  const query = search.toLowerCase();
  return row.target.title.toLowerCase().includes(query)
    || row.target.canonicalPath.toLowerCase().includes(query)
    || row.target.sourceLabel.toLowerCase().includes(query)
    || row.keywordAssignment?.primaryKeyword?.toLowerCase().includes(query)
    || (row.keywordAssignment?.secondaryKeywords ?? []).some((keyword) => keyword.toLowerCase().includes(query));
}

function rowMatchesSource(row: SeoEditorSurfaceRow, source: SeoEditorSourceScope): boolean {
  return source === 'all' || row.target.targetType === source;
}

function rowMatchesFilter(row: SeoEditorSurfaceRow, filter: SeoEditorQuickFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'needs-title') return row.missingTitle;
  if (filter === 'needs-meta') return row.missingDescription;
  if (filter === 'needs-review') return row.recommendations.length > 0 || row.pageState?.status === 'fix-proposed' || row.pageState?.status === 'in-review';
  return row.dirty;
}

function selectedRowFrom(rows: SeoEditorSurfaceRow[], selectedPage: string | null): SeoEditorSurfaceRow | null {
  if (!selectedPage) return null;
  const normalized = normalizePageUrl(selectedPage).toLowerCase();
  return rows.find((row) => {
    if (row.id === selectedPage || row.target.id === selectedPage) return true;
    if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage && row.target.pageId === selectedPage) return true;
    if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem && row.target.itemId === selectedPage) return true;
    if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual && row.target.syntheticPageId === selectedPage) return true;
    if (row.target.rawSlug && normalizePageUrl(row.target.rawSlug).toLowerCase() === normalized) return true;
    return normalizePageUrl(row.target.canonicalPath).toLowerCase() === normalized;
  }) ?? null;
}

function findFixContextRow(rows: SeoEditorSurfaceRow[], pageSlug?: string, pageId?: string): SeoEditorSurfaceRow | null {
  if (!pageSlug && !pageId) return null;
  return rows.find((row) => {
    if (pageId && (
      row.target.id === pageId ||
      (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage && row.target.pageId === pageId) ||
      (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem && row.target.itemId === pageId)
    )) {
      return true;
    }
    if (!pageSlug) return false;
    return matchPageIdentity(row.target.canonicalPath, pageSlug) || row.target.rawSlug === pageSlug;
  }) ?? null;
}

export function SeoEditorSurface({ workspaceId }: SeoEditorSurfaceProps) {
  const state = useSeoEditorSurfaceState();
  const data = useSeoEditorSurfaceData({ workspaceId });
  const staticPages = useMemo(
    () => (data.pagesQuery.data ?? []).filter((page) => page.source !== 'cms'),
    [data.pagesQuery.data],
  );
  const fixConsumedRef = useRef<string | null>(null);

  const workflows = useSeoEditorSurfaceWorkflows({
    workspaceId,
    siteId: data.siteId,
    staticPages,
    cmsCollections: data.cmsQuery.data?.collections ?? [],
    filteredStaticPageIds: data.rows
      .flatMap((row) => (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage ? [row.target.pageId] : [])),
    fixContext: state.fixContext,
  });

  const rowsWithDrafts = useMemo<SeoEditorSurfaceRow[]>(() => data.rows.map((row) => {
    if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage) {
      const edit = workflows.staticWorkflow.edits[row.target.pageId];
      return {
        ...row,
        edit,
        dirty: !!edit?.dirty,
        missingTitle: !(edit?.seoTitle ?? row.target.seo.title).trim(),
        missingDescription: !(edit?.seoDescription ?? row.target.seo.description).trim(),
      };
    }
    if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem) {
      const cmsEdit = workflows.cmsWorkflow.edits[row.target.itemId];
      const titleField = row.target.titleFieldSlug;
      const descriptionField = row.target.descriptionFieldSlug;
      return {
        ...row,
        cmsEdit,
        dirty: workflows.cmsWorkflow.dirty.has(row.target.itemId),
        missingTitle: titleField ? !(cmsEdit?.[titleField] ?? row.target.seo.title).trim() : row.missingTitle,
        missingDescription: descriptionField ? !(cmsEdit?.[descriptionField] ?? row.target.seo.description).trim() : row.missingDescription,
      };
    }
    return row;
  }), [data.rows, workflows.cmsWorkflow.dirty, workflows.cmsWorkflow.edits, workflows.staticWorkflow.edits]);

  const sourceCounts = useMemo(() => new Map<SeoEditorSourceScope, number>([
    ['all', rowsWithDrafts.length],
    [SEO_EDITOR_TARGET_TYPES.staticPage, rowsWithDrafts.filter((row) => row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage).length],
    [SEO_EDITOR_TARGET_TYPES.cmsItem, rowsWithDrafts.filter((row) => row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem).length],
    [SEO_EDITOR_TARGET_TYPES.manual, rowsWithDrafts.filter((row) => row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual).length],
  ]), [rowsWithDrafts]);

  const filterCounts = useMemo(() => new Map<SeoEditorQuickFilter, number>([
    ['all', rowsWithDrafts.length],
    ['needs-title', rowsWithDrafts.filter((row) => row.missingTitle).length],
    ['needs-meta', rowsWithDrafts.filter((row) => row.missingDescription).length],
    ['needs-review', rowsWithDrafts.filter((row) => row.recommendations.length > 0 || row.pageState?.status === 'fix-proposed' || row.pageState?.status === 'in-review').length],
    ['unsaved', rowsWithDrafts.filter((row) => row.dirty).length],
  ]), [rowsWithDrafts]);

  const filteredRows = useMemo(() => rowsWithDrafts
    .filter((row) => rowMatchesSource(row, state.source))
    .filter((row) => state.collection === 'all' || (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem && row.target.collectionId === state.collection))
    .filter((row) => rowMatchesFilter(row, state.filter))
    .filter((row) => rowMatchesSearch(row, state.search)),
  [rowsWithDrafts, state.collection, state.filter, state.search, state.source]);

  const selectedRow = selectedRowFrom(rowsWithDrafts, state.selectedPage);
  const selectedMissing = !!state.selectedPage && rowsWithDrafts.length > 0 && !selectedRow;

  useEffect(() => {
    const fixKey = state.fixContext?.pageId || state.fixContext?.pageSlug;
    if (!fixKey || fixConsumedRef.current === fixKey || rowsWithDrafts.length === 0) return;
    const match = findFixContextRow(rowsWithDrafts, state.fixContext?.pageSlug, state.fixContext?.pageId);
    if (!match) return;
    fixConsumedRef.current = fixKey;
    state.openPage(match.id);
  }, [rowsWithDrafts, state]);

  useWorkspaceEvents(workspaceId, {
    // ws-invalidation-ok — SEO editor writes and approval changes must refresh the rebuilt all-pages/CMS/read-state projection while mounted outside the legacy shell.
    [WS_EVENTS.PAGE_STATE_UPDATED]: () => data.refetchAll(),
    // ws-invalidation-ok — approval send/retract changes affect the Sent-to-client panel and row statuses.
    [WS_EVENTS.APPROVAL_UPDATE]: () => data.refetchAll(),
    // ws-invalidation-ok — strategy keyword changes affect target-keyword chips and server-backed score/rank projection.
    [WS_EVENTS.STRATEGY_UPDATED]: () => data.refetchAll(),
  });

  if (data.isLoading && !data.workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5" aria-label="Loading SEO Editor">
        <Skeleton className="h-[72px] w-full" />
        <Skeleton className="h-[54px] w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (data.isError && !data.workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="SEO Editor" subtitle="Edit static pages and CMS item metadata through the existing Webflow write paths." />
        <ErrorState
          type="data"
          title="Workspace details did not load"
          message="Retry the workspace read before editing metadata."
          action={{ label: 'Retry', onClick: () => data.refetchAll() }}
          className="min-h-[420px]"
        />
      </div>
    );
  }

  if (!data.workspace || !data.siteId) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="SEO Editor" subtitle="Edit static pages and CMS item metadata through the existing Webflow write paths." />
        <ErrorState
          type="permission"
          title="Connect a Webflow site first"
          message="SEO Editor needs a linked Webflow site before it can load editable page metadata."
          className="min-h-[420px]"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="SEO Editor"
        subtitle="Static pages, CMS items, and sitemap-only manual rows in one metadata worksheet."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => data.refetchAll()}>
              <Icon as={RefreshCw} size="sm" />
              Refresh
            </Button>
            <Button size="sm" variant="primary" onClick={workflows.publishSite} loading={workflows.publishing}>
              <Icon as={workflows.published ? Check : Upload} size="sm" />
              {workflows.published ? 'Published' : 'Publish Site'}
            </Button>
          </div>
        )}
      />

      <Toolbar label="SEO Editor view controls" className="w-full">
        <LensSwitcher
          id="seo-editor-rebuilt-tab"
          options={state.tabOptions}
          value={state.tab}
          onChange={(value) => state.setTab(value as typeof state.tab)}
          size="sm"
        />
        <Segmented
          id="seo-editor-source"
          value={state.source}
          onChange={(value) => state.setSource(value as SeoEditorSourceScope)}
          options={SEO_EDITOR_SOURCE_OPTIONS.map((option) => ({
            value: option.id,
            label: `${option.label} ${sourceCounts.get(option.id) ?? 0}`,
          }))}
        />
        <SearchField
          value={state.searchInput}
          onChange={state.setSearchInput}
          placeholder="Search pages and CMS items"
          className="min-w-[240px] flex-1"
          icon={Search}
        />
        <ToolbarSpacer />
        {data.resolvedTargets.collectionOptions.length > 0 && state.source !== SEO_EDITOR_TARGET_TYPES.staticPage && state.source !== SEO_EDITOR_TARGET_TYPES.manual && (
          <FormSelect
            aria-label="Filter CMS collection"
            value={state.collection}
            onChange={state.setCollection}
            options={[
              { value: 'all', label: 'All collections' },
              ...data.resolvedTargets.collectionOptions.map((collection) => ({
                value: collection.collectionId,
                label: `${collection.collectionName} (${collection.itemCount})`,
              })),
            ]}
            className="w-[240px]"
          />
        )}
      </Toolbar>

      <div className="flex flex-wrap gap-2" aria-label="SEO Editor quick filters">
        {SEO_EDITOR_QUICK_FILTERS.map((filter) => (
          <FilterChip
            key={filter.id}
            label={filter.label}
            count={filterCounts.get(filter.id)}
            active={state.filter === filter.id}
            onClick={() => state.setFilter(filter.id)}
          />
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile label="Rows" value={rowsWithDrafts.length} sub="All sources" accent="var(--blue)" />
        <MetricTile label="Static" value={sourceCounts.get(SEO_EDITOR_TARGET_TYPES.staticPage) ?? 0} accent="var(--teal)" />
        <MetricTile label="CMS" value={sourceCounts.get(SEO_EDITOR_TARGET_TYPES.cmsItem) ?? 0} accent="var(--blue)" />
        <MetricTile label="Manual" value={sourceCounts.get(SEO_EDITOR_TARGET_TYPES.manual) ?? 0} accent="var(--amber)" />
        <MetricTile label="Unsaved" value={filterCounts.get('unsaved') ?? 0} accent="var(--emerald)" />
      </div>

      {data.isError && (
        <InlineBanner tone="warning" title="SEO data may be stale">
          <div className="flex flex-wrap items-center gap-2">
            <span>The last loaded worksheet is still shown. Retry the source reads when the connection is healthy.</span>
            <Button size="sm" variant="secondary" onClick={() => data.refetchAll()}>Retry</Button>
          </div>
        </InlineBanner>
      )}

      {selectedMissing && (
        <InlineBanner tone="warning" title="Deep-linked page was not found" onDismiss={state.closePage}>
          The requested page is not in the current static, CMS, or manual row projection. The worksheet remains available below.
        </InlineBanner>
      )}

      {state.tab === 'research' && (
        <GroupBlock
          title="Research mode"
          meta="Uses the existing analysis and keyword projection. Assignments remain owned by Keyword Hub."
          collapsible
          defaultOpen
        >
          {selectedRow ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
                <div className="t-ui font-semibold text-[var(--brand-text-bright)]">{selectedRow.target.title}</div>
                <div className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">{selectedRow.target.canonicalPath}</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selectedRow.keywordAssignment?.primaryKeyword && <FilterChip label={selectedRow.keywordAssignment.primaryKeyword} active />}
                  {(selectedRow.keywordAssignment?.secondaryKeywords ?? []).map((keyword) => <FilterChip key={keyword} label={keyword} />)}
                </div>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
                <div className="t-label text-[var(--brand-text-muted)]">Metadata recommendations</div>
                {selectedRow.recommendations.length === 0 ? (
                  <p className="mt-2 t-caption-sm text-[var(--brand-text-muted)]">No metadata recommendations are attached to this row.</p>
                ) : (
                  <div className="mt-2 grid gap-2">
                    {selectedRow.recommendations.map((recommendation) => (
                      <InlineBanner key={recommendation.id} tone="warning" size="sm" title={recommendation.title}>
                        {recommendation.insight}
                      </InlineBanner>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="t-caption-sm text-[var(--brand-text-muted)]">Open a row to review its page-specific research context.</p>
          )}
        </GroupBlock>
      )}

      {workflows.suggestions.length > 0 && (
        <GroupBlock
          title="Drafts and AI suggestions"
          meta="Bulk rewrite suggestions from the existing server-backed suggestion queue."
          collapsible
          defaultOpen
        >
          <SeoSuggestionsPanel
            workspaceId={workspaceId}
            suggestions={workflows.suggestions}
            counts={workflows.suggestionCounts}
            onRefresh={() => workflows.suggestionsQuery.refetch()}
            onApplied={() => data.refetchAll()}
          />
        </GroupBlock>
      )}

      <SeoEditorApprovalsPanel
        workspaceId={workspaceId}
        refreshKey={workflows.approvalRefreshKey}
        onRetracted={() => data.refetchAll()}
      />

      <GroupBlock
        title="Bulk static workflows"
        meta="Existing static-page jobs for missing fields, analysis, pattern preview, and server suggestion generation."
        stats={[
          { label: 'Missing titles', value: workflows.bulkWorkflow.missingTitles, color: 'var(--amber)' },
          { label: 'Missing meta', value: workflows.bulkWorkflow.missingDescs, color: 'var(--red)' },
        ]}
        collapsible
        defaultOpen={false}
      >
        <div className="flex flex-col gap-3">
          <Toolbar label="Static SEO bulk actions">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => workflows.bulkWorkflow.handleBulkFix('title')}
              loading={workflows.bulkWorkflow.bulkFixing}
              disabled={workflows.bulkWorkflow.missingTitles === 0}
            >
              Fix titles
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => workflows.bulkWorkflow.handleBulkFix('description')}
              loading={workflows.bulkWorkflow.bulkFixing}
              disabled={workflows.bulkWorkflow.missingDescs === 0}
            >
              Fix descriptions
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={workflows.bulkWorkflow.analyzeAllPages}
              disabled={workflows.bulkWorkflow.bulkAnalyzeProgress != null}
            >
              Analyze remaining
            </Button>
            {workflows.bulkWorkflow.bulkAnalyzeProgress && (
              <Button size="sm" variant="ghost" onClick={workflows.bulkWorkflow.cancelAnalyze}>
                Cancel analyze
              </Button>
            )}
          </Toolbar>

          <Toolbar label="Static SEO pattern controls">
            <FormSelect
              aria-label="Pattern target field"
              value={workflows.bulkWorkflow.bulkField}
              onChange={(value) => workflows.bulkWorkflow.setBulkField(value as 'title' | 'description')}
              options={[
                { value: 'title', label: 'SEO title' },
                { value: 'description', label: 'Meta description' },
              ]}
              className="w-[170px]"
            />
            <FormSelect
              aria-label="Pattern action"
              value={workflows.bulkWorkflow.patternAction}
              onChange={(value) => workflows.bulkWorkflow.setPatternAction(value as 'append' | 'prepend')}
              options={[
                { value: 'append', label: 'Append' },
                { value: 'prepend', label: 'Prepend' },
              ]}
              className="w-[140px]"
            />
            <FormInput
              value={workflows.bulkWorkflow.patternText}
              onChange={workflows.bulkWorkflow.setPatternText}
              placeholder="Pattern text"
              className="min-w-[220px] flex-1"
            />
            <Button size="sm" variant="secondary" onClick={workflows.bulkWorkflow.previewPattern}>
              Preview pattern
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={workflows.bulkWorkflow.applyPattern}
              disabled={workflows.bulkWorkflow.bulkPreview.length === 0 || workflows.bulkWorkflow.bulkMode === 'rewriting'}
            >
              Apply preview
            </Button>
          </Toolbar>

          {workflows.bulkWorkflow.bulkPreview.length > 0 && (
            <InlineBanner tone="info" size="sm" title={`${workflows.bulkWorkflow.bulkPreview.length} preview changes`}>
              {workflows.bulkWorkflow.bulkPreview.slice(0, 3).map((item) => `${item.oldValue || '—'} -> ${item.newValue || '—'}`).join(' · ')}
            </InlineBanner>
          )}
        </div>
      </GroupBlock>

      <SeoEditorWorksheet
        workspaceId={workspaceId}
        rows={filteredRows}
        source={state.source}
        filter={state.filter}
        staticWorkflow={workflows.staticWorkflow}
        staticBulkWorkflow={workflows.bulkWorkflow}
        cmsWorkflow={workflows.cmsWorkflow}
        onOpenPage={state.openPage}
        onClearFilters={state.clearFilters}
      />

      <SeoEditorPagePanel
        workspaceId={workspaceId}
        row={selectedRow}
        staticWorkflow={workflows.staticWorkflow}
        cmsWorkflow={workflows.cmsWorkflow}
        onClose={state.closePage}
      />
    </div>
  );
}

export default SeoEditorSurface;
