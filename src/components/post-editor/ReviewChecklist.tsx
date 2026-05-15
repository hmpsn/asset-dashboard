/**
 * ReviewChecklist — Pre-publish review checklist panel with status controls.
 * Extracted from PostEditor.tsx review/approval section.
 */
import { useState } from 'react';
import {
  Check, ChevronDown, ChevronUp, Eye, ClipboardCheck, Square, CheckSquare,
  Sparkles, Loader2, ExternalLink,
} from 'lucide-react';
import { SectionCard, Icon, Button, ClickableRow } from '../ui';
import {
  type AIReviewMap,
  type AIReviewResponse,
  type ContentReviewEvidence,
  PROVENANCE_SENSITIVE_REVIEW_KEYS,
  type ReviewChecklistKey,
} from '../../../shared/types/content';

type ReviewChecklistState = Record<ReviewChecklistKey, boolean>;

const provenanceSensitiveKeys = new Set<ReviewChecklistKey>(PROVENANCE_SENSITIVE_REVIEW_KEYS);

interface ChecklistItem {
  key: ReviewChecklistKey;
  label: string;
}

export const CHECKLIST_ITEMS: ChecklistItem[] = [
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
  postStatus: 'generating' | 'draft' | 'review' | 'approved' | 'error';
  reviewChecklist: ReviewChecklistState | undefined;
  showChecklist: boolean;
  onToggleShowChecklist: () => void;
  onToggleItem: (key: ReviewChecklistKey) => void;
  onChangeStatus: (status: string) => void;
  onRunAIReview?: () => Promise<AIReviewResponse | null>;
  onRequestFix?: (issueKey: string, reason: string) => Promise<void>;
  evidence?: ContentReviewEvidence;
}

