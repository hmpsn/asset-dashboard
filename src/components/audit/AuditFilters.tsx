/**
 * AuditFilters — search input, severity filter, category filter pills, and toolbar actions.
 * Extracted from SeoAudit.tsx.
 */
import {
  Search as SearchIcon, Share2, FileText, RefreshCw, CheckCircle, Loader2,
} from 'lucide-react';
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
  onRunAudit: () => void;
}

export function AuditToolbar({
  search, onSearchChange,
  saving, onSaveAndShare, onOpenExportModal,
  effectiveData, appliedFixes,
  bulkApplying, bulkProgress,
  onAcceptAllSuggestions, onRunAudit,
}: ToolbarProps) {
  const pendingFixes = effectiveData.pages.reduce((count, page) =>
    count + page.issues.filter(i => i.suggestedFix && !appliedFixes.has(`${page.pageId}-${i.check}`)).length, 0);

  return (
    <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm py-2 space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search pages or issues..."
            className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-600"
          />
        </div>
        <button
          onClick={onSaveAndShare}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors bg-teal-400 text-[#0f1219]"
        >
          <Share2 className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save & Share'}
        </button>
        <button
          onClick={onOpenExportModal}
          className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-medium transition-colors"
        >
          <FileText className="w-3.5 h-3.5" /> Export
        </button>
        {pendingFixes > 0 && (
          <button
            onClick={onAcceptAllSuggestions}
            disabled={bulkApplying}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'rgba(16,185,129,0.15)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.3)' }}
          >
            <CheckCircle className="w-3.5 h-3.5" />
            {bulkApplying && bulkProgress
              ? `Applying ${bulkProgress.done}/${bulkProgress.total}...`
              : `Accept All (${pendingFixes})`}
          </button>
        )}
        <button
          onClick={onRunAudit}
          className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-medium transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Re-scan
        </button>
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
      <span className="text-[11px] text-zinc-500 uppercase tracking-wider mr-1">Category:</span>
      {(['all', ...Object.keys(CATEGORY_CONFIG)] as (CheckCategory | 'all')[]).map(cat => {
        const active = categoryFilter === cat;
        const cfg = cat !== 'all' ? CATEGORY_CONFIG[cat] : null;
        return (
          <button
            key={cat}
            onClick={() => onSetCategoryFilter(active ? 'all' : cat)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors border ${
              active
                ? 'border-zinc-500 bg-zinc-800 text-zinc-200'
                : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'
            }`}
          >
            {cat === 'all' ? 'All' : cfg?.label}
          </button>
        );
      })}
    </div>
  );
}
