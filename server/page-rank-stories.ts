/**
 * page-rank-stories — pure projection function for R2-D.
 *
 * Builds per-page rank-story cards pairing what a page ranks for
 * (from pageMap) with nearby keyword gaps (from keyword_gaps table).
 *
 * Pure: no DB reads, no mutations, no side-effects. Safe to unit-test.
 */
import { normalizeKeywordForComparison } from '../shared/keyword-normalization.js';
import type { PageKeywordMap, KeywordGapItem } from '../shared/types/workspace.js';

const PAGE_RANK_STORY_MAX_RANKED = 3;    // ranked keyword chips per page
const PAGE_RANK_STORY_MAX_GAP = 3;       // gap keyword chips per page
const PAGE_RANK_STORY_MAX_PAGES = 10;    // total pages in the story list

/** Friendly position band — banded label, never raw integer. */
function friendlyPositionBand(pos: number): string {
  if (pos <= 3) return 'Top 3';
  if (pos <= 10) return 'Page 1';
  if (pos <= 20) return 'Page 2';
  return 'Page 3+';
}

export interface PageRankStoryItem {
  pagePath: string;
  pageTitle: string;
  /** Ranked keywords with banded position label — never raw integers. */
  rankedKeywords: { keyword: string; positionLabel: string }[];
  /** Gap keywords that could strengthen this page — volume-labeled when available. */
  gapKeywords: { keyword: string; volumeLabel: string }[];
  /** Single narrative line for the card. */
  narrative: string;
}

/**
 * Builds per-page rank-story cards for the client Strategy tab.
 *
 * Pairing logic:
 *   - A page's "ranked keywords" = primaryKeyword (when currentPosition is set)
 *     + secondaryKeywords that appear in gscKeywords with a position.
 *   - A gap keyword is "relevant" to a page when ≥1 token from the normalized
 *     gap keyword overlaps with normalized tokens of the page's primary or
 *     secondary keywords (stopword-filtered single-char tokens excluded).
 *   - Only pages with ≥1 ranked keyword AND ≥1 gap keyword appear in the list.
 *   - Cap: top PAGE_RANK_STORY_MAX_PAGES pages by ranked keyword count (descending).
 */
export function buildPageRankStories(
  pageMap: PageKeywordMap[],
  keywordGaps: KeywordGapItem[],
): PageRankStoryItem[] {
  if (pageMap.length === 0 || keywordGaps.length === 0) return [];

  // Pre-normalize all gap keywords once.
  const normalizedGaps = keywordGaps.map(g => ({
    keyword: g.keyword,
    volume: g.volume,
    tokens: new Set(
      normalizeKeywordForComparison(g.keyword)
        .split(' ')
        .filter(t => t.length > 2),
    ),
  }));

  const stories: PageRankStoryItem[] = [];

  for (const page of pageMap) {
    // Build ranked keyword list: primary if ranked + any GSC secondary keywords.
    const rankedEntries: { keyword: string; pos: number }[] = [];
    if (page.primaryKeyword && page.currentPosition) {
      rankedEntries.push({ keyword: page.primaryKeyword, pos: page.currentPosition });
    }
    if (page.gscKeywords && page.gscKeywords.length > 0) {
      const primaryNorm = normalizeKeywordForComparison(page.primaryKeyword);
      const gscSorted = page.gscKeywords
        .filter(g => g.position > 0 && normalizeKeywordForComparison(g.query) !== primaryNorm)
        .sort((a, b) => a.position - b.position)
        .slice(0, PAGE_RANK_STORY_MAX_RANKED - (page.currentPosition ? 1 : 0));
      // Deduplicate by query (Set dedupe by iteration order, not Set<object>)
      const seen = new Set<string>();
      for (const gsc of gscSorted) {
        if (!seen.has(gsc.query)) {
          seen.add(gsc.query);
          rankedEntries.push({ keyword: gsc.query, pos: gsc.position });
        }
      }
    }

    if (rankedEntries.length === 0) continue;

    // Build page token set from primary + secondary keywords.
    const pageTokens = new Set<string>();
    for (const kw of [page.primaryKeyword, ...(page.secondaryKeywords || [])]) {
      for (const token of normalizeKeywordForComparison(kw).split(' ').filter(t => t.length > 2)) {
        pageTokens.add(token);
      }
    }

    // Find relevant gap keywords by token overlap.
    const relevantGaps = normalizedGaps.filter(g => {
      for (const token of g.tokens) {
        if (pageTokens.has(token)) return true;
      }
      return false;
    });

    if (relevantGaps.length === 0) continue;

    const cappedRanked = rankedEntries
      .sort((a, b) => a.pos - b.pos)
      .slice(0, PAGE_RANK_STORY_MAX_RANKED)
      .map(e => ({ keyword: e.keyword, positionLabel: friendlyPositionBand(e.pos) }));

    const cappedGaps = relevantGaps
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, PAGE_RANK_STORY_MAX_GAP)
      .map(g => ({
        keyword: g.keyword,
        // Volume label — banded/descriptive, never raw number.
        // RULE: never expose raw volume integers to the client; use labeled bands.
        volumeLabel: g.volume >= 5000 ? 'High demand'
          : g.volume >= 1000 ? 'Good demand'
          : g.volume >= 200 ? 'Growing'
          : 'Niche',
      }));

    const narrative = cappedRanked.length === 1
      ? `Ranking for "${cappedRanked[0].keyword}" — ${cappedGaps.length} nearby ${cappedGaps.length === 1 ? 'gap' : 'gaps'} worth adding`
      : `Ranking for ${cappedRanked.length} keywords — ${cappedGaps.length} nearby ${cappedGaps.length === 1 ? 'gap' : 'gaps'} worth adding`;

    stories.push({
      pagePath: page.pagePath,
      pageTitle: page.pageTitle || page.pagePath,
      rankedKeywords: cappedRanked,
      gapKeywords: cappedGaps,
      narrative,
    });
  }

  return stories
    .sort((a, b) => b.rankedKeywords.length - a.rankedKeywords.length || b.gapKeywords.length - a.gapKeywords.length)
    .slice(0, PAGE_RANK_STORY_MAX_PAGES);
}
