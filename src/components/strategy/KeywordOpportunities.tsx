import { Sparkles, ArrowUpRight } from 'lucide-react';
import { Badge, Button, SectionCard, Icon, IconButton } from '../ui';
import { adminPath } from '../../routes';
import { buildHubDeepLinkQuery } from '../../lib/keywordHubDeepLink';
import { useShowMore } from '../../hooks/useShowMore';
import type { KeywordOpportunitiesProps } from './types';

export function KeywordOpportunities({ opportunities, workspaceId, navigate, maxVisible }: KeywordOpportunitiesProps) {
  const { visible, hiddenCount, expanded, toggle, canExpand } = useShowMore(opportunities, maxVisible);

  if (opportunities.length === 0) return null;

  const showExplore = !!(workspaceId && navigate);

  return (
    <SectionCard
      title="Keyword Opportunities"
      titleIcon={<Icon as={Sparkles} size="md" className="text-accent-brand" />}
    >
      <p className="text-[var(--brand-text-muted)] t-caption-sm mb-2">
        These opportunities are AI-generated suggestions based on your site's content and competitive landscape. Validate with keyword research before acting.
      </p>
      <div className="space-y-1.5">
        {visible.map((opp: string, i: number) => {
          if (!showExplore) {
            return (
              <div key={i} className="flex items-start gap-2 t-caption-sm text-[var(--brand-text)]">
                <Badge label={`${i + 1}`} tone="teal" variant="outline" shape="pill" className="flex-shrink-0 mt-0.5 font-bold" />
                {opp}
              </div>
            );
          }
          return (
            <div key={i} className="flex items-start gap-2 t-caption-sm text-[var(--brand-text)]">
              <Badge label={`${i + 1}`} tone="teal" variant="outline" shape="pill" className="flex-shrink-0 mt-0.5 font-bold" />
              <span className="flex-1">{opp}</span>
              <IconButton
                onClick={() => navigate!(adminPath(workspaceId!, 'seo-keywords') + buildHubDeepLinkQuery({ keyword: opp }))}
                title="Explore in Hub"
                label="Explore in Hub"
                icon={ArrowUpRight}
                size="sm"
                variant="ghost"
                className="flex-shrink-0 text-[var(--brand-text-muted)] hover:text-accent-brand"
              />
            </div>
          );
        })}
      </div>
      {canExpand && (
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          aria-expanded={expanded}
          className="mt-3 w-full text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </Button>
      )}
    </SectionCard>
  );
}
