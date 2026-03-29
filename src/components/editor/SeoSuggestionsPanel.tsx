import { useState } from 'react';
import { Sparkles, Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { SeoSuggestionClient } from '../../api/seo';
import { seoSuggestions } from '../../api/seo';

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
    <div className="border border-teal-500/30 bg-teal-500/5 rounded-xl overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-teal-500/10 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-medium text-teal-300">
            AI Suggestions
          </span>
          <span className="text-xs text-zinc-400">
            {counts.pending} pending
            {titleSuggestions.length > 0 && ` · ${titleSuggestions.length} title${titleSuggestions.length !== 1 ? 's' : ''}`}
            {descSuggestions.length > 0 && ` · ${descSuggestions.length} description${descSuggestions.length !== 1 ? 's' : ''}`}
          </span>
          {readyToApply > 0 && (
            <span className="px-2 py-0.5 text-[10px] font-medium bg-teal-500/20 text-teal-300 rounded-full">
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
              {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Apply {readyToApply} to Webflow
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
            disabled={dismissing}
            className="text-xs text-zinc-500 hover:text-red-400 transition-colors px-2 py-1"
          >
            {dismissing ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Dismiss All'}
          </button>
          {collapsed ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronUp className="w-4 h-4 text-zinc-500" />}
        </div>
      </div>

      {/* Suggestion rows */}
      {!collapsed && (
        <div className="divide-y divide-zinc-800/50 max-h-[60vh] overflow-y-auto">
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
          <span className="text-xs font-medium text-zinc-300 truncate max-w-[300px]">
            {s.pageTitle}
          </span>
          <span className="text-[10px] text-zinc-600">/{s.pageSlug}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.field === 'title' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>
            {fieldLabel}
          </span>
        </div>
        {s.selectedIndex !== null && (
          <span className="text-[10px] text-teal-400 flex items-center gap-1">
            <Check className="w-3 h-3" /> Option {s.selectedIndex + 1} selected
          </span>
        )}
      </div>

      {/* Current value */}
      <div className="text-[11px] text-zinc-500 truncate">
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
                  ? 'bg-teal-500/15 border border-teal-500/40 text-zinc-200'
                  : 'bg-zinc-900/50 border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
              }`}
            >
              <span className={`shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                isSelected ? 'bg-teal-500 text-white' : 'bg-zinc-800 text-zinc-500'
              }`}>
                {isSelected ? <Check className="w-3 h-3" /> : i + 1}
              </span>
              <span className="flex-1 leading-relaxed">{v}</span>
              <span className={`shrink-0 text-[10px] mt-0.5 ${isOver ? 'text-red-400/80' : 'text-zinc-600'}`}>
                {charCount}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
