import { FileText, Target, Zap } from 'lucide-react';
import { Button, Icon, SectionCard } from '../../ui';

interface StrategyNextStepsSectionProps {
  contentGapsFound: number;
  totalPageImprovements: number;
  strategyKeywordCount: number;
  showPageImprovements: boolean;
  onReviewIdeas: () => void;
  onReviewPages: () => void;
  onManageKeywords: () => void;
}

export function StrategyNextStepsSection({
  contentGapsFound,
  totalPageImprovements,
  strategyKeywordCount,
  showPageImprovements,
  onReviewIdeas,
  onReviewPages,
  onManageKeywords,
}: StrategyNextStepsSectionProps) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="t-page font-semibold text-[var(--brand-text-bright)]">Recommended Next Steps</h3>
        <p className="t-body text-[var(--brand-text-muted)] mt-1">Start here. These are the clearest places to review, request, or give direction.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SectionCard variant="subtle">
          <div className="flex h-full flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-[var(--radius-lg)] bg-teal-500/20 flex items-center justify-center flex-shrink-0">
                <Icon as={FileText} size="lg" className="text-accent-brand" />
              </div>
              <div className="min-w-0">
                <div className="t-ui font-medium text-[var(--brand-text-bright)]">Review new content ideas</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{contentGapsFound} strongest content recommendations</div>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={onReviewIdeas} className="self-start">
              Review Ideas
            </Button>
          </div>
        </SectionCard>

        {showPageImprovements && (
          <SectionCard variant="subtle">
            <div className="flex h-full flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-[var(--radius-lg)] bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Icon as={Zap} size="lg" className="text-accent-warning" />
                </div>
                <div className="min-w-0">
                  <div className="t-ui font-medium text-[var(--brand-text-bright)]">Improve existing pages</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">{totalPageImprovements} page improvements to work through</div>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={onReviewPages} className="self-start">
                Review Pages
              </Button>
            </div>
          </SectionCard>
        )}

        <SectionCard variant="subtle">
          <div className="flex h-full flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-[var(--radius-lg)] bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Icon as={Target} size="lg" className="text-accent-info" />
              </div>
              <div className="min-w-0">
                <div className="t-ui font-medium text-[var(--brand-text-bright)]">Guide strategy keywords</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{strategyKeywordCount} keywords shaping the strategy</div>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={onManageKeywords} className="self-start">
              Manage Keywords
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
