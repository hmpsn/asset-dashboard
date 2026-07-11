// @ds-rebuilt
import { AlertTriangle, FileJson } from 'lucide-react';
import type { SchemaPageSuggestion } from '../schema/schemaSuggesterTypes';
import { SCHEMA_PAGE_TYPE_OPTIONS } from '../schema/schemaPageTypeOptions';
import {
  Badge,
  DataTable,
  EmptyState,
  FormSelect,
  Icon,
  InlineBanner,
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
  onPageTypeChange: (pageId: string, pageType: string) => void;
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
  onPageTypeChange,
}: SchemaPageTableProps) {
  const rows = pages.map((page) => {
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
  });

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
        const page = row.page as SchemaPageSuggestion;
        return (
          <div className="w-full" onClick={(event) => event.stopPropagation()}>
            <FormSelect
              value={row.pageType as string}
              onChange={(value) => onPageTypeChange(page.pageId, value)}
              options={SCHEMA_PAGE_TYPE_OPTIONS}
              aria-label={`Page type for ${titleForPage(page)}`}
              className="t-mono w-full px-[10px] py-[6px]"
            />
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
      <DataTable
        id="schema-generated-pages"
        columns={columns}
        rows={rows}
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
