import { useState } from 'react';
import { Sparkles, Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { SeoSuggestionClient } from '../../api/seo';
import { seoSuggestions } from '../../api/seo';
import { Icon } from '../ui';

interface Props {
  workspaceId: string;
  suggestions: SeoSuggestionClient[];
  counts: { pending: number; selected: number; total: number };
  onRefresh: () => void;
  onApplied: () => void;
}

export function SeoSuggestionsPanel({ workspaceId, suggestions, counts, onRefresh, onApplied }: Props) {
  const [applying, setApplying] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  if (!suggestions.length) return null;

  const handleSelect = async (suggestionId: string, index: number) => {
    setSelectingId(suggestionId);
    try {
      await seoSuggestions.select(workspaceId, suggestionId, index);
      onRefresh();
    } catch (err) {
      console.error('Failed to select variation:', err);
    } finally {
      setSelectingId(null);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      const result = await seoSuggestions.apply(workspaceId);
      onApplied();
      onRefresh();
      if (result.applied > 0) {
        // Success is reflected by suggestions disappearing
      }
    } catch (err) {
      console.error('Failed to apply suggestions:', err);
    } finally {
      setApplying(false);
    }
  };

  const handleDismiss = async () => {
    if (!confirm(`Dismiss all ${suggestions.length} pending suggestions?`)) return;
    setDismissing(true);
    try {
      await seoSuggestions.dismiss(workspaceId);
      onRefresh();
    } catch (err) {
      console.error('Failed to dismiss suggestions:', err);
    } finally {
      setDismissing(false);
    }
  };

  const titleSuggestions = suggestions.filter(s => s.field === 'title');
  const descSuggestions = suggestions.filter(s => s.field === 'description');
  const readyToApply = suggestions.filter(s => s.selectedIndex !== null).length;

  return (
    <div className="border border-teal-500/30 bg-teal-500/5 rounded-[var(--radius-lg)] overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-teal-500/10 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <Icon as={Sparkles} size="md" className="text-teal-400" />
          <span className="text-sm font-medium text-teal-300">
            AI Suggestions
          </span>
          <span className="text-xs text-[var(--brand-text)]">
            {counts.pending} pending
            {titleSuggestions.length > 0 && ` · ${titleSuggestions.length} title${titleSuggestions.length !== 1 ? 's' : ''}`}
            {descSuggestions.length > 0 && ` · ${descSuggestions.length} description${descSuggestions.length !== 1 ? 's' : ''}`}
          </span>
          {readyToApply > 0 && (
            <span className="px-2 py-0.5 t-micro font-medium bg-teal-500/20 text-teal-300 rounded-full">
              {readyToApply} selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {readyToApply > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); handleApply(); }}
              disabled={applying}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Icon as={applying ? Loader2 : Check} size="sm" className={applying ? 'animate-spin' : ''} />
              Apply {readyToApply} to Webflow
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
            disabled={dismissing}
            className="text-xs text-[var(--brand-text-muted)] hover:text-red-400 transition-colors px-2 py-1"
          >
            {dismissing ? <Icon as={Loader2} size="sm" className="animate-spin" /> : 'Dismiss All'}
          </button>
          <Icon as={collapsed ? ChevronDown : ChevronUp} size="md" className="text-[var(--brand-text-muted)]" />
        </div>
      </div>

      {/* Suggestion rows */}
      {!collapsed && (
        <div className="divide-y divide-[var(--brand-border)]/50 max-h-[60vh] overflow-y-auto">
          {suggestions.map(s => (
            <SuggestionRow
              key={s.id}
              suggestion={s}
              isSelecting={selectingId === s.id}
              onSelect={(index) => handleSelect(s.id, index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionRow({ suggestion: s, isSelecting, onSelect }: {
  suggestion: SeoSuggestionClient;
  isSelecting: boolean;
  onSelect: (index: number) => void;
}) {
  const maxLen = s.field === 'description' ? 160 : 60;
  const fieldLabel = s.field === 'title' ? 'Title' : 'Description';

  return (
    <div className="px-4 py-3 space-y-2">
      {/* Page info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--brand-text-bright)] truncate max-w-[300px]">
            {s.pageTitle}
          </span>
          <span className="t-micro text-[var(--brand-text-muted)]">/{s.pageSlug}</span>
          <span className={`t-micro px-1.5 py-0.5 rounded ${s.field === 'title' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>
            {fieldLabel}
          </span>
        </div>
        {s.selectedIndex !== null && (
          <span className="t-micro text-teal-400 flex items-center gap-1">
            <Icon as={Check} size="sm" /> Option {s.selectedIndex + 1} selected
          </span>
        )}
      </div>

      {/* Current value */}
      <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">
        Current: {s.currentValue || '(empty)'}
      </div>

      {/* 3 variation options */}
      <div className="grid gap-1.5">
        {s.variations.map((v, i) => {
          const isSelected = s.selectedIndex === i;
          const charCount = v.length;
          const isOver = charCount > maxLen;
          return (
            <button
              key={i}
              onClick={() => onSelect(i)}
              disabled={isSelecting}
              className={`flex items-start gap-2 px-3 py-2 rounded-lg text-left text-xs transition-all ${
                isSelected
                  ? 'bg-teal-500/15 border border-teal-500/40 text-[var(--brand-text-bright)]'
                  : 'bg-[var(--surface-2)]/50 border border-[var(--brand-border)] text-[var(--brand-text)] hover:border-[var(--brand-border-hover)] hover:text-[var(--brand-text-bright)]'
              }`}
            >
              <span className={`shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center t-micro font-bold ${
                isSelected ? 'bg-teal-500 text-white' : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)]'
              }`}>
                {isSelected ? <Icon as={Check} size="sm" /> : i + 1}
              </span>
              <span className="flex-1 leading-relaxed">{v}</span>
              <span className={`shrink-0 t-micro mt-0.5 ${isOver ? 'text-red-400/80' : 'text-[var(--brand-text-muted)]'}`}>
                {charCount}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
