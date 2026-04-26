/**
 * ReviewChecklist — Pre-publish review checklist panel with status controls.
 * Extracted from PostEditor.tsx review/approval section.
 */
import { useState } from 'react';
import {
  Check, ChevronDown, ChevronUp, Eye, ClipboardCheck, Square, CheckSquare,
  Sparkles, Loader2,
} from 'lucide-react';
import { SectionCard, Icon } from '../ui';

interface ReviewChecklistState {
  factual_accuracy: boolean;
  brand_voice: boolean;
  internal_links: boolean;
  no_hallucinations: boolean;
  meta_optimized: boolean;
  word_count_target: boolean;
}

const CHECKLIST_ITEMS: { key: keyof ReviewChecklistState; label: string }[] = [
  { key: 'factual_accuracy', label: 'Factual accuracy verified' },
  { key: 'brand_voice', label: 'Brand voice match confirmed' },
  { key: 'internal_links', label: 'Internal links verified and working' },
  { key: 'no_hallucinations', label: 'No AI hallucinations or fabricated statistics' },
  { key: 'meta_optimized', label: 'Meta title/description optimized' },
  { key: 'word_count_target', label: 'Word count within brief target' },
];

const EMPTY_CHECKLIST: ReviewChecklistState = {
  factual_accuracy: false,
  brand_voice: false,
  internal_links: false,
  no_hallucinations: false,
  meta_optimized: false,
  word_count_target: false,
};

export interface AIReviewResult {
  pass: boolean;
  reason: string;
}

export interface ReviewChecklistProps {
  postStatus: 'generating' | 'draft' | 'review' | 'approved';
  reviewChecklist: ReviewChecklistState | undefined;
  showChecklist: boolean;
  onToggleShowChecklist: () => void;
  onToggleItem: (key: keyof ReviewChecklistState) => void;
  onChangeStatus: (status: string) => void;
  onRunAIReview?: () => Promise<Record<string, AIReviewResult> | null>;
}

export function ReviewChecklist({
  postStatus, reviewChecklist, showChecklist,
  onToggleShowChecklist, onToggleItem, onChangeStatus, onRunAIReview,
}: ReviewChecklistProps) {
  const checklist = reviewChecklist ?? EMPTY_CHECKLIST;
  const checkedCount = CHECKLIST_ITEMS.filter(item => checklist[item.key]).length;
  const allChecked = checkedCount === CHECKLIST_ITEMS.length;
  const [aiRunning, setAiRunning] = useState(false);
  const [aiResults, setAiResults] = useState<Record<string, AIReviewResult> | null>(null);

  const handleAIReview = async () => {
    if (!onRunAIReview || aiRunning) return;
    setAiRunning(true);
    setAiResults(null);
    try {
      const results = await onRunAIReview();
      if (results) {
        setAiResults(results);
        // Auto-check items that passed
        for (const item of CHECKLIST_ITEMS) {
          if (results[item.key]?.pass && !checklist[item.key]) {
            onToggleItem(item.key);
          }
        }
      }
    } catch (err) { console.error('ReviewChecklist operation failed:', err); }
    setAiRunning(false);
  };

  return (
    <div className="space-y-3">
      {postStatus === 'draft' && (
        <SectionCard noPadding className="overflow-hidden">
          <button
            onClick={onToggleShowChecklist}
            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-[var(--surface-3)]/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Icon as={ClipboardCheck} size="md" className={allChecked ? 'text-emerald-400/80' : 'text-[var(--brand-text-muted)]'} />
              <span className="text-xs font-medium text-zinc-300">Review Checklist</span>
              <span className={`text-[11px] px-1.5 py-0.5 rounded border ${allChecked ? 'text-emerald-400/80 bg-emerald-500/8 border-emerald-500/20' : 'text-[var(--brand-text-muted)] bg-[var(--surface-3)] border-[var(--brand-border-hover)]'}`}>
                {checkedCount}/{CHECKLIST_ITEMS.length}
              </span>
            </div>
            {showChecklist ? <Icon as={ChevronUp} size="sm" className="text-[var(--brand-text-muted)]" /> : <Icon as={ChevronDown} size="sm" className="text-[var(--brand-text-muted)]" />}
          </button>
          {showChecklist && (
            <div className="px-4 pb-3 space-y-1.5 border-t border-[var(--brand-border)]/50 pt-2.5">
              {onRunAIReview && (
                <button
                  onClick={handleAIReview}
                  disabled={aiRunning}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 mb-2 rounded-lg text-[11px] font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50"
                >
                  <Icon as={aiRunning ? Loader2 : Sparkles} size="sm" className={aiRunning ? 'animate-spin' : ''} />
                  {aiRunning ? 'Running AI Review...' : 'AI Pre-Check'}
                </button>
              )}
              {CHECKLIST_ITEMS.map(item => (
                <div key={item.key}>
                  <button
                    onClick={() => onToggleItem(item.key)}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-[var(--surface-3)]/50 transition-colors group"
                  >
                    {checklist[item.key]
                      ? <Icon as={CheckSquare} size="md" className="text-emerald-400/80 flex-shrink-0" />
                      : <Icon as={Square} size="md" className="text-[var(--brand-text-muted)] group-hover:text-[var(--brand-text)] flex-shrink-0" />}
                    <span className={`text-[11px] ${checklist[item.key] ? 'text-[var(--brand-text-bright)] line-through decoration-[var(--brand-border-hover)]' : 'text-[var(--brand-text)]'}`}>
                      {item.label}
                    </span>
                    {aiResults?.[item.key] && (
                      <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${aiResults[item.key].pass ? 'bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20' : 'bg-amber-500/8 text-amber-400/80 border border-amber-500/20'}`}>
                        {aiResults[item.key].pass ? 'AI: Pass' : 'AI: Review'}
                      </span>
                    )}
                  </button>
                  {aiResults?.[item.key] && (
                    <div className={`ml-8 mr-2 mb-1 px-2 py-1.5 rounded text-[10px] leading-relaxed ${aiResults[item.key].pass ? 'text-[var(--brand-text-muted)]' : 'text-amber-400/80 bg-amber-500/5 border border-amber-500/10'}`}>
                      {aiResults[item.key].reason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      <div className="flex items-center gap-2">
        {postStatus === 'draft' && (
          <button
            onClick={() => onChangeStatus('review')}
            disabled={!allChecked}
            title={allChecked ? 'Send to review' : `Complete all ${CHECKLIST_ITEMS.length} checklist items before sending to review`}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg t-caption-sm font-medium border transition-colors ${
              allChecked
                ? 'bg-cyan-600/20 border-cyan-500/30 text-cyan-300 hover:bg-cyan-600/30'
                : 'bg-[var(--surface-3)]/50 border-[var(--brand-border)]/50 text-[var(--brand-text-muted)] cursor-not-allowed'
            }`}
          >
            <Icon as={Eye} size="sm" /> Send to Review
          </button>
        )}
        {postStatus === 'review' && (
          <>
            <button onClick={() => onChangeStatus('approved')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg t-caption-sm font-medium bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 transition-colors">
              <Icon as={Check} size="sm" /> Approve
            </button>
            <button onClick={() => onChangeStatus('draft')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg t-caption-sm font-medium bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors">
              Back to Draft
            </button>
          </>
        )}
      </div>
    </div>
  );
}
