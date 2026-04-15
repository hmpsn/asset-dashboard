/**
 * BulkOperations — Bulk operations panel for SEO editor.
 * Extracted from SeoEditor.tsx bulk action sections.
 */
import {
  Loader2, Sparkles, Check, X, Type, ArrowRight, Eye, CheckSquare, Square,
} from 'lucide-react';

interface PageMeta {
  id: string;
  title: string;
  slug: string;
  publishedPath?: string | null;
  seo?: { title?: string | null; description?: string | null };
  source?: 'static' | 'cms';
  collectionId?: string;
}

export interface BulkOperationsProps {
  filteredPages: PageMeta[];
  approvalSelected: Set<string>;
  bulkMode: 'idle' | 'pattern' | 'rewrite-preview' | 'rewriting';
  bulkField: 'title' | 'description';
  patternAction: 'append' | 'prepend';
  patternText: string;
  bulkPreview: Array<{ pageId: string; oldValue: string; newValue: string }>;
  bulkProgress: { done: number; total: number };
  bulkSource: 'pattern' | 'ai';
  pages: PageMeta[];
  onSelectAll: () => void;
  onSetBulkField: (field: 'title' | 'description') => void;
  onSetBulkMode: (mode: 'idle' | 'pattern' | 'rewrite-preview' | 'rewriting') => void;
  onSetPatternAction: (action: 'append' | 'prepend') => void;
  onSetPatternText: (text: string) => void;
  onPreviewPattern: () => void;
  onApplyPattern: () => void;
  onApplyBulkRewrite: () => void;
  onBulkAiRewrite: (field: 'title' | 'description' | 'both') => void;
  onClearPreview: () => void;
  onCancelRewrite?: () => void;
}