export function ReviewChecklist({
  postStatus, reviewChecklist, showChecklist,
  onToggleShowChecklist, onToggleItem, onChangeStatus, onRunAIReview, onRequestFix, evidence,
}: ReviewChecklistProps) {
  const checklist = reviewChecklist ?? EMPTY_CHECKLIST;
  const checkedCount = CHECKLIST_ITEMS.filter(item => checklist[item.key]).length;
  const allChecked = checkedCount === CHECKLIST_ITEMS.length;
  const [aiRunning, setAiRunning] = useState(false);
  const [aiResults, setAiResults] = useState<AIReviewMap | null>(null);
  const [reviewEvidence, setReviewEvidence] = useState<ContentReviewEvidence | undefined>(undefined);
  const [fixingKey, setFixingKey] = useState<string | null>(null);
  const evidenceToShow = reviewEvidence ?? evidence;

  const handleFixThis = async (issueKey: string, reason: string) => {
    if (!onRequestFix || fixingKey) return;
    setFixingKey(issueKey);
    try {
      await onRequestFix(issueKey, reason);
    } finally {
      setFixingKey(null);
    }
  };

  const handleAIReview = async () => {
    if (!onRunAIReview || aiRunning) return;
    setAiRunning(true);
    setAiResults(null);
    try {
      const response = await onRunAIReview();
      if (response) {
        const results = response.review;
        setAiResults(results);
        setReviewEvidence(response.evidence);
        // Auto-check objective items that passed. Provenance-sensitive checks need
        // human source verification even when AI finds no obvious issues.
        for (const item of CHECKLIST_ITEMS) {
          const result = results[item.key];
          if (
            result?.pass &&
            !result.humanReviewRequired &&
            // Defense-in-depth: server sets humanReviewRequired, client Set guards regressions.
            !provenanceSensitiveKeys.has(item.key) &&
            !checklist[item.key]
          ) {
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
          <ClickableRow
            onClick={onToggleShowChecklist}
            className="px-4 py-2.5 flex items-center justify-between hover:bg-[var(--surface-3)]/50"
          >
            <div className="flex items-center gap-2">
              <Icon as={ClipboardCheck} size="md" className={allChecked ? 'text-emerald-400/80' : 'text-[var(--brand-text-muted)]'} />
              <span className="text-xs font-medium text-[var(--brand-text)]">Review Checklist</span>
              <span className={`t-caption-sm px-1.5 py-0.5 rounded border ${allChecked ? 'text-emerald-400/80 bg-emerald-500/8 border-emerald-500/20' : 'text-[var(--brand-text-muted)] bg-[var(--surface-3)] border-[var(--brand-border-hover)]'}`}>
                {checkedCount}/{CHECKLIST_ITEMS.length}
              </span>
            </div>
            {showChecklist ? <Icon as={ChevronUp} size="sm" className="text-[var(--brand-text-muted)]" /> : <Icon as={ChevronDown} size="sm" className="text-[var(--brand-text-muted)]" />}
          </ClickableRow>
          {showChecklist && (
            <div className="px-4 pb-3 space-y-1.5 border-t border-[var(--brand-border)]/50 pt-2.5">
              {onRunAIReview && (
                <Button
                  onClick={handleAIReview}
                  disabled={aiRunning}
                  size="sm"
                  className="w-full mb-2 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30"
                >
                  <Icon as={aiRunning ? Loader2 : Sparkles} size="sm" className={aiRunning ? 'animate-spin' : ''} />
                  {aiRunning ? 'Running AI Review...' : 'AI Pre-Check'}
                </Button>
              )}
              {evidenceToShow && (
                <div className="mb-2 rounded-[var(--radius-lg)] border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="t-caption-sm font-medium text-blue-300">SERP Evidence</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">Reviewer support</span>
                  </div>
                  <p className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">{evidenceToShow.note}</p>
                  {evidenceToShow.peopleAlsoAsk.length > 0 && (
                    <div className="mt-2">
                      <p className="t-caption-sm text-[var(--brand-text)]">People Also Ask</p>
                      <ul className="mt-1 space-y-0.5 list-disc pl-4 text-[var(--brand-text-muted)]">
                        {evidenceToShow.peopleAlsoAsk.map(question => (
                          <li key={question} className="t-caption-sm">{question}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {evidenceToShow.topResults.length > 0 && (
                    <div className="mt-2">
                      <p className="t-caption-sm text-[var(--brand-text)]">Top Results</p>
                      <ul className="mt-1 space-y-1">
                        {evidenceToShow.topResults.map(result => (
                          <li key={`${result.position}-${result.url}`} className="t-caption-sm text-[var(--brand-text-muted)]">
                            <a href={result.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-blue-300 hover:text-blue-200">
                              <span className="shrink-0">#{result.position}</span>
                              <span className="truncate">{result.title}</span>
                              <Icon as={ExternalLink} size="xs" className="shrink-0" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {CHECKLIST_ITEMS.map(item => (
                <div key={item.key}>
                  <Button
                    onClick={() => onToggleItem(item.key)}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2.5 px-2 py-1.5 rounded-[var(--radius-lg)] text-left hover:bg-[var(--surface-3)]/50 group"
                  >
                    {checklist[item.key]
                      ? <Icon as={CheckSquare} size="md" className="text-emerald-400/80 flex-shrink-0" />
                      : <Icon as={Square} size="md" className="text-[var(--brand-text-muted)] group-hover:text-[var(--brand-text)] flex-shrink-0" />}
                    <span className={`t-caption-sm ${checklist[item.key] ? 'text-[var(--brand-text-bright)] line-through decoration-[var(--brand-border-hover)]' : 'text-[var(--brand-text)]'}`}>
                      {item.label}
                    </span>
                    {aiResults?.[item.key] && (
                      <span className={`ml-auto t-caption-sm px-1.5 py-0.5 rounded ${aiResults[item.key].pass ? 'bg-emerald-500/8 text-emerald-400/80 border border-emerald-500/20' : 'bg-amber-500/8 text-amber-400/80 border border-amber-500/20'}`}>
                        {aiResults[item.key].humanReviewRequired ? 'Human review' : aiResults[item.key].pass ? 'AI: Pass' : 'AI: Review'}
                      </span>
                    )}
                  </Button>
                  {aiResults?.[item.key] && (
                    <div className={`ml-8 mr-2 mb-1 px-2 py-1.5 rounded t-caption-sm ${aiResults[item.key].pass ? 'text-[var(--brand-text-muted)]' : 'text-amber-400/80 bg-amber-500/5 border border-amber-500/10'}`}>
                      {aiResults[item.key].reason}
                      {aiResults[item.key].claimsToVerify?.length ? (
                        <ul className="mt-1 space-y-0.5 list-disc pl-4 text-[var(--brand-text-muted)]">
                          {aiResults[item.key].claimsToVerify!.map(claim => (
                            <li key={claim}>{claim}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )}
                  {aiResults?.[item.key] && !aiResults[item.key].pass && !aiResults[item.key].humanReviewRequired && onRequestFix && (
                    <div className="ml-8 mr-2 mb-1">
                      <Button
                        onClick={() => handleFixThis(item.key, aiResults![item.key].reason)}
                        disabled={fixingKey !== null}
                        size="sm"
                        className="px-2 py-1 rounded t-caption-sm bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30"
                      >
                        {fixingKey === item.key
                          ? <><Icon as={Loader2} size="sm" className="animate-spin" /> Fixing…</>
                          : 'Fix this'}
                      </Button>
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
          <Button
            onClick={() => onChangeStatus('review')}
            disabled={!allChecked}
            title={allChecked ? 'Send to review' : `Complete all ${CHECKLIST_ITEMS.length} checklist items before sending to review`}
            size="sm"
            className={`rounded-[var(--radius-lg)] t-caption-sm font-medium border ${
              allChecked
                ? 'bg-cyan-600/20 border-cyan-500/30 text-cyan-300 hover:bg-cyan-600/30'
                : 'bg-[var(--surface-3)]/50 border-[var(--brand-border)]/50 text-[var(--brand-text-muted)] cursor-not-allowed'
            }`}
          >
            <Icon as={Eye} size="sm" /> Send to Review
          </Button>
        )}
        {postStatus === 'review' && (
          <>
            <Button onClick={() => onChangeStatus('approved')} size="sm" className="rounded-[var(--radius-lg)] t-caption-sm font-medium bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30">
              <Icon as={Check} size="sm" /> Approve
            </Button>
            <Button onClick={() => onChangeStatus('draft')} size="sm" className="rounded-[var(--radius-lg)] t-caption-sm font-medium bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]">
              Back to Draft
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
