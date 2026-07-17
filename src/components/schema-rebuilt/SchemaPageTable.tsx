// @ds-rebuilt
import { useMemo, useState } from 'react';
import { AlertTriangle, FileJson } from 'lucide-react';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import type { SchemaPageSuggestion } from '../schema/schemaSuggesterTypes';
import { SCHEMA_PAGE_TYPE_OPTIONS } from '../schema/schemaPageTypeOptions';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterChip,
  Icon,
  InlineBanner,
  SearchField,
  Toolbar,
  ToolbarSpacer,
  type DataColumn,
} from '../ui';
import {
  pathForPage,
  publishedLabel,
  publishedTone,
  staleDaysForPage,
  titleForPage,
  validationLabel,
  validationStatusForPage,
  validationTone,
} from './schemaFormatters';
import type { SchemaValidationRecord } from '../../api/schema';

interface SchemaPageTableProps {
  pages: SchemaPageSuggestion[];
  pageTypes: Record<string, string>;
  pageTypeErrors: Record<string, string>;
  published: Set<string>;
  retractedPages: Set<string>;
  validationStatusByPageId: Map<string, SchemaValidationRecord['status']>;
  onOpenPage: (pageId: string) => void;
}

const SCHEMA_PAGE_ROW_LIMIT = 100;

type SchemaPageStatusFilter = 'needs-fixes' | 'published' | 'stale' | 'retracted';

const STATUS_FILTERS: Array<{ id: SchemaPageStatusFilter; label: string }> = [
  { id: 'needs-fixes', label: 'Needs fixes' },
  { id: 'published', label: 'Published' },
  { id: 'stale', label: 'Stale' },
  { id: 'retracted', label: 'Retracted' },
];

