/**
 * BulkOperations — Bulk operations panel for SEO editor.
 * Extracted from SeoEditor.tsx bulk action sections.
 */
import {
  Loader2, Sparkles, Check, X, Type, ArrowRight, Eye, CheckSquare, Square,
} from 'lucide-react';
import { SectionCard, Icon, Button, IconButton, FormInput, FormSelect } from '../ui';
import type { SeoBulkMode, SeoEditorPage } from './seoEditorTypes';

export interface BulkOperationsProps {
  filteredPages: SeoEditorPage[];
  approvalSelected: Set<string>;
  bulkMode: SeoBulkMode;
  bulkField: 'title' | 'description';
  patternAction: 'append' | 'prepend';
  patternText: string;
  bulkPreview: Array<{ pageId: string; oldValue: string; newValue: string }>;
  bulkProgress: { done: number; total: number };
  bulkSource: 'pattern' | 'ai';
  pages: SeoEditorPage[];
  onSelectAll: () => void;
  onSetBulkField: (field: 'title' | 'description') => void;
  onSetBulkMode: (mode: SeoBulkMode) => void;
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
        <Button
          onClick={onSelectAll}
          icon={approvalSelected.size === filteredPages.length && filteredPages.length > 0 ? CheckSquare : Square}
          size="sm"
          variant="ghost"
          className="h-auto px-0 py-0 rounded-none text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:bg-transparent"
        >
          {approvalSelected.size === filteredPages.length && filteredPages.length > 0 ? 'Deselect all' : 'Select all'}
        </Button>
        {approvalSelected.size > 0 && <span className="text-xs text-teal-400">{approvalSelected.size} selected</span>}
        {approvalSelected.size > 0 && bulkMode === 'idle' && (
          <>
            <span className="text-[var(--brand-border)]">|</span>
            <Button
              onClick={() => { onSetBulkField('title'); onSetBulkMode('pattern'); }}
              icon={Type}
              size="sm"
              variant="secondary"
              className="rounded-[var(--radius-lg)]"
            >
              Pattern Apply
            </Button>
            <Button
              onClick={() => onBulkAiRewrite('both')}
              icon={Sparkles}
              size="sm"
              variant="primary"
              className="rounded-[var(--radius-lg)] font-medium"
            >
              AI Rewrite Both
            </Button>
            <Button
              onClick={() => onBulkAiRewrite('title')}
              icon={Sparkles}
              size="sm"
              variant="secondary"
              className="rounded-[var(--radius-lg)]"
            >
              Titles Only
            </Button>
            <Button
              onClick={() => onBulkAiRewrite('description')}
              icon={Sparkles}
              size="sm"
              variant="secondary"
              className="rounded-[var(--radius-lg)]"
            >
              Descriptions Only
            </Button>
          </>
        )}
      </div>

      {/* Pattern Apply Modal */}
      {bulkMode === 'pattern' && (
        <SectionCard
          title={`Pattern Apply — ${approvalSelected.size} pages`}
          titleIcon={<Icon as={Type} size="md" className="text-teal-400" />}
          action={(
            <IconButton
              onClick={() => { onSetBulkMode('idle'); onSetPatternText(''); }}
              icon={X}
              label="Close pattern apply panel"
              size="sm"
            />
          )}
          className="!border-teal-500/30"
          noPadding
        >
          <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FormSelect
              value={bulkField}
              onChange={value => onSetBulkField(value as 'title' | 'description')}
              options={[
                { value: 'title', label: 'SEO Title' },
                { value: 'description', label: 'Meta Description' },
              ]}
              className="px-2 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] text-xs text-[var(--brand-text-bright)]"
            />
            <FormSelect
              value={patternAction}
              onChange={value => onSetPatternAction(value as 'append' | 'prepend')}
              options={[
                { value: 'append', label: 'Append' },
                { value: 'prepend', label: 'Prepend' },
              ]}
              className="px-2 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] text-xs text-[var(--brand-text-bright)]"
            />
            <FormInput
              type="text"
              value={patternText}
              onChange={onSetPatternText}
              placeholder={patternAction === 'append' ? 'e.g. | Brand Name' : 'e.g. Brand Name |'}
              className="flex-1 px-3 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-sm)] text-xs text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500"
              autoFocus
            />
            <Button
              onClick={onPreviewPattern}
              disabled={!patternText.trim()}
              icon={Eye}
              size="sm"
              variant="primary"
              className="rounded-[var(--radius-lg)] font-medium"
            >
              Preview
            </Button>
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
              <Button
                onClick={bulkSource === 'ai' ? onApplyBulkRewrite : onApplyPattern}
                icon={Check}
                size="sm"
                variant="primary"
                className="rounded-[var(--radius-lg)] font-medium"
              >
                Apply All
              </Button>
              <Button
                onClick={onClearPreview}
                icon={X}
                size="sm"
                variant="secondary"
                className="bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] text-[var(--brand-text-bright)]"
              >
                Cancel
              </Button>
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
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-500/10 border border-blue-500/30 rounded-[var(--radius-lg)]">
          <Icon as={Loader2} size="md" className="animate-spin text-blue-400" />
          <div className="flex-1">
            <div className="t-caption text-blue-300">
              {bulkProgress.total > 0 ? `Processing ${bulkProgress.done}/${bulkProgress.total} pages...` : 'Generating AI rewrites...'}
            </div>
            {bulkProgress.total > 0 && (
              <div className="mt-1.5 h-1.5 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
                <div className="h-full bg-blue-500 rounded-[var(--radius-pill)] transition-all" style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }} />
              </div>
            )}
          </div>
          {onCancelRewrite && (
            <Button
              onClick={onCancelRewrite}
              variant="link"
              size="sm"
              className="!text-red-400 no-underline"
            >
              Cancel
            </Button>
          )}
        </div>
      )}
    </>
  );
}
