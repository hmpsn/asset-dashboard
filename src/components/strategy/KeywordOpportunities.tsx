import { Sparkles } from 'lucide-react';
import { Badge, SectionCard, Icon } from '../ui';
import type { KeywordOpportunitiesProps } from './types';

export function KeywordOpportunities({ opportunities }: KeywordOpportunitiesProps) {
  if (opportunities.length === 0) return null;

  return (
    <SectionCard
      title="Keyword Opportunities"
      titleIcon={<Icon as={Sparkles} size="md" className="text-accent-brand" />}
    >
      <p className="text-[var(--brand-text-muted)] t-caption-sm mb-2">
        These opportunities are AI-generated suggestions based on your site's content and competitive landscape. Validate with keyword research before acting.
      </p>
      <div className="space-y-1.5">
        {opportunities.map((opp: string, i: number) => (
          <div key={i} className="flex items-start gap-2 t-caption-sm text-[var(--brand-text)]">
            <Badge label={`${i + 1}`} tone="teal" variant="outline" shape="pill" className="flex-shrink-0 mt-0.5 font-bold" />
            {opp}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
