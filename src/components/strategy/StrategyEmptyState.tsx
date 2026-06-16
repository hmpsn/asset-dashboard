import { Target } from 'lucide-react';
import { SectionCard, Icon } from '../ui';

export function StrategyEmptyState() {
  return (
    <SectionCard noPadding>
      <div className="px-6 py-12 text-center">
        <Icon as={Target} size="2xl" className="text-[var(--brand-text-muted)] mx-auto mb-3" />
        <p className="t-body text-[var(--brand-text)] mb-1">No keyword strategy yet</p>
        <p className="t-caption-sm text-[var(--brand-text-muted)] max-w-md mx-auto">
          Generate an AI-powered keyword strategy based on your site's pages and Google Search Console data.
          This will map target keywords to each page and guide all future AI rewrites.
        </p>
      </div>
    </SectionCard>
  );
}
