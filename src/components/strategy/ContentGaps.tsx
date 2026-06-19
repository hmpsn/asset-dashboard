import { useNavigate } from 'react-router-dom';
import { Badge, Button, Icon, SectionCard, StatusBadge, type BadgeTone } from '../ui';
import { FileText, Sparkles } from 'lucide-react';
import { ContentGapRow } from '../shared/ContentGapRow';
import { adminPath } from '../../routes';
import { useShowMore } from '../../hooks/useShowMore';

interface ContentGap {
  topic: string;
  targetKeyword: string;
  intent: string;
  priority: string;
  rationale: string;
  suggestedPageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
  volume?: number;
  difficulty?: number;
  impressions?: number;
  competitorProof?: string;
  trendDirection?: 'rising' | 'declining' | 'stable';
  serpFeatures?: string[];
  serpTargeting?: string[];
  questionKeywords?: string[];
  opportunityScore?: number;
}

const intentTone = (intent?: string): BadgeTone => {
  switch (intent) {
    case 'commercial': return 'blue';
    case 'informational': return 'emerald';
    case 'transactional': return 'amber';
    case 'navigational': return 'teal';
    default: return 'zinc';
  }
};


export interface ContentGapsProps {
  contentGaps: ContentGap[];
  workspaceId?: string;
  intentColor: (intent?: string) => string;
  /** When provided, caps the list at N items with a "Show N more / Show less" toggle.
   *  When absent/undefined, renders the full list — byte-identical to the previous behavior. */
  maxVisible?: number;
}

export function ContentGaps({ contentGaps, workspaceId, maxVisible }: ContentGapsProps) {
  const navigate = useNavigate();

  // Sort by opportunity score (server-computed), falling back to volume then priority
  const sorted = [...contentGaps].sort((a, b) => {
    const scoreDiff = (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const volDiff = (b.volume || 0) - (a.volume || 0);
    if (volDiff !== 0) return volDiff;
    const prioW = (p: string) => p === 'high' ? 3 : p === 'medium' ? 2 : 1;
    return prioW(b.priority) - prioW(a.priority);
  });

  const { visible, hiddenCount, expanded, toggle, canExpand } = useShowMore(sorted, maxVisible);

  if (sorted.length === 0) return null;

  return (
    <SectionCard
      title="Content Gaps"
      titleIcon={<Icon as={FileText} size="md" className="text-blue-300" />}
    >
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">New content to create — topics with search demand but no page on the site.</p>
      <div className="space-y-2">
        {visible.map((gap, i) => {
          // Header-right widgets after the shared intent badge: priority (StatusBadge) + page-type (admin chrome).
          const headerRight = (
            <>
              <StatusBadge status={gap.priority} domain="priority" />
              {gap.suggestedPageType && gap.suggestedPageType !== 'blog' && (
                <Badge label={gap.suggestedPageType} tone="teal" variant="outline" className="capitalize" />
              )}
            </>
          );
          // Admin nav-button footer (Draft Brief / Generate Brief).
          const footer = workspaceId ? (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Button
                onClick={() => navigate(adminPath(workspaceId, 'content-pipeline'), { state: { fixContext: { targetRoute: 'content-pipeline', primaryKeyword: gap.targetKeyword, pageType: gap.suggestedPageType || undefined, autoGenerate: true } } })}
                variant="ghost"
                size="sm"
                className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40"
              >
                <Icon as={FileText} size="sm" className="text-teal-300" /> Draft Brief
              </Button>
              <Button
                onClick={() => navigate(adminPath(workspaceId, 'seo-briefs'), { state: { fixContext: { targetRoute: 'seo-briefs', pageName: gap.targetKeyword, pageType: gap.suggestedPageType || undefined } } })}
                variant="ghost"
                size="sm"
                className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40"
              >
                <Icon as={Sparkles} size="sm" className="text-teal-300" /> Generate Brief
              </Button>
            </div>
          ) : undefined;
          return (
            <ContentGapRow
              key={i}
              audience="admin"
              data={gap}
              intentTone={intentTone}
              headerRight={headerRight}
              footer={footer}
            />
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
