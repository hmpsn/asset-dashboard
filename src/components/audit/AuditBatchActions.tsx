/**
 * AuditBatchActions — batch task creation and bulk-apply-all-suggestions toolbar.
 * Extracted from SeoAudit.tsx.
 */
import { Loader2, CheckCircle, ClipboardList, EyeOff } from 'lucide-react';
import type { SeoAuditResult, Severity, CheckCategory } from './types';

interface Props {
  effectiveData: SeoAuditResult;
  filteredPages: SeoAuditResult['pages'];
  workspaceId?: string;
  severityFilter: Severity | 'all';
  categoryFilter: CheckCategory | 'all';
  suppressions: { check: string; pageSlug: string; pagePattern?: string }[];
  batchCreating: boolean;
  batchResult: { count: number; timestamp: number } | null;
  onBatchCreateTasks: (mode: 'all' | 'errors' | 'filtered') => void;
  onUnsuppressAll: () => void;
  onClearFilters: () => void;
  sortMode: 'issues' | 'traffic';
  onSetSortMode: (mode: 'issues' | 'traffic') => void;
  hasTraffic: boolean;
}

export function AuditBatchActions({
  effectiveData, filteredPages, workspaceId,
  severityFilter, categoryFilter, suppressions,
  batchCreating, batchResult,
  onBatchCreateTasks, onUnsuppressAll, onClearFilters,
  sortMode, onSetSortMode, hasTraffic,
}: Props) {
  return (
    <div className="flex items-center justify-between px-1">
      <div className="flex items-center gap-3 text-xs text-zinc-500">
        <span>Showing {filteredPages.length} of {effectiveData.pages.length} pages</span>
        {suppressions.length > 0 && (() => {
          const patternCount = suppressions.filter(s => s.pagePattern).length;
          const exactCount = suppressions.length - patternCount;
          const label = patternCount > 0
            ? `${exactCount > 0 ? `${exactCount} page` : ''}${exactCount > 0 && patternCount > 0 ? ' + ' : ''}${patternCount > 0 ? `${patternCount} pattern` : ''} suppressed`
            : `${suppressions.length} suppressed`;
          return (
            <span className="flex items-center gap-1 text-[11px] text-zinc-500">
              <EyeOff className="w-3 h-3" /> {label}
              <button onClick={onUnsuppressAll} className="text-zinc-500 hover:text-zinc-300 underline ml-0.5" title="Remove all suppressions">clear</button>
            </span>
          );
        })()}
        {(severityFilter !== 'all' || categoryFilter !== 'all') && (
          <button onClick={onClearFilters} className="text-zinc-500 hover:text-zinc-300 underline">
            Clear filters
          </button>
        )}
        {hasTraffic && (
          <div className="flex items-center gap-1 ml-2">
            <span className="text-[11px] text-zinc-600">Sort:</span>
            <button
              onClick={() => onSetSortMode('issues')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors border ${sortMode === 'issues' ? 'border-zinc-500 bg-zinc-800 text-zinc-200' : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
            >
              Issues
            </button>
            <button
              onClick={() => onSetSortMode('traffic')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors border ${sortMode === 'traffic' ? 'border-teal-500/50 bg-teal-500/10 text-teal-400' : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
            >
              Traffic Impact
            </button>
          </div>
        )}
      </div>
      {workspaceId && (
        <div className="flex items-center gap-2">
          {batchResult && Date.now() - batchResult.timestamp < 8000 && (
            <span className="text-[11px] text-emerald-400 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> {batchResult.count} added to tasks
            </span>
          )}
          {batchCreating ? (
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Loader2 className="w-3 h-3 animate-spin" /> Adding to tasks...
            </span>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onBatchCreateTasks('errors')}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-red-500/8 border border-red-500/20 text-red-400/80 hover:bg-red-500/15 transition-colors"
                title="Add all errors to tasks"
              >
                <ClipboardList className="w-3 h-3" /> Add Errors to Tasks ({effectiveData.errors})
              </button>
              {(severityFilter !== 'all' || categoryFilter !== 'all') && (
                <button
                  onClick={() => onBatchCreateTasks('filtered')}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-teal-500/10 border border-teal-500/20 text-teal-400 hover:bg-teal-500/20 transition-colors"
                  title="Add currently filtered issues to tasks"
                >
                  <ClipboardList className="w-3 h-3" /> Add Filtered to Tasks
                </button>
              )}
              <button
                onClick={() => onBatchCreateTasks('all')}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
                title="Add ALL findings to tasks"
              >
                <ClipboardList className="w-3 h-3" /> Add All to Tasks ({effectiveData.errors + effectiveData.warnings + effectiveData.infos})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
