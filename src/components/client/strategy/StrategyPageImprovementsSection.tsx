import { useState, type RefObject } from 'react';
import { ChartNoAxesCombined, ChevronDown, MessageCircle, Zap } from 'lucide-react';
import { post } from '../../../api';
import { Icon, SectionCard } from '../../ui';
import type { ClientKeywordStrategy } from '../types';
import { kdColor } from './strategyKeywordDisplay';

type PageMapItem = ClientKeywordStrategy['pageMap'][number];

interface StrategyPageImprovementsSectionProps {
  optimizeExistingRef: RefObject<HTMLDivElement | null>;
  strategyData: ClientKeywordStrategy;
  quickWinsAvailable: number;
  pagesWithGrowthOpps: number;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
  workspaceId?: string;
  setToast?: (msg: string) => void;
  onContentRequested?: () => void;
}

function buildGrowthOpportunityPages(pageMap: PageMapItem[]) {
  return pageMap
    .filter(p => !p.currentPosition)
    .map(p => {
      const reasons: string[] = [];
      const hasImpressions = (p.impressions || 0) > 0;
      const highKD = (p.difficulty || 0) > 60;
      const medKD = (p.difficulty || 0) > 30;

      if (hasImpressions) {
        reasons.push('Google is already crawling this page — close to breaking through');
      } else if (highKD) {
        reasons.push(`Competitive keyword (${p.difficulty}% difficulty) — authority building will help`);
      } else if (medKD) {
        reasons.push('Moderate competition — content depth can unlock this');
      } else {
        reasons.push('Low competition — quick win with content improvements');
      }

      const intentScore = p.searchIntent === 'commercial' ? 3 : p.searchIntent === 'transactional' ? 3 : p.searchIntent === 'informational' ? 1 : 2;
      const priority = intentScore * 100 + (hasImpressions ? 50 : 0) + (100 - (p.difficulty || 50));
      return { ...p, reasons, priority, hasImpressions };
    })
    .sort((a, b) => {
      if (a.hasImpressions !== b.hasImpressions) return a.hasImpressions ? -1 : 1;
      return b.priority - a.priority;
    });
}

