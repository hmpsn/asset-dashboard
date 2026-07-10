// @ds-rebuilt
import { useMemo } from 'react';
import { AlertTriangle, CheckSquare, Database, FileText, MinusCircle, Square, Wand2 } from 'lucide-react';
import { adminPath } from '../../routes';
import { SEO_EDITOR_TARGET_TYPES } from '../../../shared/types/seo-editor-write-target';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  GroupBlock,
  Icon,
  InlineBanner,
  StatusBadge,
  Toolbar,
  ToolbarSpacer,
  scoreColorClass,
} from '../ui';
import type { DataColumn } from '../ui';
import type {
  CmsSeoWorkflowState,
  SeoEditorSurfaceRow,
  StaticSeoBulkWorkflowState,
  StaticSeoWorkflowState,
} from './seoEditorSurfaceTypes';
import type { SeoEditorQuickFilter, SeoEditorSourceScope } from './useSeoEditorSurfaceState';
import {
  seoEditorQuickFilterLabel,
  seoEditorSourceScopeLabel,
} from './useSeoEditorSurfaceState';
import {
  formatCount,
  formatFreshness,
  formatRank,
  formatSourceLabel,
  formatTraffic,
} from './seoEditorSurfaceFormatters';

interface SeoEditorWorksheetProps {
  workspaceId: string;
  rows: SeoEditorSurfaceRow[];
  source: SeoEditorSourceScope;
  filter: SeoEditorQuickFilter;
  staticWorkflow: StaticSeoWorkflowState;
  staticBulkWorkflow: StaticSeoBulkWorkflowState;
  cmsWorkflow: CmsSeoWorkflowState;
  onOpenPage: (id: string) => void;
  onClearFilters: () => void;
}

type SeoEditorTableRecord = Record<string, unknown> & {
  row: SeoEditorSurfaceRow;
  title: string;
  source: string;
  score: number | null;
  rank: number | null;
  traffic: number | null;
  lastEditedAt: string | null;
  status: string;
};

interface WorksheetSourceGroup {
  id: 'static' | 'cms' | 'manual';
  title: string;
  meta: string;
  icon: typeof FileText;
  iconColor: string;
  records: SeoEditorTableRecord[];
}

function sourceIcon(row: SeoEditorSurfaceRow) {
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage) return FileText;
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem) return Database;
  return AlertTriangle;
}

function selectedForRow(row: SeoEditorSurfaceRow, staticWorkflow: StaticSeoWorkflowState, cmsWorkflow: CmsSeoWorkflowState): boolean {
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage) return staticWorkflow.approvalSelected.has(row.target.pageId);
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem) return cmsWorkflow.approvalSelected.has(row.target.itemId);
  return false;
}

function toggleRow(row: SeoEditorSurfaceRow, staticWorkflow: StaticSeoWorkflowState, cmsWorkflow: CmsSeoWorkflowState) {
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage) staticWorkflow.toggleApprovalSelect(row.target.pageId);
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem) cmsWorkflow.toggleApprovalItem(row.target.itemId);
}

function missingLabel(row: SeoEditorSurfaceRow): string | null {
  if (row.missingTitle && row.missingDescription) return 'Missing title + meta';
  if (row.missingTitle) return 'Missing title';
  if (row.missingDescription) return 'Missing meta';
  return null;
}

function targetRowsToRecords(rows: SeoEditorSurfaceRow[]): SeoEditorTableRecord[] {
  return rows.map((row) => ({
    row,
    title: row.target.title,
    source: formatSourceLabel(row.target.targetType),
    score: row.metrics.optimizationScore ?? null,
    rank: row.metrics.rank ?? null,
    traffic: row.metrics.traffic ?? null,
    lastEditedAt: row.metrics.lastEditedAt ?? null,
    status: row.pageState?.status ?? 'clean',
  }));
}

