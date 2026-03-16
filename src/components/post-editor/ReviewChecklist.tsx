/**
 * ReviewChecklist — Pre-publish review checklist panel with status controls.
 * Extracted from PostEditor.tsx review/approval section.
 */
import {
  Check, ChevronDown, ChevronUp, Eye, ClipboardCheck, Square, CheckSquare,
} from 'lucide-react';

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

export interface ReviewChecklistProps {
  postStatus: 'generating' | 'draft' | 'review' | 'approved';
  reviewChecklist: ReviewChecklistState | undefined;
  showChecklist: boolean;
  onToggleShowChecklist: () => void;
  onToggleItem: (key: keyof ReviewChecklistState) => void;
  onChangeStatus: (status: string) => void;
}

export function ReviewChecklist({
  postStatus, reviewChecklist, showChecklist,
  onToggleShowChecklist, onToggleItem, onChangeStatus,
}: ReviewChecklistProps) {
  const checklist = reviewChecklist ?? EMPTY_CHECKLIST;
  const checkedCount = CHECKLIST_ITEMS.filter(item => checklist[item.key]).length;
  const allChecked = checkedCount === CHECKLIST_ITEMS.length;

  return (
    <div className="space-y-3">
      {postStatus === 'draft' && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <button
            onClick={onToggleShowChecklist}
            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <ClipboardCheck className={`w-3.5 h-3.5 ${allChecked ? 'text-green-400' : 'text-zinc-500'}`} />
              <span className="text-xs font-medium text-zinc-300">Review Checklist</span>
              <span className={`text-[11px] px-1.5 py-0.5 rounded border ${allChecked ? 'text-green-400 bg-green-500/10 border-green-500/20' : 'text-zinc-500 bg-zinc-800 border-zinc-700'}`}>
                {checkedCount}/{CHECKLIST_ITEMS.length}
              </span>
            </div>
            {showChecklist ? <ChevronUp className="w-3 h-3 text-zinc-500" /> : <ChevronDown className="w-3 h-3 text-zinc-500" />}
          </button>
          {showChecklist && (
            <div className="px-4 pb-3 space-y-1.5 border-t border-zinc-800/50 pt-2.5">
              {CHECKLIST_ITEMS.map(item => (
                <button
                  key={item.key}
                  onClick={() => onToggleItem(item.key)}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-zinc-800/50 transition-colors group"
                >
                  {checklist[item.key]
                    ? <CheckSquare className="w-4 h-4 text-green-400 flex-shrink-0" />
                    : <Square className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 flex-shrink-0" />}
                  <span className={`text-[11px] ${checklist[item.key] ? 'text-zinc-300 line-through decoration-zinc-600' : 'text-zinc-400'}`}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {postStatus === 'draft' && (
          <button
            onClick={() => onChangeStatus('review')}
            disabled={!allChecked}
            title={allChecked ? 'Send to review' : `Complete all ${CHECKLIST_ITEMS.length} checklist items before sending to review`}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
              allChecked
                ? 'bg-cyan-600/20 border-cyan-500/30 text-cyan-300 hover:bg-cyan-600/30'
                : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-600 cursor-not-allowed'
            }`}
          >
            <Eye className="w-3 h-3" /> Send to Review
          </button>
        )}
        {postStatus === 'review' && (
          <>
            <button onClick={() => onChangeStatus('approved')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-green-600/20 border border-green-500/30 text-green-300 hover:bg-green-600/30 transition-colors">
              <Check className="w-3 h-3" /> Approve
            </button>
            <button onClick={() => onChangeStatus('draft')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
              Back to Draft
            </button>
          </>
        )}
      </div>
    </div>
  );
}
