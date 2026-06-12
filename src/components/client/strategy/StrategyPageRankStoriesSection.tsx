/**
 * StrategyPageRankStoriesSection — R2-D
 *
 * Per-page keyword story cards: what each page ranks for + nearby gap keywords
 * worth adding. Client-safe (banded/labeled values, no raw scores or EMV).
 */
import { ChevronDown, MapPin } from 'lucide-react';
import { Badge, Button, Icon, SectionCard, TierGate, type Tier } from '../../ui';
import type { PageRankStoryItem } from '../types';

interface StrategyPageRankStoriesSectionProps {
  pageRankStories: PageRankStoryItem[];
  effectiveTier: Tier;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
}

const SECTION_KEY = 'page-rank-stories';

/** Chip for a ranked keyword — teal for action (Growth+), blue data tone for the
 *  position badge (read-only rank metric, follows Four Laws). */
function RankedKeywordChip({ keyword, positionLabel }: { keyword: string; positionLabel: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] border border-[var(--brand-border-strong)] text-[var(--brand-text)]">
      <span className="t-caption-sm font-medium truncate max-w-[160px]">{keyword}</span>
      <Badge
        label={positionLabel}
        tone="blue"
        variant="outline"
        shape="sm"
        size="sm"
      />
    </span>
  );
}

/** Chip for a gap keyword — amber outline to signal "this is missing / worth adding". */
function GapKeywordChip({ keyword, volumeLabel }: { keyword: string; volumeLabel: string }) {
  return (
    <span /* badge-span-ok: gap chip pairs icon+volume label in pill anatomy Badge does not support */ className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] bg-amber-500/10 border border-amber-500/25 text-[var(--brand-text)]">
      <span className="t-caption-sm font-medium truncate max-w-[160px]">{keyword}</span>
      <span className="t-caption-sm text-accent-warning font-medium shrink-0">{volumeLabel}</span>
    </span>
  );
}

function PageRankStoryCard({ story }: { story: PageRankStoryItem }) {
  const displayTitle = story.pageTitle && story.pageTitle !== story.pagePath
    ? story.pageTitle
    : story.pagePath.replace(/^\//, '') || 'Home';

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)]/50 p-4 flex flex-col gap-3 hover:border-blue-500/30 transition-colors">
      {/* Page identity */}
      <div className="flex items-start gap-2">
        <div className="w-5 h-5 rounded-[var(--radius-sm)] bg-blue-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Icon as={MapPin} size="sm" className="text-accent-info" />
        </div>
        <div className="min-w-0">
          <div className="t-body font-semibold text-[var(--brand-text-bright)] truncate">{displayTitle}</div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] font-mono truncate">{story.pagePath}</div>
        </div>
      </div>

      {/* Ranked keywords */}
      <div>
        <div className="t-caption-sm text-[var(--brand-text-muted)] uppercase tracking-wide mb-1.5 font-medium">Ranking for</div>
        <div className="flex flex-wrap gap-1.5">
          {story.rankedKeywords.map((kw: { keyword: string; positionLabel: string }) => (
            <RankedKeywordChip key={kw.keyword} keyword={kw.keyword} positionLabel={kw.positionLabel} />
          ))}
        </div>
      </div>

      {/* Gap keywords */}
      <div>
        <div className="t-caption-sm text-[var(--brand-text-muted)] uppercase tracking-wide mb-1.5 font-medium">Worth adding</div>
        <div className="flex flex-wrap gap-1.5">
          {story.gapKeywords.map((g: { keyword: string; volumeLabel: string }) => (
            <GapKeywordChip key={g.keyword} keyword={g.keyword} volumeLabel={g.volumeLabel} />
          ))}
        </div>
      </div>

      {/* Narrative line */}
      <p className="t-caption-sm text-[var(--brand-text-muted)] leading-relaxed border-t border-[var(--brand-border)]/60 pt-2.5 mt-0.5">
        {story.narrative}
      </p>
    </div>
  );
}

export function StrategyPageRankStoriesSection({
  pageRankStories,
  effectiveTier,
  expandedSections,
  toggleSection,
}: StrategyPageRankStoriesSectionProps) {
  if (pageRankStories.length === 0) return null;

  const isExpanded = expandedSections.has(SECTION_KEY);

  return (
    <div>
      <TierGate tier={effectiveTier} required="growth" feature="Page Keyword Stories" teaser={`${pageRankStories.length} pages with ranking + gap signals`}>
        <SectionCard noPadding>
          <Button
            variant="ghost"
            aria-expanded={isExpanded}
            onClick={() => toggleSection(SECTION_KEY)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors rounded-none"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-blue-500/20 flex items-center justify-center">
                <Icon as={MapPin} size="md" className="text-accent-info" />
              </div>
              <div className="text-left">
                <div className="t-body font-medium text-[var(--brand-text-bright)]">You rank for X, missing Y</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">
                  {pageRankStories.length} {pageRankStories.length === 1 ? 'page' : 'pages'} with ranking keywords and nearby gaps
                </div>
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
          </Button>

          {isExpanded && (
            <div className="px-4 pb-4 border-t border-[var(--brand-border)]/50">
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-3 mb-4 leading-relaxed">
                These pages already rank for at least one keyword. Each card shows what they rank for and which related keywords competitors hold that could strengthen this page.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {pageRankStories.map(story => (
                  <PageRankStoryCard key={story.pagePath} story={story} />
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </TierGate>
    </div>
  );
}