export function SeoEditorWorksheet({
  workspaceId,
  rows,
  source,
  filter,
  staticWorkflow,
  staticBulkWorkflow,
  cmsWorkflow,
  onOpenPage,
  onClearFilters,
}: SeoEditorWorksheetProps) {
  const records = useMemo(() => targetRowsToRecords(rows), [rows]);
  const sourceGroups = useMemo<WorksheetSourceGroup[]>(() => [
    {
      id: 'static',
      title: 'Static pages',
      meta: 'Direct page-SEO writes',
      icon: FileText,
      iconColor: 'var(--brand-text-muted)',
      records: records.filter((record) => record.row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage),
    },
    {
      id: 'cms',
      title: 'CMS collection items',
      meta: 'Publish-gated per collection',
      icon: Database,
      iconColor: 'var(--blue)',
      records: records.filter((record) => record.row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem),
    },
    {
      id: 'manual',
      title: 'Manual URLs',
      meta: 'Read-only',
      icon: AlertTriangle,
      iconColor: 'var(--amber)',
      records: records.filter((record) => record.row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual),
    },
  ], [records]);
  const staticSelectedCount = staticWorkflow.approvalSelected.size;
  const cmsSelectedCount = cmsWorkflow.approvalSelected.size;
  const selectedCount = staticSelectedCount + cmsSelectedCount;
  const visibleCmsIds = useMemo(
    () => rows
      .flatMap((row) => (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem ? [row.target.itemId] : [])),
    [rows],
  );
  const visibleStaticIds = useMemo(
    () => rows
      .flatMap((row) => (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage ? [row.target.pageId] : [])),
    [rows],
  );

  const columns = useMemo<DataColumn[]>(() => [
    {
      key: 'select',
      label: 'Select',
      width: '54px',
      render: (_value, record) => {
        const row = (record as SeoEditorTableRecord).row;
        const disabled = row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual;
        return (
          <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <Checkbox
              checked={selectedForRow(row, staticWorkflow, cmsWorkflow)}
              onChange={() => toggleRow(row, staticWorkflow, cmsWorkflow)}
              disabled={disabled}
              label={disabled ? `${row.target.title} is visible only` : `Select ${row.target.title}`}
              srOnlyLabel
            />
          </div>
        );
      },
    },
    {
      key: 'title',
      label: 'Page',
      width: 'minmax(260px, 1.8fr)',
      sortable: true,
      render: (_value, record) => {
        const row = (record as SeoEditorTableRecord).row;
        const IconSource = sourceIcon(row);
        const missing = missingLabel(row);
        return (
          <div className="flex min-w-0 items-start gap-2">
            <Icon as={IconSource} size="sm" className="mt-0.5 text-[var(--brand-text-muted)]" />
            <div className="min-w-0">
              <span className="block truncate t-ui font-semibold text-[var(--brand-text-bright)]">{row.target.title}</span>
              <span className="block truncate t-caption text-[var(--brand-text-muted)]">{row.target.canonicalPath}</span>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {row.dirty && <Badge label="Unsaved" tone="blue" variant="soft" size="sm" />}
                {missing && <Badge label={missing} tone="amber" variant="soft" size="sm" />}
                {row.recommendations.length > 0 && <Badge label={`${row.recommendations.length} recs`} tone="amber" variant="outline" size="sm" />}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'source',
      label: 'Source',
      width: '130px',
      sortable: true,
      render: (_value, record) => {
        const row = (record as SeoEditorTableRecord).row;
        const tone = row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage
          ? 'zinc'
          : row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem ? 'blue' : 'amber';
        return <Badge label={formatSourceLabel(row.target.targetType)} tone={tone} variant="outline" size="sm" />;
      },
    },
    {
      key: 'seo',
      label: 'SEO',
      width: 'minmax(260px, 1.5fr)',
      render: (_value, record) => {
        const row = (record as SeoEditorTableRecord).row;
        const title = row.edit?.seoTitle ?? row.cmsEdit?.[row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem ? row.target.titleFieldSlug ?? '' : ''] ?? row.target.seo.title;
        const description = row.edit?.seoDescription ?? row.cmsEdit?.[row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem ? row.target.descriptionFieldSlug ?? '' : ''] ?? row.target.seo.description;
        return (
          <div className="min-w-0">
            <span className="block truncate t-ui text-[var(--brand-text-bright)]">{title || '—'}</span>
            <span className="block truncate t-caption text-[var(--brand-text-muted)]">{description || '—'}</span>
          </div>
        );
      },
    },
    {
      key: 'keywords',
      label: 'Keywords',
      width: 'minmax(180px, 1fr)',
      render: (_value, record) => {
        const row = (record as SeoEditorTableRecord).row;
        const primary = row.keywordAssignment?.primaryKeyword;
        const secondary = row.keywordAssignment?.secondaryKeywords ?? [];
        if (!primary && secondary.length === 0) return <span className="t-caption text-[var(--brand-text-muted)]">—</span>;
        return (
          <div className="flex min-w-0 flex-wrap gap-1">
            {primary && <Badge label={primary} tone="teal" variant="soft" size="sm" />}
            {secondary.slice(0, 2).map((keyword) => <Badge key={keyword} label={keyword} tone="zinc" variant="outline" size="sm" />)}
            {secondary.length > 2 && <Badge label={`+${secondary.length - 2}`} tone="zinc" variant="outline" size="sm" />}
          </div>
        );
      },
    },
    {
      key: 'score',
      label: 'Score',
      width: '92px',
      align: 'right',
      sortable: true,
      render: (_value, record) => {
        const score = (record as SeoEditorTableRecord).score;
        return typeof score === 'number'
          ? <span className={scoreColorClass(score)}>{score}</span>
          : <span className="text-[var(--brand-text-muted)]">—</span>;
      },
    },
    {
      key: 'rank',
      label: 'Rank',
      width: '88px',
      align: 'right',
      sortable: true,
      render: (_value, record) => <span>{formatRank((record as SeoEditorTableRecord).rank)}</span>,
    },
    {
      key: 'traffic',
      label: 'Traffic',
      width: '104px',
      align: 'right',
      sortable: true,
      render: (_value, record) => <span>{formatTraffic((record as SeoEditorTableRecord).traffic)}</span>,
    },
    {
      key: 'lastEditedAt',
      label: 'Edited',
      width: '132px',
      sortable: true,
      render: (_value, record) => {
        const value = (record as SeoEditorTableRecord).lastEditedAt;
        return <span className="t-caption text-[var(--brand-text-muted)]">{value ? formatFreshness(value) : '—'}</span>;
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: '146px',
      render: (_value, record) => {
        const row = (record as SeoEditorTableRecord).row;
        return <StatusBadge status={row.pageState?.status} size="sm" />;
      },
    },
  ], [cmsWorkflow, staticWorkflow]);

  const empty = (
    <EmptyState
      icon={MinusCircle}
      title="No SEO rows match this view"
      description="Clear the source, filter, or search controls to restore the worksheet."
      action={<Button size="sm" variant="secondary" onClick={onClearFilters}>Clear filters</Button>}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <Toolbar label="SEO worksheet controls" className="w-full">
        <span className="t-ui text-[var(--brand-text-muted)]">
          {formatCount(records.length)} {records.length === 1 ? 'row' : 'rows'}
          {source !== 'all' ? ` · ${seoEditorSourceScopeLabel(source)}` : ''}
          {filter !== 'all' ? ` · ${seoEditorQuickFilterLabel(filter)}` : ''}
        </span>
        <ToolbarSpacer />
        {visibleStaticIds.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => staticWorkflow.selectAllForApproval(visibleStaticIds)}>
            <Icon as={staticWorkflow.approvalSelected.size > 0 ? CheckSquare : Square} size="sm" />
            Static approval set
          </Button>
        )}
        {visibleCmsIds.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => cmsWorkflow.toggleSelectAllInCollection(visibleCmsIds)}>
            <Icon as={cmsWorkflow.approvalSelected.size > 0 ? CheckSquare : Square} size="sm" />
            CMS approval set
          </Button>
        )}
      </Toolbar>

      {staticBulkWorkflow.bulkResults && (
        <InlineBanner tone="info" size="sm" title="Static bulk update">
          {staticBulkWorkflow.bulkResults}
        </InlineBanner>
      )}

      {cmsWorkflow.bulkResults && (
        <InlineBanner tone="info" size="sm" title="CMS bulk update">
          {cmsWorkflow.bulkResults}
        </InlineBanner>
      )}

      {(staticBulkWorkflow.bulkAnalyzeProgress || staticBulkWorkflow.bulkMode === 'rewriting' || cmsWorkflow.bulkMode === 'rewriting') && (
        <InlineBanner tone="info" size="sm" title="Bulk job running">
          Static analyze {staticBulkWorkflow.bulkAnalyzeProgress ? `${staticBulkWorkflow.bulkAnalyzeProgress.done}/${staticBulkWorkflow.bulkAnalyzeProgress.total}` : 'idle'}
          {' · '}Static rewrite {staticBulkWorkflow.bulkProgress.total ? `${staticBulkWorkflow.bulkProgress.done}/${staticBulkWorkflow.bulkProgress.total}` : 'idle'}
          {' · '}CMS rewrite {cmsWorkflow.bulkProgress.total ? `${cmsWorkflow.bulkProgress.done}/${cmsWorkflow.bulkProgress.total}` : 'idle'}
        </InlineBanner>
      )}

      {selectedCount > 0 && (
        <div className="sticky top-0 z-[var(--z-dropdown)] bg-[var(--surface-1)] pb-1">
          <InlineBanner tone="info" size="sm" title={`${selectedCount} selected`}>
            <Toolbar label="Selected SEO actions" className="mt-2">
              {staticSelectedCount > 0 && (
                <>
                  <Button size="sm" variant="primary" loading={staticWorkflow.sendingApproval} onClick={staticWorkflow.sendForApproval}>
                    Send static to client
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => staticBulkWorkflow.bulkAiRewrite('both')}>
                    <Icon as={Wand2} size="sm" />
                    Rewrite static
                  </Button>
                </>
              )}
              {cmsSelectedCount > 0 && (
                <>
                  <Button size="sm" variant="primary" loading={cmsWorkflow.sendingApproval} onClick={() => cmsWorkflow.sendForApproval()}>
                    Send CMS to client
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => cmsWorkflow.bulkAiRewrite('name')}>
                    <Icon as={Wand2} size="sm" />
                    Names
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => cmsWorkflow.bulkAiRewrite('title')}>
                    <Icon as={Wand2} size="sm" />
                    Titles
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => cmsWorkflow.bulkAiRewrite('description')}>
                    <Icon as={Wand2} size="sm" />
                    Descriptions
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => cmsWorkflow.bulkAiRewrite('all')}>
                    <Icon as={Wand2} size="sm" />
                    All CMS fields
                  </Button>
                </>
              )}
              <ToolbarSpacer />
              <Button size="sm" variant="link" onClick={() => window.open(adminPath(workspaceId, 'seo-keywords'), '_self')}>
                Keyword Hub owns assignments
              </Button>
            </Toolbar>
          </InlineBanner>
        </div>
      )}

      {records.length === 0 ? (
        <DataTable
          columns={columns}
          rows={records}
          getRowKey={(record) => (record as SeoEditorTableRecord).row.id}
          onRowClick={(record) => onOpenPage((record as SeoEditorTableRecord).row.id)}
          empty={empty}
        />
      ) : sourceGroups.map((group) => group.records.length > 0 && (
        <GroupBlock
          key={group.id}
          title={group.title}
          meta={group.meta}
          icon={group.icon}
          iconColor={group.iconColor}
          stats={[{ label: group.records.length === 1 ? 'row' : 'rows', value: formatCount(group.records.length) }]}
        >
          <DataTable
            columns={columns}
            rows={group.records}
            getRowKey={(record) => (record as SeoEditorTableRecord).row.id}
            onRowClick={(record) => onOpenPage((record as SeoEditorTableRecord).row.id)}
            className="border-0 rounded-none bg-transparent"
          />
        </GroupBlock>
      ))}
    </div>
  );
}
