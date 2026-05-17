import type { PageEditSummary } from '../../hooks/usePageEditStates';
import { StatusBadge, StatCard } from '../ui';
import { KNOWN_TARGET_FIELDS } from './fieldTargets';
import type { SchemaPageSuggestion } from './schemaSuggesterTypes';

export interface SchemaResultsStats {
  pagesWithExisting: number;
  pagesWithErrors: number;
  pagesWithWarnings: number;
  fixesAvailable: number;
  totalTypes: number;
}

export function summarizeSchemaResults(pages: SchemaPageSuggestion[]): SchemaResultsStats {
  const fields = new Set<string>();
  let pagesWithExisting = 0;
  let pagesWithErrors = 0;
  let pagesWithWarnings = 0;
  let totalTypes = 0;

  for (const page of pages) {
    if (page.existingSchemas.length > 0) pagesWithExisting += 1;
    if ((page.validationErrors?.length || 0) > 0) pagesWithErrors += 1;
    if (page.validationFindings?.some(finding => finding.severity === 'warning')) {
      pagesWithWarnings += 1;
    }

    for (const finding of page.validationFindings ?? []) {
      if (finding.field && KNOWN_TARGET_FIELDS.has(finding.field)) {
        fields.add(finding.field);
      }
    }

    const schema = page.suggestedSchemas[0]?.template;
    const graph = schema?.['@graph'] as Record<string, unknown>[] | undefined;
    totalTypes += graph?.length || 0;
  }

  return {
    pagesWithExisting,
    pagesWithErrors,
    pagesWithWarnings,
    fixesAvailable: fields.size,
    totalTypes,
  };
}

interface SchemaResultsSummaryProps {
  pages: SchemaPageSuggestion[];
  stats: SchemaResultsStats;
}

export function SchemaResultsSummary({ pages, stats }: SchemaResultsSummaryProps) {
  return (
    <>
      <div id="schema-suggestions-list" />
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Pages"
          value={pages.length}
          sub={`${stats.totalTypes} @graph types total`}
        />
        <StatCard
          label="Validated"
          value={`${pages.length - stats.pagesWithErrors}/${pages.length}`}
          valueColor={stats.pagesWithErrors > 0 ? 'text-accent-warning' : 'text-accent-success'}
          sub={`${stats.pagesWithErrors > 0 ? `${stats.pagesWithErrors} with errors` : stats.pagesWithWarnings > 0 ? `${stats.pagesWithWarnings} with warnings` : 'all passing'}${stats.fixesAvailable > 0 ? ` · ${stats.fixesAvailable} fix${stats.fixesAvailable === 1 ? '' : 'es'} available` : ''}`}
        />
        <StatCard
          label="Existing Schemas"
          value={stats.pagesWithExisting}
          valueColor="text-accent-success"
          sub="pages already have JSON-LD"
        />
      </div>
    </>
  );
}

interface SchemaEditStatusSummaryProps {
  summary: PageEditSummary;
}

export function SchemaEditStatusSummary({ summary }: SchemaEditStatusSummaryProps) {
  if (summary.total === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 t-caption-sm text-[var(--brand-text-muted)] mb-2">
      <span className="text-[var(--brand-text)] font-medium">{summary.total} tracked</span>
      {summary.live > 0 && <><StatusBadge status="live" /><span className="text-accent-brand">{summary.live}</span></>}
      {summary.inReview > 0 && <><StatusBadge status="in-review" /><span className="text-accent-info">{summary.inReview}</span></>}
      {summary.approved > 0 && <><StatusBadge status="approved" /><span className="text-accent-success">{summary.approved}</span></>}
      {summary.rejected > 0 && <><StatusBadge status="rejected" /><span className="text-accent-danger">{summary.rejected}</span></>}
      {summary.issueDetected > 0 && <><StatusBadge status="issue-detected" /><span className="text-accent-warning">{summary.issueDetected}</span></>}
      {summary.fixProposed > 0 && <><StatusBadge status="fix-proposed" /><span className="text-accent-info">{summary.fixProposed}</span></>}
    </div>
  );
}