function pageTypeLabel(value: string): string {
  return SCHEMA_PAGE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function EmptyIcon({ className }: { className?: string }) {
  return <Icon as={FileJson} className={className} />;
}

export function SchemaPageTable({
  pages,
  pageTypes,
  pageTypeErrors,
  published,
  retractedPages,
  validationStatusByPageId,
  onOpenPage,
}: SchemaPageTableProps) {
  const [search, setSearch] = useState('');
  const [showAllRows, setShowAllRows] = useState(false);
  const [statusFilters, toggleStatus] = useToggleSet<SchemaPageStatusFilter>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  const rows = useMemo(() => pages.map((page) => {
    const validationStatus = validationStatusForPage(page, validationStatusByPageId);
    return {
      id: page.pageId,
      page,
      title: titleForPage(page),
      path: pathForPage(page),
      validationStatus,
      published: published.has(page.pageId),
      retracted: retractedPages.has(page.pageId),
      staleDays: staleDaysForPage(page),
      pageType: pageTypes[page.pageId] || 'auto',
      pageTypeError: pageTypeErrors[page.pageId],
    };
  }), [pageTypeErrors, pageTypes, pages, published, retractedPages, validationStatusByPageId]);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredRows = rows.filter((row) => {
    const matchesSearch = !normalizedSearch || [row.title, row.path, pageTypeLabel(row.pageType)]
      .some((value) => value.toLowerCase().includes(normalizedSearch));
    if (!matchesSearch) return false;
    if (statusFilters.size === 0) return true;
    return Array.from(statusFilters).some((filter) => {
      if (filter === 'needs-fixes') return row.validationStatus === 'errors' || row.validationStatus === 'warnings';
      if (filter === 'published') return !row.retracted && (row.published || Boolean(row.page.lastPublishedAt));
      if (filter === 'stale') return row.staleDays !== null;
      return row.retracted;
    });
  });
  const visibleRows = showAllRows ? filteredRows : filteredRows.slice(0, SCHEMA_PAGE_ROW_LIMIT);

  const filterCount = (filter: SchemaPageStatusFilter): number => rows.filter((row) => {
    if (filter === 'needs-fixes') return row.validationStatus === 'errors' || row.validationStatus === 'warnings';
    if (filter === 'published') return !row.retracted && (row.published || Boolean(row.page.lastPublishedAt));
    if (filter === 'stale') return row.staleDays !== null;
    return row.retracted;
  }).length;

  const columns: DataColumn[] = [
    {
      key: 'title',
      label: 'Page',
      width: 'minmax(260px,1fr)',
      sortable: true,
      render: (_value, row) => {
        const page = row.page as SchemaPageSuggestion;
        return (
          <div className="min-w-0">
            <div className="truncate t-ui font-semibold text-[var(--brand-text-bright)]">{titleForPage(page)}</div>
            <div className="truncate t-caption-sm text-[var(--brand-text-muted)]">{pathForPage(page)}</div>
          </div>
        );
      },
    },
    {
      key: 'pageType',
      label: 'Type',
      width: '180px',
      render: (_value, row) => {
        return (
          <div className="w-full">
            <Badge label={pageTypeLabel(row.pageType as string)} tone="zinc" variant="outline" size="sm" />
            {Boolean(row.pageTypeError) && (
              <div className="mt-1 flex items-center gap-1 t-caption-sm text-[var(--amber)]">
                <Icon as={AlertTriangle} size="xs" />
                Not saved
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'validationStatus',
      label: 'Validation',
      width: '132px',
      render: (_value, row) => {
        const status = row.validationStatus as SchemaValidationRecord['status'] | undefined;
        return <Badge label={validationLabel(status)} tone={validationTone(status)} variant="outline" size="sm" />;
      },
    },
    {
      key: 'published',
      label: 'Publish',
      width: '118px',
      render: (_value, row) => {
        const page = row.page as SchemaPageSuggestion;
        const isPublished = row.published as boolean;
        const retracted = row.retracted as boolean;
        return <Badge label={publishedLabel(page, isPublished, retracted)} tone={publishedTone(page, isPublished, retracted)} variant="outline" size="sm" />;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-2" data-testid="schema-page-list">
      <Toolbar label="Generated schema page filters" className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-2">
        <SearchField
          value={search}
          onChange={(value) => {
            setSearch(value);
            setShowAllRows(false);
          }}
          placeholder="Search generated pages…"
          className="min-w-[220px] flex-1"
        />
        {STATUS_FILTERS.map((filter) => (
          <FilterChip
            key={filter.id}
            label={filter.label}
            count={filterCount(filter.id)}
            active={statusFilters.has(filter.id)}
            onClick={() => {
              toggleStatus(filter.id);
              setShowAllRows(false);
            }}
          />
        ))}
        <ToolbarSpacer />
        <span className="t-caption-sm text-[var(--brand-text-muted)]">
          Showing {visibleRows.length} of {filteredRows.length} {filteredRows.length === 1 ? 'page' : 'pages'}
        </span>
        {filteredRows.length > SCHEMA_PAGE_ROW_LIMIT && (
          <Button variant="ghost" size="sm" onClick={() => setShowAllRows((current) => !current)}>
            {showAllRows ? `Show first ${SCHEMA_PAGE_ROW_LIMIT}` : `Show all ${filteredRows.length}`}
          </Button>
        )}
      </Toolbar>
      <DataTable
        id="schema-generated-pages"
        columns={columns}
        rows={visibleRows}
        getRowKey={(row) => row.id as string}
        onRowClick={(row) => onOpenPage(row.id as string)}
        className="[&>[role=row]:first-child]:h-px [&>[role=row]:first-child]:overflow-hidden [&>[role=row]:first-child]:border-0 [&>[role=row]:first-child]:p-0 [&>[role=row]:first-child]:opacity-0 [&>[role=row]:not(:first-child)]:min-h-[68px] [&>[role=row]:not(:first-child)]:py-[11px]"
        empty={(
          <EmptyState
            icon={EmptyIcon}
            title="No generated schema yet"
            description="Generate a full scan or add a single page to start reviewing JSON-LD."
          />
        )}
      />
      {pages.some((page) => staleDaysForPage(page) !== null) && (
        <InlineBanner tone="warning" size="sm" title="Some published schema is older than 90 days">
          Open stale pages before republishing so regenerated JSON-LD becomes the effective schema.
        </InlineBanner>
      )}
    </div>
  );
}
