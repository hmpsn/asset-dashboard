// @ds-rebuilt
import { AlertTriangle, FileJson, RefreshCw } from 'lucide-react';
import type { SchemaPageSuggestion } from '../schema/schemaSuggesterTypes';
import { SCHEMA_PAGE_TYPE_OPTIONS } from '../schema/schemaPageTypeOptions';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FormSelect,
  Icon,
  InlineBanner,
  type DataColumn,
} from '../ui';
import {
  formatInteger,
  graphTypesForPage,
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
  regenerating: Set<string>;
  published: Set<string>;
  retractedPages: Set<string>;
  validationStatusByPageId: Map<string, SchemaValidationRecord['status']>;
  onOpenPage: (pageId: string) => void;
  onRegenerate: (pageId: string) => void;
  onPageTypeChange: (pageId: string, pageType: string) => void;
}

function EmptyIcon({ className }: { className?: string }) {
  return <Icon as={FileJson} className={className} />;
}

export function SchemaPageTable({
  pages,
  pageTypes,
  pageTypeErrors,
  regenerating,
  published,
  retractedPages,
  validationStatusByPageId,
  onOpenPage,
  onRegenerate,
  onPageTypeChange,
}: SchemaPageTableProps) {
  const rows = pages.map((page) => {
    const graphTypes = graphTypesForPage(page);
    const validationStatus = validationStatusForPage(page, validationStatusByPageId);
    return {
      id: page.pageId,
      page,
      title: titleForPage(page),
      path: pathForPage(page),
      graphCount: graphTypes.length,
      graphTypes,
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
      width: 'minmax(220px,1.8fr)',
      sortable: true,
      render: (_value, row) => {
        const page = row.page as SchemaPageSuggestion;
        return (
          <div className="min-w-0">
            <div className="truncate t-ui text-[var(--brand-text-bright)]">{titleForPage(page)}</div>
            <div className="truncate t-caption-sm text-[var(--brand-text-muted)]">{pathForPage(page)}</div>
          </div>
        );
      },
    },
    {
      key: 'graphCount',
      label: 'Graph',
      width: '118px',
      align: 'right',
      sortable: true,
      render: (_value, row) => (
        <div className="flex justify-end">
          <Badge label={`${formatInteger(row.graphCount as number)} types`} tone="teal" variant="outline" size="sm" />
        </div>
      ),
    },
    {
      key: 'validationStatus',
      label: 'Validation',
      width: '142px',
      render: (_value, row) => {
        const status = row.validationStatus as SchemaValidationRecord['status'] | undefined;
        return <Badge label={validationLabel(status)} tone={validationTone(status)} variant="outline" size="sm" />;
      },
    },
    {
      key: 'published',
      label: 'Publish',
      width: '136px',
      render: (_value, row) => {
        const page = row.page as SchemaPageSuggestion;
        const isPublished = row.published as boolean;
        const retracted = row.retracted as boolean;
        return <Badge label={publishedLabel(page, isPublished, retracted)} tone={publishedTone(page, isPublished, retracted)} variant="outline" size="sm" />;
      },
    },
    {
      key: 'pageType',
      label: 'Type',
      width: '190px',
      render: (_value, row) => {
        const page = row.page as SchemaPageSuggestion;
        return (
          <div className="w-full" onClick={(event) => event.stopPropagation()}>
            <FormSelect
              value={row.pageType as string}
              onChange={(value) => onPageTypeChange(page.pageId, value)}
              options={SCHEMA_PAGE_TYPE_OPTIONS}
              aria-label={`Page type for ${titleForPage(page)}`}
              className="w-full"
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
      key: 'id',
      label: 'Action',
      width: '118px',
      align: 'right',
      render: (_value, row) => {
        const page = row.page as SchemaPageSuggestion;
        const loading = regenerating.has(page.pageId);
        return (
          <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
            <Button size="sm" variant="secondary" onClick={() => onRegenerate(page.pageId)} loading={loading}>
              {!loading && <Icon as={RefreshCw} size="sm" />}
              Refresh
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      {pages.some((page) => staleDaysForPage(page) !== null) && (
        <InlineBanner tone="warning" size="sm" title="Some published schema is older than 90 days">
          Open stale pages before republishing so regenerated JSON-LD becomes the effective schema.
        </InlineBanner>
      )}
      <DataTable
        id="schema-generated-pages"
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id as string}
        onRowClick={(row) => onOpenPage(row.id as string)}
        empty={(
          <EmptyState
            icon={EmptyIcon}
            title="No generated schema yet"
            description="Generate a full scan or add a single page to start reviewing JSON-LD."
          />
        )}
      />
    </>
  );
}
