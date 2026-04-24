/**
 * SchemaHealthDashboard — Per-page validation status with aggregated stats.
 *
 * Shows validation badges (valid/warnings/errors), rich result types detected,
 * error/warning details, and a re-validate button per page.
 */
import { useState } from 'react';
import { ShieldCheck, AlertTriangle, XCircle, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { SectionCard } from '../ui/SectionCard';

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
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <ShieldCheck className="w-3 h-3" />
        Valid
      </span>
    );
  }
  if (status === 'warnings') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
        <AlertTriangle className="w-3 h-3" />
        Warnings
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
      <XCircle className="w-3 h-3" />
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
    <div className="border border-zinc-800 overflow-hidden" style={{ borderRadius: '6px 12px 6px 12px' }}>
      <div className="flex items-center gap-3 px-3 py-2.5 bg-zinc-900">
        {hasDetails && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}
        {!hasDetails && <span className="w-4 flex-shrink-0" />}

        <span className="flex-1 text-sm text-zinc-300 font-mono truncate" title={record.pageId}>
          {pageLabel(record.pageId)}
        </span>

        <div className="flex items-center gap-2 flex-shrink-0">
          {record.richResults.slice(0, 3).map(type => (
            <span key={type} className="text-xs px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
              {type}
            </span>
          ))}
          {record.richResults.length > 3 && (
            <span className="text-xs text-zinc-500">+{record.richResults.length - 3}</span>
          )}
          <ValidationBadge status={record.status} />
          <button
            onClick={() => onRevalidate(record.pageId)}
            className="p-1 text-zinc-500 hover:text-teal-400 transition-colors"
            title="Re-validate"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && hasDetails && (
        <div className="px-4 py-3 bg-zinc-950 border-t border-zinc-800 space-y-2">
          {record.errors.length > 0 && (
            <div>
              <p className="text-xs font-medium text-red-400 mb-1">Errors</p>
              <ul className="space-y-1">
                {record.errors.map((e, i) => (
                  <li key={i} className="text-xs text-zinc-400 flex items-start gap-1.5">
                    <XCircle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
                    {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {record.warnings.length > 0 && (
            <div>
              <p className="text-xs font-medium text-amber-400 mb-1">Warnings</p>
              <ul className="space-y-1">
                {record.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-zinc-400 flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {record.richResults.length > 0 && (
            <div>
              <p className="text-xs font-medium text-teal-400 mb-1">Rich Results Eligible</p>
              <div className="flex flex-wrap gap-1">
                {record.richResults.map(type => (
                  <span key={type} className="text-xs px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
                    {type}
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-zinc-600">
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
    <div className="flex items-center gap-4 text-xs">
      <span className="flex items-center gap-1 text-emerald-400">
        <ShieldCheck className="w-3.5 h-3.5" />
        {validCount} valid
      </span>
      <span className="flex items-center gap-1 text-amber-400">
        <AlertTriangle className="w-3.5 h-3.5" />
        {warningCount} warnings
      </span>
      <span className="flex items-center gap-1 text-red-400">
        <XCircle className="w-3.5 h-3.5" />
        {errorCount} errors
      </span>
    </div>
  ) : null;

  return (
    <SectionCard
      title="Schema Health"
      titleIcon={<ShieldCheck className="w-4 h-4 text-teal-400" />}
      titleExtra={statsBar}
    >
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 bg-zinc-800 rounded-lg" />
          ))}
        </div>
      ) : validations.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-4">No validations yet — publish a page to validate its schema.</p>
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
