/**
 * BulkOperations — Bulk operations panel for SEO editor.
 * Extracted from SeoEditor.tsx bulk action sections.
 */
import {
  Loader2, Sparkles, Check, X, Type, ArrowRight, Eye, CheckSquare, Square,
} from 'lucide-react';
import { SectionCard, Icon } from '../ui';

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
        <button onClick={onSelectAll} className="flex items-center gap-1.5 text-xs text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors">
          {approvalSelected.size === filteredPages.length && filteredPages.length > 0 ? <Icon as={CheckSquare} size="md" className="text-teal-400" /> : <Icon as={Square} size="md" />}
          {approvalSelected.size === filteredPages.length && filteredPages.length > 0 ? 'Deselect all' : 'Select all'}
        </button>
        {approvalSelected.size > 0 && <span className="text-xs text-teal-400">{approvalSelected.size} selected</span>}
        {approvalSelected.size > 0 && bulkMode === 'idle' && (
          <>
            <span className="text-[var(--brand-border)]">|</span>
            <button onClick={() => { onSetBulkField('title'); onSetBulkMode('pattern'); }} className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] text-xs text-[var(--brand-text-bright)] transition-colors">
              <Icon as={Type} size="sm" /> Pattern Apply
            </button>
            <button onClick={() => onBulkAiRewrite('both')} className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600 hover:bg-teal-500 text-xs text-white font-medium transition-colors">
              <Icon as={Sparkles} size="sm" /> AI Rewrite Both
            </button>
            <button onClick={() => onBulkAiRewrite('title')} className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600/60 hover:bg-teal-500/80 text-xs text-white transition-colors">
              <Icon as={Sparkles} size="sm" /> Titles Only
            </button>
            <button onClick={() => onBulkAiRewrite('description')} className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600/60 hover:bg-teal-500/80 text-xs text-white transition-colors">
              <Icon as={Sparkles} size="sm" /> Descriptions Only
            </button>
          </>
        )}
      </div>

      {/* Pattern Apply Modal */}
      {bulkMode === 'pattern' && (
        <SectionCard
          title={`Pattern Apply — ${approvalSelected.size} pages`}
          titleIcon={<Icon as={Type} size="md" className="text-teal-400" />}
          action={<button onClick={() => { onSetBulkMode('idle'); onSetPatternText(''); }} className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"><Icon as={X} size="md" /></button>}
          className="!border-teal-500/30"
          noPadding
        >
          <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <select
              value={bulkField}
              onChange={e => onSetBulkField(e.target.value as 'title' | 'description')}
              className="px-2 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded text-xs text-[var(--brand-text-bright)]"
            >
              <option value="title">SEO Title</option>
              <option value="description">Meta Description</option>
            </select>
            <select
              value={patternAction}
              onChange={e => onSetPatternAction(e.target.value as 'append' | 'prepend')}
              className="px-2 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded text-xs text-[var(--brand-text-bright)]"
            >
              <option value="append">Append</option>
              <option value="prepend">Prepend</option>
            </select>
            <input
              type="text"
              value={patternText}
              onChange={e => onSetPatternText(e.target.value)}
              placeholder={patternAction === 'append' ? 'e.g. | Brand Name' : 'e.g. Brand Name |'}
              className="flex-1 px-3 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded text-xs text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500"
              autoFocus
            />
            <button
              onClick={onPreviewPattern}
              disabled={!patternText.trim()}
              className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded text-xs font-medium text-white transition-colors"
            >
              <Icon as={Eye} size="sm" /> Preview
            </button>
          </div>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            {patternAction === 'append' ? 'Text will be added after' : 'Text will be added before'} each page's {bulkField === 'title' ? 'SEO title' : 'meta description'}.
            {bulkField === 'title' && ' Titles will be truncated to 60 characters.'}
          </p>
          </div>
        </SectionCard>
      )}

      {/* Bulk Rewrite Preview / Diff */}
      {bulkMode === 'rewrite-preview' && bulkPreview.length > 0 && (
        <SectionCard
          title={`Preview Changes — ${bulkPreview.length} pages`}
          titleIcon={<Icon as={Eye} size="md" className="text-teal-400" />}
          action={
            <div className="flex items-center gap-2">
              <button onClick={bulkSource === 'ai' ? onApplyBulkRewrite : onApplyPattern} className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded text-xs font-medium text-white transition-colors">
                <Icon as={Check} size="sm" /> Apply All
              </button>
              <button onClick={onClearPreview} className="flex items-center gap-1 px-3 py-1.5 bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] rounded text-xs text-[var(--brand-text-bright)] transition-colors">
                <Icon as={X} size="sm" /> Cancel
              </button>
            </div>
          }
          className="!border-teal-500/30"
          noPadding
        >
          <p className="t-caption-sm text-[var(--brand-text-muted)] px-4 pb-2">Review before applying to Webflow</p>
          <div className="max-h-[350px] overflow-y-auto divide-y divide-[var(--brand-border)]/50">
            {bulkPreview.map(item => {
              const page = pages.find(p => p.id === item.pageId);
              return (
                <div key={item.pageId} className="px-4 py-2.5">
                  <div className="text-xs font-medium text-[var(--brand-text-bright)] mb-1">/{page?.slug || '?'} — {page?.title || ''}</div>
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-start">
                    <div className="t-caption-sm text-red-400/80 bg-red-500/5 rounded px-2 py-1 font-mono leading-relaxed line-through">{item.oldValue || '(empty)'}</div>
                    <Icon as={ArrowRight} size="sm" className="text-[var(--brand-text-muted)] mt-1.5 flex-shrink-0" />
                    <div className="t-caption-sm text-emerald-400/80 bg-emerald-500/5 rounded px-2 py-1 font-mono leading-relaxed">{item.newValue} <span className="text-[var(--brand-text-muted)]">({item.newValue.length})</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Bulk operation progress */}
      {bulkMode === 'rewriting' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-teal-500/10 border border-teal-500/30 rounded-[var(--radius-lg)]">
          <Icon as={Loader2} size="md" className="animate-spin text-teal-400" />
          <div className="flex-1">
            <div className="text-sm text-teal-300">
              {bulkProgress.total > 0 ? `Processing ${bulkProgress.done}/${bulkProgress.total} pages...` : 'Generating AI rewrites...'}
            </div>
            {bulkProgress.total > 0 && (
              <div className="mt-1.5 h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden">
                <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }} />
              </div>
            )}
          </div>
          {onCancelRewrite && (
            <button onClick={onCancelRewrite} className="t-caption-sm text-red-400 hover:text-red-300">Cancel</button>
          )}
        </div>
      )}
    </>
  );
}
