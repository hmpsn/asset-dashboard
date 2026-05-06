import type { UnifiedPage } from '../../../shared/types/page-join.js';
import { opportunityScore } from './pageIntelligenceDisplay';
import type { KeywordData, SortBy, SortDir } from './pageIntelligenceTypes';

export interface FixQueueItem {
  page: UnifiedPage;
  score: number;
  impressions: number;
  impact: number;
}

export function buildEffectiveAnalyses(
  pages: UnifiedPage[],
  analyses: Record<string, KeywordData>,
): Record<string, KeywordData> {
  const fromStrategy: Record<string, KeywordData> = {};
  for (const page of pages) {
    const sp = page.strategy;
    if (sp?.analysisGeneratedAt && sp.optimizationScore != null) {
      fromStrategy[page.id] = {
        primaryKeyword: sp.primaryKeyword,
        primaryKeywordPresence: sp.primaryKeywordPresence || { inTitle: false, inMeta: false, inContent: false, inSlug: false },
        secondaryKeywords: sp.secondaryKeywords || [],
        longTailKeywords: sp.longTailKeywords || [],
        searchIntent: sp.searchIntent || 'informational',
        searchIntentConfidence: sp.searchIntentConfidence ?? 0.5,
        contentGaps: sp.contentGaps || [],
        competitorKeywords: sp.competitorKeywords || [],
        optimizationScore: sp.optimizationScore ?? 0,
        optimizationIssues: sp.optimizationIssues || [],
        recommendations: sp.recommendations || [],
        estimatedDifficulty: sp.estimatedDifficulty || 'medium',
        keywordDifficulty: sp.keywordDifficulty ?? 0,
        monthlyVolume: sp.monthlyVolume ?? 0,
        topicCluster: sp.topicCluster || '',
      };
    }
  }
  return { ...fromStrategy, ...analyses };
}

export function buildFilteredPages({
  pages,
  search,
  sortBy,
  sortDir,
  analyses,
}: {
  pages: UnifiedPage[];
  search: string;
  sortBy: SortBy;
  sortDir: SortDir;
  analyses: Record<string, KeywordData>;
}): UnifiedPage[] {
  return pages
    .filter(page => {
      if (!search) return true;
      const q = search.toLowerCase();
      return page.title.toLowerCase().includes(q) ||
             page.path.toLowerCase().includes(q) ||
             (page.strategy?.primaryKeyword || '').toLowerCase().includes(q);
    })
    .sort((a, b) => {
      let cmp = 0;
      const sa = a.strategy;
      const sb = b.strategy;
      switch (sortBy) {
        case 'position':
          cmp = (sa?.currentPosition || 999) - (sb?.currentPosition || 999);
          break;
        case 'volume':
          cmp = (sb?.volume || 0) - (sa?.volume || 0);
          break;
        case 'score': {
          const scoreA = analyses[a.id]?.optimizationScore ?? sa?.optimizationScore ?? -1;
          const scoreB = analyses[b.id]?.optimizationScore ?? sb?.optimizationScore ?? -1;
          cmp = scoreB - scoreA;
          break;
        }
        case 'priority':
        default:
          cmp = (sa ? opportunityScore(sa) : 0) - (sb ? opportunityScore(sb) : 0);
          cmp = -cmp;
          break;
      }
      return sortDir === 'asc' ? -cmp : cmp;
    });
}

export function buildFixQueue(
  pages: UnifiedPage[],
  analyses: Record<string, KeywordData>,
): FixQueueItem[] {
  return pages
    .map(page => {
      const score = analyses[page.id]?.optimizationScore ?? page.strategy?.optimizationScore;
      const impressions = page.strategy?.impressions || 0;
      if (score === undefined || score === null) return null;
      const impact = impressions > 0
        ? Math.round(impressions * (100 - score) / 100)
        : Math.max(1, 100 - score);
      return { page, score, impressions, impact };
    })
    .filter((item): item is FixQueueItem => item !== null && item.score < 75)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 5);
}
