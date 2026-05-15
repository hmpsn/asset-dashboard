/**
 * AuditBatchActions — batch task creation and bulk-apply-all-suggestions toolbar.
 * Extracted from SeoAudit.tsx.
 */
import { Loader2, CheckCircle, ClipboardList, EyeOff } from 'lucide-react';
import { Icon, Button, cn } from '../ui';
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
      <div className="flex items-center gap-3 t-caption text-[var(--brand-text-muted)]">
        <span>Showing {filteredPages.length} of {effectiveData.pages.length} pages</span>
        {suppressions.length > 0 && (() => {
          const patternCount = suppressions.filter(s => s.pagePattern).length;
          const exactCount = suppressions.length - patternCount;
          const label = patternCount > 0
            ? `${exactCount > 0 ? `${exactCount} page` : ''}${exactCount > 0 && patternCount > 0 ? ' + ' : ''}${patternCount > 0 ? `${patternCount} pattern` : ''} suppressed`
            : `${suppressions.length} suppressed`;
          return (
            <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
              <Icon as={EyeOff} size="sm" /> {label}
              <Button onClick={onUnsuppressAll} variant="link" size="sm" className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] underline ml-0.5" title="Remove all suppressions">clear</Button>
            </span>
          );
        })()}
        {(severityFilter !== 'all' || categoryFilter !== 'all') && (
          <Button onClick={onClearFilters} variant="link" size="sm" className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] underline">
            Clear filters
          </Button>
        )}
        {hasTraffic && (
          <div className="flex items-center gap-1 ml-2">
            <span className="t-caption-sm text-[var(--brand-text-muted)]">Sort:</span>
            <Button
              onClick={() => onSetSortMode('issues')}
              variant="ghost"
              size="sm"
              className={cn('px-2 py-0.5 rounded t-caption-sm font-medium transition-colors border', sortMode === 'issues' ? 'border-[var(--brand-border)] bg-[var(--surface-2)] text-[var(--brand-text-bright)]' : 'border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:border-[var(--brand-border-hover)]')}
            >
              Issues
            </Button>
            <Button
              onClick={() => onSetSortMode('traffic')}
              variant="ghost"
              size="sm"
              className={cn('px-2 py-0.5 rounded t-caption-sm font-medium transition-colors border', sortMode === 'traffic' ? 'border-teal-500/50 bg-teal-500/10 text-teal-400' : 'border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:border-[var(--brand-border-hover)]')}
            >
              Traffic Impact
            </Button>
          </div>
        )}
      </div>
      {workspaceId && (
        <div className="flex items-center gap-2">
          {batchResult && Date.now() - batchResult.timestamp < 8000 && (
            <span className="t-caption-sm text-emerald-400 flex items-center gap-1">
              <Icon as={CheckCircle} size="sm" /> {batchResult.count} added to tasks
            </span>
          )}
          {batchCreating ? (
            <span className="flex items-center gap-1.5 t-caption-sm text-[var(--brand-text)]">
              <Loader2 className="w-3 h-3 animate-spin" /> Adding to tasks...
            </span>
          ) : (
            <div className="flex items-center gap-1">
              <Button
                onClick={() => onBatchCreateTasks('errors')}
                variant="ghost"
                size="sm"
                className="px-2 py-1 rounded t-caption-sm font-medium bg-red-500/8 border border-red-500/20 text-red-400/80 hover:bg-red-500/15 transition-colors"
                title="Add all errors to tasks"
              >
                <Icon as={ClipboardList} size="sm" /> Add Errors to Tasks ({effectiveData.errors})
              </Button>
              {(severityFilter !== 'all' || categoryFilter !== 'all') && (
                <Button
                  onClick={() => onBatchCreateTasks('filtered')}
                  variant="ghost"
                  size="sm"
                  className="px-2 py-1 rounded t-caption-sm font-medium bg-teal-500/10 border border-teal-500/20 text-teal-400 hover:bg-teal-500/20 transition-colors"
                  title="Add currently filtered issues to tasks"
                >
                  <Icon as={ClipboardList} size="sm" /> Add Filtered to Tasks
                </Button>
              )}
              <Button
                onClick={() => onBatchCreateTasks('all')}
                variant="ghost"
                size="sm"
                className="px-2 py-1 rounded t-caption-sm font-medium bg-[var(--surface-2)] border border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:border-[var(--brand-border-hover)] transition-colors"
                title="Add ALL findings to tasks"
              >
                <Icon as={ClipboardList} size="sm" /> Add All to Tasks ({effectiveData.errors + effectiveData.warnings + effectiveData.infos})
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
