import { Ban, ChevronDown, Undo2 } from 'lucide-react';
import { Button, Icon, SectionCard } from '../../ui';
import type { KeywordFeedbackStatus } from './useStrategyKeywordFeedback';

interface StrategyDeclinedKeywordsSectionProps {
  keywordFeedback: Map<string, KeywordFeedbackStatus>;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
  undoFeedback: (keyword: string) => Promise<void>;
  isLoadingFeedback: (keyword: string) => boolean;
}

export function StrategyDeclinedKeywordsSection({
  keywordFeedback,
  expandedSections,
  toggleSection,
  undoFeedback,
  isLoadingFeedback,
}: StrategyDeclinedKeywordsSectionProps) {
  const declined = [...keywordFeedback.entries()].filter(([, status]) => status === 'declined');
  if (declined.length === 0) return null;

  return (
    <SectionCard noPadding>
      <Button
        onClick={() => toggleSection('declined-keywords')}
        variant="ghost"
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors rounded-none"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-red-500/20 flex items-center justify-center">
            <Icon as={Ban} size="md" className="text-accent-danger" />
          </div>
          <div className="text-left">
            <div className="t-ui font-medium text-[var(--brand-text-bright)]">Not Relevant Keywords</div>
            <div className="t-caption-sm text-[var(--brand-text-muted)]">{declined.length} keywords excluded from future strategies</div>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${expandedSections.has('declined-keywords') ? '' : '-rotate-90'}`} />
      </Button>

      {expandedSections.has('declined-keywords') && (
        <div className="px-4 pb-4 border-t border-[var(--brand-border)]/50">
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-3 mb-3">These keywords won't appear in future strategy recommendations. Click restore to bring them back.</p>
          <div className="flex flex-wrap gap-2">
            {declined.map(([kw]) => (
              <div key={kw} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-lg)] bg-red-500/5 border border-red-500/20">
                <span className="t-caption-sm text-accent-danger">{kw}</span>
                <Button
                  onClick={() => undoFeedback(kw)}
                  disabled={isLoadingFeedback(kw)}
                  variant="ghost"
                  size="sm"
                  icon={Undo2}
                  className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors px-1 py-0.5 disabled:opacity-50"
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
