/**
 * SchemaHealthDashboard — Per-page validation status with aggregated stats.
 *
 * Shows validation badges (valid/warnings/errors), rich result types detected,
 * error/warning details, and a re-validate button per page.
 */
import { useState } from 'react';
import { ShieldCheck, AlertTriangle, XCircle, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { SectionCard, Icon, IconButton } from '../ui';

export interface ValidationRecord {
  id: string;
  pageId: string;
  status: 'valid' | 'warnings' | 'errors';
  richResults: string[];
  errors: Array<{ type: string; message: string }>;
  warnings: Array<{ type: string; message: string }>;
  validatedAt: string;
}

interface SchemaHealthDashboardProps {
  validations: ValidationRecord[];
  loading: boolean;
  onRevalidate: (pageId: string) => void;
}

function ValidationBadge({ status }: { status: 'valid' | 'warnings' | 'errors' }) {
  if (status === 'valid') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] t-caption font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <Icon as={ShieldCheck} size="sm" />
        Valid
      </span>
    );
  }
  if (status === 'warnings') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] t-caption font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
        <Icon as={AlertTriangle} size="sm" />
        Warnings
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] t-caption font-medium bg-red-500/10 text-red-400 border border-red-500/20">
      <Icon as={XCircle} size="sm" />
      Errors
    </span>
  );
}

function pageLabel(pageId: string): string {
  try {
    return new URL(pageId).pathname || '/';
  } catch {
    return pageId;
  }
}

function ValidationRow({ record, onRevalidate }: { record: ValidationRecord; onRevalidate: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = record.errors.length > 0 || record.warnings.length > 0 || record.richResults.length > 0;

  return (
    <div className="border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature)]">
      <div className="flex items-center gap-3 px-3 py-2.5 bg-[var(--surface-2)]">
        {hasDetails && (
          <IconButton
            onClick={() => setExpanded(e => !e)}
            icon={expanded ? ChevronDown : ChevronRight}
            label={expanded ? 'Collapse validation details' : 'Expand validation details'}
            title={expanded ? 'Collapse details' : 'Expand details'}
            variant="ghost"
            size="sm"
            className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors flex-shrink-0"
          />
        )}
        {!hasDetails && <span className="w-4 flex-shrink-0" />}

        <span className="flex-1 text-sm text-[var(--brand-text)] font-mono truncate" title={record.pageId}>
          {pageLabel(record.pageId)}
        </span>

        <div className="flex items-center gap-2 flex-shrink-0">
          {record.richResults.slice(0, 3).map(type => (
            <span key={type} className="t-caption px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-teal-500/10 text-teal-400 border border-teal-500/20">
              {type}
            </span>
          ))}
          {record.richResults.length > 3 && (
            <span className="t-caption text-[var(--brand-text-muted)]">+{record.richResults.length - 3}</span>
          )}
          <ValidationBadge status={record.status} />
          <IconButton
            onClick={() => onRevalidate(record.pageId)}
            icon={RefreshCw}
            label="Re-validate schema"
            className="p-1 text-[var(--brand-text-muted)] hover:text-teal-400 transition-colors"
            title="Re-validate"
            variant="ghost"
            size="sm"
          />
        </div>
      </div>

      {expanded && hasDetails && (
        <div className="px-4 py-3 bg-[var(--surface-1)] border-t border-[var(--brand-border)] space-y-2">
          {record.errors.length > 0 && (
            <div>
              <p className="t-caption font-medium text-red-400 mb-1">Errors</p>
              <ul className="space-y-1">
                {record.errors.map((e, i) => (
                  <li key={i} className="t-caption text-[var(--brand-text-muted)] flex items-start gap-1.5">
                    <Icon as={XCircle} size="sm" className="text-red-400 flex-shrink-0 mt-0.5" />
                    {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {record.warnings.length > 0 && (
            <div>
              <p className="t-caption font-medium text-amber-400 mb-1">Warnings</p>
              <ul className="space-y-1">
                {record.warnings.map((w, i) => (
                  <li key={i} className="t-caption text-[var(--brand-text-muted)] flex items-start gap-1.5">
                    <Icon as={AlertTriangle} size="sm" className="text-amber-400 flex-shrink-0 mt-0.5" />
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {record.richResults.length > 0 && (
            <div>
              <p className="t-caption font-medium text-teal-400 mb-1">Rich Results Eligible</p>
              <div className="flex flex-wrap gap-1">
                {record.richResults.map(type => (
                  <span key={type} className="t-caption px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-teal-500/10 text-teal-400 border border-teal-500/20">
                    {type}
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="t-caption text-[var(--brand-text-muted)]">
            Validated {new Date(record.validatedAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

export function SchemaHealthDashboard({ validations, loading, onRevalidate }: SchemaHealthDashboardProps) {
  const validCount = validations.filter(v => v.status === 'valid').length;
  const warningCount = validations.filter(v => v.status === 'warnings').length;
  const errorCount = validations.filter(v => v.status === 'errors').length;

  const statsBar = validations.length > 0 ? (
    <div className="flex items-center gap-4 t-caption">
      <span className="flex items-center gap-1 text-emerald-400">
        <Icon as={ShieldCheck} size="md" />
        {validCount} valid
      </span>
      <span className="flex items-center gap-1 text-amber-400">
        <Icon as={AlertTriangle} size="md" />
        {warningCount} warnings
      </span>
      <span className="flex items-center gap-1 text-red-400">
        <Icon as={XCircle} size="md" />
        {errorCount} errors
      </span>
    </div>
  ) : null;

  return (
    <SectionCard
      title="Schema Health"
      titleIcon={<Icon as={ShieldCheck} size="md" className="text-teal-400" />}
      titleExtra={statsBar}
    >
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 bg-[var(--surface-3)] rounded-[var(--radius-md)]" />
          ))}
        </div>
      ) : validations.length === 0 ? (
        <p className="text-sm text-[var(--brand-text-muted)] text-center py-4">No validations yet — publish a page to validate its schema.</p>
      ) : (
        <div className="space-y-2">
          {validations.map(record => (
            <ValidationRow key={record.id} record={record} onRevalidate={onRevalidate} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