export function BulkOperations({
  filteredPages, approvalSelected, bulkMode, bulkField, patternAction, patternText,
  bulkPreview, bulkProgress, bulkSource, pages,
  onSelectAll, onSetBulkField, onSetBulkMode, onSetPatternAction, onSetPatternText,
  onPreviewPattern, onApplyPattern, onApplyBulkRewrite, onBulkAiRewrite, onClearPreview,
  onCancelRewrite,
}: BulkOperationsProps) {
  return (
    <>
      {/* Select all + bulk actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onSelectAll} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
          {approvalSelected.size === filteredPages.length && filteredPages.length > 0 ? <CheckSquare className="w-3.5 h-3.5 text-teal-400" /> : <Square className="w-3.5 h-3.5" />}
          {approvalSelected.size === filteredPages.length && filteredPages.length > 0 ? 'Deselect all' : 'Select all'}
        </button>
        {approvalSelected.size > 0 && <span className="text-xs text-teal-400">{approvalSelected.size} selected</span>}
        {approvalSelected.size > 0 && bulkMode === 'idle' && (
          <>
            <span className="text-zinc-700">|</span>
            <button onClick={() => { onSetBulkField('title'); onSetBulkMode('pattern'); }} className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition-colors">
              <Type className="w-3 h-3" /> Pattern Apply
            </button>
            <button onClick={() => onBulkAiRewrite('both')} className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600 hover:bg-teal-500 text-xs text-white font-medium transition-colors">
              <Sparkles className="w-3 h-3" /> AI Rewrite Both
            </button>
            <button onClick={() => onBulkAiRewrite('title')} className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600/60 hover:bg-teal-500/80 text-xs text-white transition-colors">
              <Sparkles className="w-3 h-3" /> Titles Only
            </button>
            <button onClick={() => onBulkAiRewrite('description')} className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600/60 hover:bg-teal-500/80 text-xs text-white transition-colors">
              <Sparkles className="w-3 h-3" /> Descriptions Only
            </button>
          </>
        )}
      </div>

      {/* Pattern Apply Modal */}
      {bulkMode === 'pattern' && (
        <div className="bg-zinc-900 rounded-xl border border-teal-500/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Type className="w-4 h-4 text-teal-400" /> Pattern Apply — {approvalSelected.size} pages
            </h4>
            <button onClick={() => { onSetBulkMode('idle'); onSetPatternText(''); }} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={bulkField}
              onChange={e => onSetBulkField(e.target.value as 'title' | 'description')}
              className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200"
            >
              <option value="title">SEO Title</option>
              <option value="description">Meta Description</option>
            </select>
            <select
              value={patternAction}
              onChange={e => onSetPatternAction(e.target.value as 'append' | 'prepend')}
              className="px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200"
            >
              <option value="append">Append</option>
              <option value="prepend">Prepend</option>
            </select>
            <input
              type="text"
              value={patternText}
              onChange={e => onSetPatternText(e.target.value)}
              placeholder={patternAction === 'append' ? 'e.g. | Brand Name' : 'e.g. Brand Name |'}
              className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
              autoFocus
            />
            <button
              onClick={onPreviewPattern}
              disabled={!patternText.trim()}
              className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded text-xs font-medium text-white transition-colors"
            >
              <Eye className="w-3 h-3" /> Preview
            </button>
          </div>
          <p className="text-[11px] text-zinc-500">
            {patternAction === 'append' ? 'Text will be added after' : 'Text will be added before'} each page's {bulkField === 'title' ? 'SEO title' : 'meta description'}.
            {bulkField === 'title' && ' Titles will be truncated to 60 characters.'}
          </p>
        </div>
      )}

      {/* Bulk Rewrite Preview / Diff */}
      {bulkMode === 'rewrite-preview' && bulkPreview.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-teal-500/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <Eye className="w-4 h-4 text-teal-400" /> Preview Changes — {bulkPreview.length} pages
              </h4>
              <p className="text-[11px] text-zinc-500 mt-0.5">Review before applying to Webflow</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={bulkSource === 'ai' ? onApplyBulkRewrite : onApplyPattern} className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded text-xs font-medium text-white transition-colors">
                <Check className="w-3 h-3" /> Apply All
              </button>
              <button onClick={onClearPreview} className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs text-zinc-300 transition-colors">
                <X className="w-3 h-3" /> Cancel
              </button>
            </div>
          </div>
          <div className="max-h-[350px] overflow-y-auto divide-y divide-zinc-800/50">
            {bulkPreview.map(item => {
              const page = pages.find(p => p.id === item.pageId);
              return (
                <div key={item.pageId} className="px-4 py-2.5">
                  <div className="text-xs font-medium text-zinc-300 mb-1">/{page?.slug || '?'} — {page?.title || ''}</div>
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
                    <div className="text-[11px] text-red-400/80 bg-red-500/5 rounded px-2 py-1 font-mono leading-relaxed line-through">{item.oldValue || '(empty)'}</div>
                    <ArrowRight className="w-3 h-3 text-zinc-500 mt-1.5 flex-shrink-0" />
                    <div className="text-[11px] text-green-400/80 bg-green-500/5 rounded px-2 py-1 font-mono leading-relaxed">{item.newValue} <span className="text-zinc-500">({item.newValue.length})</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bulk operation progress */}
      {bulkMode === 'rewriting' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-teal-500/10 border border-teal-500/30 rounded-lg">
          <Loader2 className="w-4 h-4 animate-spin text-teal-400" />
          <div className="flex-1">
            <div className="text-sm text-teal-300">
              {bulkProgress.total > 0 ? `Processing ${bulkProgress.done}/${bulkProgress.total} pages...` : 'Generating AI rewrites...'}
            </div>
            {bulkProgress.total > 0 && (
              <div className="mt-1.5 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }} />
              </div>
            )}
          </div>
          {onCancelRewrite && (
            <button onClick={onCancelRewrite} className="text-[11px] text-red-400 hover:text-red-300">Cancel</button>
          )}
        </div>
      )}
    </>
  );
}
