/**
 * AuditFilters — search input, severity filter, category filter pills, and toolbar actions.
 * Extracted from SeoAudit.tsx.
 */
import {
  Search as SearchIcon, Share2, FileText, RefreshCw, CheckCircle, XCircle,
} from 'lucide-react';
import { Icon, Button, cn } from '../ui';
import type { SeoAuditResult, CheckCategory } from './types';
import { CATEGORY_CONFIG } from './types';

// ── Toolbar (search + action buttons) ───────────────────────────

interface ToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  saving: boolean;
  onSaveAndShare: () => void;
  onOpenExportModal: () => void;
  effectiveData: SeoAuditResult;
  appliedFixes: Set<string>;
  bulkApplying: boolean;
  bulkProgress: { done: number; total: number } | null;
  onAcceptAllSuggestions: () => void;
  onCancelBulkApply?: () => void;
  onRunAudit: () => void;
}

export function AuditToolbar({
  search, onSearchChange,
  saving, onSaveAndShare, onOpenExportModal,
  effectiveData, appliedFixes,
  bulkApplying, bulkProgress,
  onAcceptAllSuggestions, onCancelBulkApply, onRunAudit,
}: ToolbarProps) {
  const pendingFixes = effectiveData.pages.reduce((count, page) =>
    count + page.issues.filter(i => i.suggestedFix && !appliedFixes.has(`${page.pageId}-${i.check}`)).length, 0);

  return (
    <div className="sticky top-0 z-[var(--z-sticky)] bg-[var(--surface-1)]/95 backdrop-blur-sm py-2 space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Icon as={SearchIcon} size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search pages or issues..."
            className="w-full pl-10 pr-4 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-body focus:outline-none focus:border-[var(--brand-border-hover)]"
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={onSaveAndShare}
          disabled={saving}
          icon={Share2}
          className="gap-1.5 px-3 py-2 rounded-[var(--radius-lg)] t-caption font-medium bg-teal-400 text-[#0f1219]" /* arbitrary-text-ok: has .dashboard-light override */
        >
          {saving ? 'Saving...' : 'Save & Share'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onOpenExportModal}
          icon={FileText}
          className="gap-1.5 px-3 py-2 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded-[var(--radius-lg)] t-caption font-medium"
        >
          Export
        </Button>
        {pendingFixes > 0 && (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={onAcceptAllSuggestions}
              disabled={bulkApplying}
              icon={CheckCircle}
              className="gap-1.5 px-3 py-2 rounded-[var(--radius-lg)] t-caption font-medium disabled:opacity-50"
              style={{ backgroundColor: 'rgba(16,185,129,0.15)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.3)' }}
            >
              {bulkApplying && bulkProgress
                ? `Applying ${bulkProgress.done}/${bulkProgress.total}...`
                : `Accept All (${pendingFixes})`}
            </Button>
            {bulkApplying && onCancelBulkApply && (
              <Button
                type="button"
                variant="secondary"
                onClick={onCancelBulkApply}
                icon={XCircle}
                className="gap-1.5 px-2 py-2 rounded-[var(--radius-lg)] t-caption font-medium bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
              >
                Cancel
              </Button>
            )}
          </>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={onRunAudit}
          icon={RefreshCw}
          className="gap-1.5 px-3 py-2 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded-[var(--radius-lg)] t-caption font-medium"
        >
          Re-scan
        </Button>
      </div>
    </div>
  );
}

// ── Category filter pills ───────────────────────────────────────

interface CategoryFilterProps {
  categoryFilter: CheckCategory | 'all';
  onSetCategoryFilter: (cat: CheckCategory | 'all') => void;
}

export function AuditCategoryFilter({ categoryFilter, onSetCategoryFilter }: CategoryFilterProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="t-caption-sm text-[var(--brand-text-muted)] uppercase tracking-wider mr-1">Category:</span>
      {(['all', ...Object.keys(CATEGORY_CONFIG)] as (CheckCategory | 'all')[]).map(cat => {
        const active = categoryFilter === cat;
        const cfg = cat !== 'all' ? CATEGORY_CONFIG[cat] : null;
        return (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            key={cat}
            onClick={() => onSetCategoryFilter(active ? 'all' : cat)}
            className={cn('px-2 py-0.5 rounded t-caption-sm font-medium border', active ? 'border-[var(--brand-border)] bg-[var(--surface-2)] text-[var(--brand-text-bright)]' : 'border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:border-[var(--brand-border)] hover:text-[var(--brand-text)]')}
          >
            {cat === 'all' ? 'All' : cfg?.label}
          </Button>
        );
      })}
    </div>
  );
}
