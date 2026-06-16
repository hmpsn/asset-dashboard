import { Sparkles } from 'lucide-react';
import { Icon } from '../ui';
import type { StrategyHowItWorksProps } from './types';

export function StrategyHowItWorks({ displayedSeoDataMode, hasAnyRanking }: StrategyHowItWorksProps) {
  return (
    <div className="bg-[var(--surface-3)]/30 rounded-[var(--radius-lg)] border border-[var(--brand-border)] px-4 py-3">
      <div className="flex items-start gap-2">
        <Icon as={Sparkles} size="md" className="text-accent-brand mt-0.5 flex-shrink-0" />
        <div className="t-caption-sm text-[var(--brand-text-muted)]">
          <strong className="text-[var(--brand-text)]">How it works:</strong> This strategy is automatically used when you generate AI rewrites
          in the Edit SEO and CMS SEO tabs. The AI will incorporate your target keywords naturally into titles and descriptions.
          Use <strong className="text-accent-brand">Page Intelligence</strong> to analyze individual pages, edit keywords, and generate SEO copy.
          {displayedSeoDataMode && displayedSeoDataMode !== 'none' && (
            <span className="block mt-1 text-accent-orange">
              DataForSEO data: Keywords enriched with real search volume and difficulty. Cached for 7 days.
            </span>
          )}
          {!hasAnyRanking && (
            <span className="block mt-1 text-accent-warning">
              Tip: Connect Google Search Console to see ranking positions and get data-driven keyword suggestions.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
