// @ds-rebuilt
import { useEffect, useMemo, useRef } from 'react';
import { normalizePageUrl, matchPageIdentity } from '../../lib/pathUtils';
import { adminPath } from '../../routes';
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
  PageHeader,
  SearchField,
  Segmented,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import { RebuiltTopbarActions } from '../layout/RebuiltAppChrome';
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
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual) return false;
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

  const editableRows = useMemo(
    () => rowsWithDrafts.filter((row) => row.target.targetType !== SEO_EDITOR_TARGET_TYPES.manual),
    [rowsWithDrafts],
  );

  const filterCounts = useMemo(() => new Map<SeoEditorQuickFilter, number>([
    ['all', rowsWithDrafts.length],
    ['needs-title', editableRows.filter((row) => row.missingTitle).length],
    ['needs-meta', editableRows.filter((row) => row.missingDescription).length],
    ['needs-review', editableRows.filter((row) => row.recommendations.length > 0 || row.pageState?.status === 'fix-proposed' || row.pageState?.status === 'in-review').length],
    ['unsaved', editableRows.filter((row) => row.dirty).length],
  ]), [editableRows, rowsWithDrafts.length]);

  const statusCounts = useMemo(() => ({
    inReview: editableRows.filter((row) => row.pageState?.status === 'in-review').length,
    approved: editableRows.filter((row) => row.pageState?.status === 'approved').length,
    needWork: editableRows.filter((row) => (
      row.missingTitle
      || row.missingDescription
      || (typeof row.metrics.optimizationScore === 'number' && row.metrics.optimizationScore < 55)
    )).length,
  }), [editableRows]);

  const averageScore = useMemo(() => {
    const scores = editableRows.flatMap((row) => (
      typeof row.metrics.optimizationScore === 'number' ? [row.metrics.optimizationScore] : []
    ));
    if (scores.length === 0) return null;
    return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  }, [editableRows]);

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
        <PageHeader title="SEO Editor" subtitle="Edit static pages and CMS item metadata through Webflow-backed write paths." />
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
        <PageHeader title="SEO Editor" subtitle="Edit static pages and CMS item metadata through Webflow-backed write paths." />
        <ErrorState
          type="permission"
          title="Connect a Webflow site first"
          message="SEO Editor needs a linked Webflow site before it can load editable page metadata."
          className="min-h-[420px]"
        />
      </div>
    );
  }

  const topbarActions = (
    <div data-testid="seo-editor-header-actions" className="flex max-w-full items-center justify-end gap-2 overflow-x-auto">
      <Button size="sm" variant="secondary" onClick={() => void data.refetchAll()}>
        <Icon name="refresh" size="sm" />
        Re-sync targets
      </Button>
      <Button size="sm" variant="primary" onClick={workflows.publishSite} loading={workflows.publishing}>
        <Icon name={workflows.published ? 'check' : 'arrowUp'} size="sm" />
        {workflows.published ? 'Published' : 'Publish Site'}
      </Button>
    </div>
  );

  const summary = [
    `${rowsWithDrafts.length} targets`,
    `${filterCounts.get('unsaved') ?? 0} unsaved`,
    `${statusCounts.inReview} in review`,
    `${statusCounts.approved} approved`,
    `avg on-page ${averageScore ?? '—'}`,
    `${statusCounts.needWork} need work`,
  ].join(' · ');
  const missingTitleCount = filterCounts.get('needs-title') ?? 0;
  const missingDescriptionCount = filterCounts.get('needs-meta') ?? 0;
  const selectedCount = workflows.staticWorkflow.approvalSelected.size + workflows.cmsWorkflow.approvalSelected.size;

  return (
    <div className="mr-auto flex min-h-full w-full flex-col gap-4">
      <RebuiltTopbarActions fallback={<div data-testid="seo-editor-topbar-actions-fallback">{topbarActions}</div>}>
        {topbarActions}
      </RebuiltTopbarActions>

      <div
        data-testid="seo-editor-workbench"
        className="flex min-h-[620px] flex-col gap-3 overflow-hidden"
        style={{
          height: 'calc(100vh - var(--shell-topbar) - var(--page-pad-y) - 24px)',
          width: 'calc(100% + (var(--page-pad-x) * 2))',
          marginInline: 'calc(var(--page-pad-x) * -1)',
        }}
      >
        <div data-testid="seo-editor-workbench-top" className="flex shrink-0 flex-col gap-3 px-[var(--page-pad-x)]">
          <div className="flex items-center gap-2 t-label uppercase tracking-[0.09em] text-[var(--brand-text-muted)]">
            <span className="h-[7px] w-[7px] rounded-[var(--radius-pill)] bg-[var(--teal)]" aria-hidden="true" />
            SEO editor · {data.workspace.name}
          </div>

          <PageHeader
            title="Write targets"
            subtitle={summary}
            className="flex-col items-stretch gap-2 sm:flex-row sm:items-center [&_p]:whitespace-normal [&_p]:overflow-visible [&>div:last-child]:w-full sm:[&>div:last-child]:w-auto"
            actions={(
              <>
                <SearchField
                  value={state.searchInput}
                  onChange={state.setSearchInput}
                  placeholder="Search targets…"
                  className="min-w-0 flex-1 sm:w-[220px] sm:flex-none"
                />
                <Button size="sm" variant="link" onClick={() => window.open(adminPath(workspaceId, 'seo-keywords'), '_self')}>
                  <Icon name="external" size="xs" />
                  Keyword Hub
                </Button>
              </>
            )}
          />

          <Toolbar label="SEO Editor filters" className="w-full">
            <Segmented
              id="seo-editor-source"
              value={state.source}
              onChange={(value) => state.setSource(value as SeoEditorSourceScope)}
              options={SEO_EDITOR_SOURCE_OPTIONS.map((option) => ({
                value: option.id,
                label: `${option.label} ${sourceCounts.get(option.id) ?? 0}`,
              }))}
            />
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
                className="w-[210px]"
              />
            )}
            <ToolbarSpacer />
            <div className="flex flex-wrap items-center gap-1.5" aria-label="SEO Editor quick filters">
              {SEO_EDITOR_QUICK_FILTERS.map((filter) => (
                <FilterChip
                  key={filter.id}
                  label={filter.label}
                  count={filter.id === 'all' ? undefined : filterCounts.get(filter.id)}
                  active={state.filter === filter.id}
                  onClick={() => state.setFilter(filter.id)}
                  className="py-1"
                />
              ))}
            </div>
          </Toolbar>
        </div>

        {selectedCount === 0 && (missingTitleCount > 0 || missingDescriptionCount > 0) && (
          <InlineBanner
            tone="warning"
            size="sm"
            title="Missing metadata"
            className="mx-[var(--page-pad-x)] shrink-0"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 t-body text-[var(--brand-text)]">
                {missingTitleCount} missing {missingTitleCount === 1 ? 'title' : 'titles'}
                {' · '}
                {missingDescriptionCount} missing {missingDescriptionCount === 1 ? 'description' : 'descriptions'}.
                {' '}Draft them in one pass, then review.
              </span>
              {missingTitleCount > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={workflows.bulkWorkflow.bulkFixing}
                  onClick={() => void workflows.bulkWorkflow.handleBulkFix('title')}
                >
                  <Icon name="sparkle" size="xs" />
                  Fix titles
                </Button>
              )}
              {missingDescriptionCount > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={workflows.bulkWorkflow.bulkFixing}
                  onClick={() => void workflows.bulkWorkflow.handleBulkFix('description')}
                >
                  <Icon name="sparkle" size="xs" />
                  Fix descriptions
                </Button>
              )}
            </div>
          </InlineBanner>
        )}

        {data.isError && (
          <InlineBanner className="mx-[var(--page-pad-x)] shrink-0" tone="warning" size="sm" title="SEO data may be stale">
            <div className="flex flex-wrap items-center gap-2">
              <span>The last loaded worksheet is still shown. Retry the source reads when the connection is healthy.</span>
              <Button size="sm" variant="secondary" onClick={() => data.refetchAll()}>Retry</Button>
            </div>
          </InlineBanner>
        )}

        {selectedMissing && (
          <InlineBanner className="mx-[var(--page-pad-x)] shrink-0" tone="warning" size="sm" title="Deep-linked page was not found" onDismiss={state.closePage}>
            The requested page is not in the current static, CMS, or manual target list. The worksheet remains available below.
          </InlineBanner>
        )}

        <SeoEditorWorksheet
          rows={filteredRows}
          staticWorkflow={workflows.staticWorkflow}
          staticBulkWorkflow={workflows.bulkWorkflow}
          cmsWorkflow={workflows.cmsWorkflow}
          onOpenPage={state.openPage}
          onClearFilters={state.clearFilters}
        />
      </div>

      <GroupBlock
        title="Production tools"
        meta="Approvals, bulk drafting, analysis, and generated suggestions stay available without crowding the workbench."
        stats={[
          { label: 'missing titles', value: workflows.bulkWorkflow.missingTitles, color: 'var(--amber)' },
          { label: 'missing meta', value: workflows.bulkWorkflow.missingDescs, color: 'var(--red)' },
        ]}
        collapsible
        defaultOpen={false}
      >
        <div className="grid gap-3 p-1">
          {workflows.suggestions.length > 0 && (
            <GroupBlock
              title="Drafts and AI suggestions"
              meta="Review rewrite suggestions before applying them to the worksheet."
              collapsible
              defaultOpen={false}
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
            title="Static bulk actions"
            meta="Draft missing tags, analyze remaining pages, preview patterns, and generate suggestions."
            collapsible
            defaultOpen={false}
          >
            <div className="flex flex-col gap-3 p-1">
              <Toolbar label="Static SEO bulk actions">
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
        </div>
      </GroupBlock>

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