export function StrategyPageImprovementsSection({
  optimizeExistingRef,
  strategyData,
  quickWinsAvailable,
  pagesWithGrowthOpps,
  expandedSections,
  toggleSection,
  workspaceId,
  setToast,
  onContentRequested,
}: StrategyPageImprovementsSectionProps) {
  const [discussingGrowthPage, setDiscussingGrowthPage] = useState<string | null>(null);
  const totalPageImprovements = quickWinsAvailable + pagesWithGrowthOpps;
  const growthOpportunityPages = buildGrowthOpportunityPages(strategyData.pageMap);

  if (totalPageImprovements === 0) return null;

  return (
    <div ref={optimizeExistingRef}>
      <SectionCard noPadding>
        <button
          onClick={() => toggleSection('optimize-existing')}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-amber-500/20 flex items-center justify-center">
              <Icon as={Zap} size="md" className="text-accent-warning" />
            </div>
            <div className="text-left">
              <div className="t-ui font-medium text-[var(--brand-text-bright)]">Improve Pages</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)]">{totalPageImprovements} improvements across your site</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="t-caption font-bold text-accent-warning bg-amber-500/10 px-2 py-0.5 rounded-[var(--radius-pill)] border border-amber-500/20">{totalPageImprovements}</span>
            <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${expandedSections.has('optimize-existing') ? '' : '-rotate-90'}`} />
          </div>
        </button>

        {expandedSections.has('optimize-existing') && (
          <div className="px-4 pb-4 border-t border-[var(--brand-border)]/50">
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-3 mb-3 leading-relaxed">
              These are improvements to pages you already have, sorted by estimated impact. Quick wins are lower-effort fixes; growth opportunities are pages with untapped potential.
            </p>

            {strategyData.quickWins && strategyData.quickWins.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon as={Zap} size="md" className="text-accent-warning" />
                  <span className="t-caption font-medium text-[var(--brand-text)]">Quick Wins</span>
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">({strategyData.quickWins.length})</span>
                </div>
                <div className="space-y-2">
                  {strategyData.quickWins.slice(0, expandedSections.has('quick-wins-all') ? undefined : 3).map((qw, i) => {
                    const impactColor = qw.estimatedImpact === 'high' ? 'text-accent-success bg-emerald-500/15 border-emerald-500/30' : qw.estimatedImpact === 'medium' ? 'text-accent-warning bg-amber-500/15 border-amber-500/30' : 'text-[var(--brand-text-muted)] bg-[var(--surface-3)]/30 border-[var(--brand-border-strong)]/20';
                    return (
                      <div key={i} className="px-3 py-2.5 rounded-[var(--radius-lg)] bg-[var(--surface-1)]/50 border border-[var(--brand-border)]/80">
                        <div className="flex items-center justify-between">
                          <span className="t-caption-sm font-mono text-[var(--brand-text-muted)]">{qw.pagePath}</span>
                          <span className={`t-caption-sm font-bold px-1.5 py-0.5 rounded-[var(--radius-sm)] border ${impactColor}`}>{qw.estimatedImpact}</span>
                        </div>
                        <div className="t-caption-sm text-[var(--brand-text)] mt-1 font-medium">{qw.action}</div>
                      </div>
                    );
                  })}
                  {strategyData.quickWins.length > 3 && (
                    <button
                      onClick={() => toggleSection('quick-wins-all')}
                      className="w-full text-center py-2 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                    >
                      {expandedSections.has('quick-wins-all') ? 'Show fewer' : `View all ${strategyData.quickWins.length}`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {growthOpportunityPages.length > 0 && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Icon as={ChartNoAxesCombined} size="md" className="text-accent-info" />
                  <span className="t-caption font-medium text-[var(--brand-text)]">Pages to Review</span>
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">({growthOpportunityPages.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {growthOpportunityPages.slice(0, expandedSections.has('growth-opportunities-all') ? undefined : 3).map(page => (
                    <div key={page.pagePath} className="rounded-[var(--radius-lg)] bg-[var(--surface-1)]/50 border border-[var(--brand-border)]/80 p-3 flex flex-col hover:border-blue-500/30 transition-all">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{page.pageTitle || page.pagePath}</div>
                          <div className="t-caption-sm text-[var(--brand-text-muted)] font-mono truncate">{page.pagePath}</div>
                        </div>
                        {page.hasImpressions && <span className="t-caption-sm text-accent-info bg-blue-500/10 px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-blue-500/20 flex-shrink-0 ml-2">Almost there</span>}
                      </div>
                      {page.primaryKeyword && (
                        <div className="t-caption-sm text-accent-brand mb-2">Keyword: &ldquo;{page.primaryKeyword}&rdquo;</div>
                      )}
                      <div className="t-caption-sm text-[var(--brand-text-muted)] leading-snug flex-1">{page.reasons[0]}</div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--brand-border)]/50">
                        <div className="flex items-center gap-1.5">
                          {page.searchIntent && <span className="t-caption-sm text-[var(--brand-text-muted)] uppercase">{page.searchIntent}</span>}
                          {page.difficulty != null && page.difficulty > 0 && (
                            <span className={`t-caption-sm ${kdColor(page.difficulty)}`}>
                              Difficulty {page.difficulty}
                            </span>
                          )}
                        </div>
                        {workspaceId && (
                          <button
                            onClick={async () => {
                              if (discussingGrowthPage === page.pagePath) return;
                              const topic = `Discuss optimization for ${page.pageTitle || page.pagePath}`;
                              const targetKeyword = page.primaryKeyword || page.pageTitle || page.pagePath;
                              setDiscussingGrowthPage(page.pagePath);
                              try {
                                await post(`/api/public/content-request/${workspaceId}`, {
                                  topic,
                                  targetKeyword,
                                  rationale: `Growth opportunity on ${page.pagePath}: ${page.reasons[0]}`,
                                  priority: page.hasImpressions ? 'high' : 'medium',
                                });
                                setToast?.('Optimization request created');
                                onContentRequested?.();
                              } catch {
                                setToast?.('Failed to create optimization request');
                              } finally {
                                setDiscussingGrowthPage(null);
                              }
                            }}
                            disabled={discussingGrowthPage === page.pagePath}
                            className="px-2.5 py-1 rounded-[var(--radius-sm)] t-caption-sm font-medium text-[var(--brand-text)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] border border-[var(--brand-border-strong)] transition-colors flex items-center gap-1 disabled:opacity-50"
                          >
                            <Icon as={MessageCircle} size="sm" />
                            {discussingGrowthPage === page.pagePath ? 'Requesting...' : 'Request Review'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {growthOpportunityPages.length > 3 && (
                  <button
                    onClick={() => toggleSection('growth-opportunities-all')}
                    className="w-full mt-3 text-center py-2 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors border border-dashed border-[var(--brand-border)] rounded-[var(--radius-lg)] hover:border-[var(--brand-border-strong)]"
                  >
                    {expandedSections.has('growth-opportunities-all') ? 'Show fewer' : `View all ${growthOpportunityPages.length} opportunities`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
