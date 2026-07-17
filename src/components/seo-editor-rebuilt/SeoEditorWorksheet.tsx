// @ds-rebuilt
import { useEffect, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { SEO_EDITOR_TARGET_TYPES } from '../../../shared/types/seo-editor-write-target';
import { useToast } from '../Toast';
import {
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  FormInput,
  FormTextarea,
  Icon,
  InlineBanner,
  Menu,
  StatusBadge,
  Toolbar,
  scoreColorClass,
} from '../ui';
import type { DataColumn, IconName } from '../ui';
import type {
  CmsSeoWorkflowState,
  SeoEditorSurfaceRow,
  StaticSeoBulkWorkflowState,
  StaticSeoWorkflowState,
} from './seoEditorSurfaceTypes';
import { formatRank } from './seoEditorSurfaceFormatters';

interface SeoEditorWorksheetProps {
  rows: SeoEditorSurfaceRow[];
  staticWorkflow: StaticSeoWorkflowState;
  staticBulkWorkflow: StaticSeoBulkWorkflowState;
  cmsWorkflow: CmsSeoWorkflowState;
  onOpenPage: (id: string) => void;
  onClearFilters: () => void;
}

type SourceGroupId = 'static' | 'cms' | 'manual';

interface SourceGroupDefinition {
  id: SourceGroupId;
  title: string;
  meta: string;
  icon: IconName;
  toneClass: string;
}

type SeoEditorTableRecord = Record<string, unknown> & {
  row: SeoEditorSurfaceRow;
  group: SourceGroupDefinition;
  groupStart: boolean;
  groupCount: number;
  page: string;
  keyword: string;
  title: string;
  description: string;
  score: number | null;
};

const SOURCE_GROUPS: readonly SourceGroupDefinition[] = [
  {
    id: 'static',
    title: 'Static pages',
    meta: 'Direct page-SEO writes',
    icon: 'pencil',
    toneClass: 'text-[var(--brand-text-muted)]',
  },
  {
    id: 'cms',
    title: 'CMS collection items',
    meta: 'Publish-gated per collection',
    icon: 'layers',
    toneClass: 'text-[var(--blue)]',
  },
  {
    id: 'manual',
    title: 'Manual URLs',
    meta: 'Read-only · excluded from fixable counts',
    icon: 'globe',
    toneClass: 'text-[var(--amber)]',
  },
] as const;

function groupForRow(row: SeoEditorSurfaceRow): SourceGroupDefinition {
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage) return SOURCE_GROUPS[0];
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem) return SOURCE_GROUPS[1];
  return SOURCE_GROUPS[2];
}

function selectedForRow(
  row: SeoEditorSurfaceRow,
  staticWorkflow: StaticSeoWorkflowState,
  cmsWorkflow: CmsSeoWorkflowState,
): boolean {
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage) {
    return staticWorkflow.approvalSelected.has(row.target.pageId);
  }
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem) {
    return cmsWorkflow.approvalSelected.has(row.target.itemId);
  }
  return false;
}

function toggleRow(
  row: SeoEditorSurfaceRow,
  staticWorkflow: StaticSeoWorkflowState,
  cmsWorkflow: CmsSeoWorkflowState,
) {
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage) {
    staticWorkflow.toggleApprovalSelect(row.target.pageId);
  }
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem) {
    cmsWorkflow.toggleApprovalItem(row.target.itemId);
  }
}

function fieldValue(row: SeoEditorSurfaceRow, field: 'title' | 'description'): string {
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage) {
    return field === 'title'
      ? row.edit?.seoTitle ?? row.target.seo.title
      : row.edit?.seoDescription ?? row.target.seo.description;
  }
  if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem) {
    const fieldSlug = field === 'title' ? row.target.titleFieldSlug : row.target.descriptionFieldSlug;
    return fieldSlug ? row.cmsEdit?.[fieldSlug] ?? row.target.seo[field] : row.target.seo[field];
  }
  return row.target.seo[field];
}

function fieldTone(value: string, min: number, max: number): string {
  if (!value.trim() || value.length > max) return 'border-l-[var(--red)]';
  if (value.length >= min) return 'border-l-[var(--emerald)]';
  return 'border-l-[var(--amber)]';
}

function sourceOrderedRecords(rows: SeoEditorSurfaceRow[]): SeoEditorTableRecord[] {
  return SOURCE_GROUPS.flatMap((group) => {
    const groupRows = rows.filter((row) => groupForRow(row).id === group.id);
    return groupRows.map((row, index) => ({
      row,
      group,
      groupStart: index === 0,
      groupCount: groupRows.length,
      page: row.target.canonicalPath,
      keyword: row.keywordAssignment?.primaryKeyword ?? '',
      title: fieldValue(row, 'title'),
      description: fieldValue(row, 'description'),
      score: row.metrics.optimizationScore ?? null,
    }));
  });
}

function EmptyWorksheetIcon({ className }: { className?: string }) {
  return <Icon name="search" className={className} />;
}

function KeywordMatch({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 t-micro font-semibold',
        ok
          ? 'bg-[color-mix(in_srgb,var(--emerald)_11%,transparent)] text-[var(--emerald)]'
          : 'bg-[color-mix(in_srgb,var(--red)_11%,transparent)] text-[var(--red)]',
      )}
    >
      <Icon name={ok ? 'check' : 'x'} size="xs" />
      {label}
    </span>
  );
}

function targetContainsKeyword(value: string, keyword: string): boolean {
  const tokens = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const normalized = value.toLowerCase();
  return tokens.every((token) => normalized.includes(token));
}

export function SeoEditorWorksheet({
  rows,
  staticWorkflow,
  staticBulkWorkflow,
  cmsWorkflow,
  onOpenPage,
  onClearFilters,
}: SeoEditorWorksheetProps) {
  const { toast } = useToast();
  const records = useMemo(() => sourceOrderedRecords(rows), [rows]);
  const staticSelectedCount = staticWorkflow.approvalSelected.size;
  const cmsSelectedCount = cmsWorkflow.approvalSelected.size;
  const selectedCount = staticSelectedCount + cmsSelectedCount;

  useEffect(() => {
    if (cmsWorkflow.approvalError) {
      toast(cmsWorkflow.approvalError.message, 'error');
    }
  }, [cmsWorkflow.approvalError, toast]);

  useEffect(() => {
    if (cmsWorkflow.approvalSent) {
      toast('CMS changes sent to client', 'success');
    }
  }, [cmsWorkflow.approvalSent, toast]);

  const visibleIds = useMemo(() => ({
    static: rows.flatMap((row) => (
      row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage ? [row.target.pageId] : []
    )),
    cms: rows.flatMap((row) => (
      row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem ? [row.target.itemId] : []
    )),
  }), [rows]);

  const toggleGroup = (record: SeoEditorTableRecord) => {
    if (record.group.id === 'static') staticWorkflow.selectAllForApproval(visibleIds.static);
    if (record.group.id === 'cms') cmsWorkflow.toggleSelectAllInCollection(visibleIds.cms);
  };

  const groupIsSelected = (groupId: SourceGroupId): boolean => {
    if (groupId === 'static') {
      return visibleIds.static.length > 0
        && visibleIds.static.every((id) => staticWorkflow.approvalSelected.has(id));
    }
    if (groupId === 'cms') {
      return visibleIds.cms.length > 0
        && visibleIds.cms.every((id) => cmsWorkflow.approvalSelected.has(id));
    }
    return false;
  };

  const groupBand = (record: SeoEditorTableRecord) => record.groupStart ? (
    <div
      data-testid={`seo-editor-source-band-${record.group.id}`}
      className="absolute inset-x-0 top-0 flex h-7 items-center gap-2 border-y border-[var(--brand-border)] bg-[var(--surface-1)] px-3"
    >
      {record.group.id === 'manual' ? (
        <span className="w-[17px] shrink-0" aria-hidden="true" />
      ) : (
        <div
          className="shrink-0"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            checked={groupIsSelected(record.group.id)}
            onChange={() => toggleGroup(record)}
            label={`Select all ${record.group.title}`}
            srOnlyLabel
          />
        </div>
      )}
      <Icon name={record.group.icon} size="xs" className={record.group.toneClass} />
      <span className="t-caption-sm font-semibold text-[var(--brand-text-bright)]">{record.group.title}</span>
      <span className="t-micro text-[var(--brand-text-dim)]">{record.group.meta}</span>
      <span className="ml-auto t-mono text-[var(--brand-text-dim)]">{record.groupCount}</span>
    </div>
  ) : null;

  const columns = useMemo<DataColumn[]>(() => [
    {
      key: 'select',
      label: 'Select',
      width: '34px',
      render: (_value, rawRecord) => {
        const record = rawRecord as SeoEditorTableRecord;
        const { row } = record;
        const manual = row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual;
        return (
          <div className={cn('flex items-center', record.groupStart && 'pt-7')}>
            {groupBand(record)}
            <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              <Checkbox
                checked={selectedForRow(row, staticWorkflow, cmsWorkflow)}
                onChange={() => toggleRow(row, staticWorkflow, cmsWorkflow)}
                disabled={manual}
                label={manual ? `${row.target.title} is read-only` : `Select ${row.target.title}`}
                srOnlyLabel
              />
            </div>
          </div>
        );
      },
    },
    {
      key: 'page',
      label: 'Page',
      width: 'minmax(184px, 1fr)',
      render: (_value, rawRecord) => {
        const record = rawRecord as SeoEditorTableRecord;
        const { row } = record;
        return (
          <div className={cn('flex min-w-0 flex-col gap-1', record.groupStart && 'pt-7')}>
            <span className="truncate t-mono font-semibold text-[var(--brand-text-bright)]">
              {row.target.canonicalPath}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <StatusBadge status={row.pageState?.status} size="sm" />
              {row.dirty && (
                <span className="t-micro font-semibold text-[var(--blue)]">Unsaved</span>
              )}
              {row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem && (
                <span className="truncate t-micro text-[var(--blue)]">{row.target.collectionName}</span>
              )}
              {row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual && (
                <span className="t-micro font-semibold text-[var(--amber)]">Read-only</span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'keyword',
      label: 'Target keyword',
      width: 'minmax(150px, 174px)',
      render: (_value, rawRecord) => {
        const record = rawRecord as SeoEditorTableRecord;
        const keyword = record.row.keywordAssignment?.primaryKeyword ?? '';
        if (!keyword) {
          return (
            <span className={cn('t-caption-sm italic text-[var(--brand-text-muted)]', record.groupStart && 'pt-7')}>
              No target keyword
            </span>
          );
        }
        return (
          <div className={cn('flex min-w-0 flex-col gap-1.5', record.groupStart && 'pt-7')}>
            <span className="truncate t-caption-sm font-semibold text-[var(--brand-text)]" title={keyword}>{keyword}</span>
            <div className="flex flex-wrap items-center gap-1">
              <KeywordMatch ok={targetContainsKeyword(record.title, keyword)} label="title" />
              <KeywordMatch ok={targetContainsKeyword(record.description, keyword)} label="meta" />
              <span className="t-mono text-[var(--brand-text-dim)]">{formatRank(record.row.metrics.rank)}</span>
            </div>
          </div>
        );
      },
    },
    {
      key: 'title',
      label: 'Title tag · 50–60',
      width: 'minmax(200px, 1.5fr)',
      render: (_value, rawRecord) => {
        const record = rawRecord as SeoEditorTableRecord;
        const { row } = record;
        const value = fieldValue(row, 'title');
        const wrapperClass = cn(
          'relative w-full border-l-2 pl-1',
          row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual
            ? 'border-l-[var(--amber)]'
            : fieldTone(value, 40, 60),
          record.groupStart && 'pt-7',
        );
        if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual) {
          return (
            <div className={wrapperClass}>
              <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]" title={value}>{value || '—'}</span>
              <span className="t-micro text-[var(--brand-text-dim)]">Read-only snapshot</span>
            </div>
          );
        }
        if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem && !row.target.titleFieldSlug) {
          return <span className={cn('t-caption-sm text-[var(--amber)]', record.groupStart && 'pt-7')}>No mapped title field</span>;
        }
        return (
          <div className={wrapperClass}>
            <FormInput
              aria-label={`SEO title for ${row.target.title}`}
              value={value}
              onChange={(next) => {
                if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage) {
                  staticWorkflow.updateField(row.target.pageId, 'seoTitle', next);
                } else if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem && row.target.titleFieldSlug) {
                  cmsWorkflow.updateField(row.target.itemId, row.target.titleFieldSlug, next);
                }
              }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="Write a title tag…"
              className="h-8 !rounded-[var(--radius-sm)] !border-0 !bg-transparent !px-2 !py-1 pr-10 t-caption-sm"
            />
            <span className="pointer-events-none absolute right-1 top-1 t-micro text-[var(--brand-text-dim)]">
              {value.length}/60
            </span>
          </div>
        );
      },
    },
    {
      key: 'description',
      label: 'Meta description · 140–160',
      width: 'minmax(238px, 2fr)',
      render: (_value, rawRecord) => {
        const record = rawRecord as SeoEditorTableRecord;
        const { row } = record;
        const value = fieldValue(row, 'description');
        const wrapperClass = cn(
          'relative w-full border-l-2 pl-1',
          row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual
            ? 'border-l-[var(--amber)]'
            : fieldTone(value, 120, 160),
          record.groupStart && 'pt-7',
        );
        if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.manual) {
          return (
            <div className={wrapperClass}>
              <span className="line-clamp-2 t-caption-sm text-[var(--brand-text-muted)]" title={value}>{value || '—'}</span>
              <span className="t-micro text-[var(--brand-text-dim)]">Read-only snapshot</span>
            </div>
          );
        }
        if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem && !row.target.descriptionFieldSlug) {
          return <span className={cn('t-caption-sm text-[var(--amber)]', record.groupStart && 'pt-7')}>No mapped description field</span>;
        }
        return (
          <div className={wrapperClass}>
            <FormTextarea
              aria-label={`Meta description for ${row.target.title}`}
              value={value}
              rows={2}
              onChange={(next) => {
                if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage) {
                  staticWorkflow.updateField(row.target.pageId, 'seoDescription', next);
                } else if (row.target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem && row.target.descriptionFieldSlug) {
                  cmsWorkflow.updateField(row.target.itemId, row.target.descriptionFieldSlug, next);
                }
              }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="Write a meta description…"
              className="min-h-[42px] !rounded-[var(--radius-sm)] !border-0 !bg-transparent !px-2 !py-1 pr-12 t-caption-sm"
            />
            <span className="pointer-events-none absolute right-1 top-1 t-micro text-[var(--brand-text-dim)]">
              {value.length}/160
            </span>
          </div>
        );
      },
    },
    {
      key: 'score',
      label: 'Score',
      width: '50px',
      align: 'right',
      render: (_value, rawRecord) => {
        const record = rawRecord as SeoEditorTableRecord;
        return (
          // stat-primitive-ok: compact per-row worksheet score, not a labeled StatCard or CompactStatBar metric
          <span className={cn('t-stat-sm', record.groupStart && 'pt-7', typeof record.score === 'number' ? scoreColorClass(record.score) : 'text-[var(--brand-text-dim)]')}>
            {typeof record.score === 'number' ? record.score : '—'}
          </span>
        );
      },
    },
  ], [cmsWorkflow, staticWorkflow, visibleIds.cms, visibleIds.static]);

  const empty = (
    <EmptyState
      icon={EmptyWorksheetIcon}
      title="No SEO rows match this view"
      description="Clear the source, filter, or search controls to restore the worksheet."
      action={<Button size="sm" variant="secondary" onClick={onClearFilters}>Clear filters</Button>}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="seo-editor-worktable">
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
        <Toolbar
          label="Selected SEO actions"
          wrap={false}
          className="min-h-10 w-full overflow-x-auto border-y border-[var(--brand-border)] bg-[var(--surface-3)] px-3 py-1"
        >
          <span className="shrink-0 whitespace-nowrap t-ui font-semibold text-[var(--brand-text-bright)]" aria-live="polite">
            <span className="text-[var(--teal)]">{selectedCount}</span> selected
          </span>
          {staticSelectedCount > 0 && (
            <>
              <Button size="sm" variant="primary" loading={staticWorkflow.sendingApproval} onClick={staticWorkflow.sendForApproval}>
                <Icon name="send" size="xs" />
                Send static to client
              </Button>
              <Button size="sm" variant="secondary" onClick={() => staticBulkWorkflow.bulkAiRewrite('both')}>
                <Icon name="sparkle" size="xs" />
                Rewrite static
              </Button>
            </>
          )}
          {cmsSelectedCount > 0 && (
            <>
              <Button size="sm" variant="primary" loading={cmsWorkflow.sendingApproval} onClick={() => cmsWorkflow.sendForApproval()}>
                <Icon name="send" size="xs" />
                Send CMS to client
              </Button>
              <Menu
                align="end"
                trigger={(
                  <Button size="sm" variant="secondary">
                    <Icon name="sparkle" size="xs" />
                    Rewrite CMS
                  </Button>
                )}
                items={[
                  { label: 'Names', onSelect: () => cmsWorkflow.bulkAiRewrite('name') },
                  { label: 'Titles', onSelect: () => cmsWorkflow.bulkAiRewrite('title') },
                  { label: 'Descriptions', onSelect: () => cmsWorkflow.bulkAiRewrite('description') },
                  { label: 'All CMS fields', onSelect: () => cmsWorkflow.bulkAiRewrite('all') },
                ]}
              />
            </>
          )}
        </Toolbar>
      )}

      <div className="min-h-0 flex-1">
        <DataTable
          columns={columns}
          rows={records}
          getRowKey={(record) => (record as SeoEditorTableRecord).row.id}
          onRowClick={(record) => onOpenPage((record as SeoEditorTableRecord).row.id)}
          empty={empty}
          className="h-full overflow-auto [&>[role=row]]:relative [&>[role=row]]:min-w-[880px] [&>[role=row]]:gap-2 [&>[role=row]]:px-3 [&>[role=row]]:py-2 [&>[role=row]:first-child>[role=columnheader]:first-child>span]:sr-only"
        />
      </div>
    </div>
  );
}
