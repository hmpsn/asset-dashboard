/**
 * Unit tests for buildPageRankStories (R2-D).
 *
 * Tests the pure pairing function in server/page-rank-stories.ts:
 *   - correct pairing of page ranked keywords to gap keywords by token overlap
 *   - banded/labeled output — no raw integers leak
 *   - caps (3+3 per page, 10 pages max)
 *   - empty-state behaviour
 *   - narrative string generation
 *   - no raw score/EMV/competitor fields in output
 */
import { describe, it, expect } from 'vitest';
import { buildPageRankStories } from '../../server/page-rank-stories.js';
import type { PageKeywordMap, KeywordGapItem } from '../../shared/types/workspace.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function page(overrides: Partial<PageKeywordMap> & Pick<PageKeywordMap, 'pagePath' | 'primaryKeyword' | 'pageTitle'>): PageKeywordMap {
  return {
    secondaryKeywords: [],
    ...overrides,
  } as PageKeywordMap;
}

function gap(keyword: string, volume: number, difficulty = 40): KeywordGapItem {
  return { keyword, volume, difficulty, competitorPosition: 5, competitorDomain: 'rival.com' };
}

// ── Empty state ───────────────────────────────────────────────────────────────

describe('buildPageRankStories — empty state', () => {
  it('returns [] when pageMap is empty', () => {
    expect(buildPageRankStories([], [gap('seo tools', 2000)])).toEqual([]);
  });

  it('returns [] when keywordGaps is empty', () => {
    const p = page({ pagePath: '/seo', pageTitle: 'SEO', primaryKeyword: 'seo services', currentPosition: 5 });
    expect(buildPageRankStories([p], [])).toEqual([]);
  });

  it('returns [] when no page has a currentPosition (none rank)', () => {
    const p = page({ pagePath: '/about', pageTitle: 'About', primaryKeyword: 'about us company' });
    const g = gap('about company', 1500);
    expect(buildPageRankStories([p], [g])).toEqual([]);
  });

  it('returns [] when no gap keyword tokens overlap with any page keyword', () => {
    const p = page({ pagePath: '/seo', pageTitle: 'SEO', primaryKeyword: 'seo audit tool', currentPosition: 8 });
    const g = gap('ppc advertising', 5000);
    expect(buildPageRankStories([p], [g])).toEqual([]);
  });
});

// ── Pairing logic ─────────────────────────────────────────────────────────────

describe('buildPageRankStories — pairing', () => {
  it('pairs gap to page when they share a token from primaryKeyword', () => {
    const p = page({ pagePath: '/seo', pageTitle: 'SEO', primaryKeyword: 'seo audit', currentPosition: 7 });
    const g = gap('free seo audit', 2000);
    const stories = buildPageRankStories([p], [g]);
    expect(stories).toHaveLength(1);
    expect(stories[0].pagePath).toBe('/seo');
    expect(stories[0].gapKeywords.some(gk => gk.keyword === 'free seo audit')).toBe(true);
  });

  it('pairs gap to page when token overlaps with secondaryKeywords', () => {
    const p = page({
      pagePath: '/content',
      pageTitle: 'Content Marketing',
      primaryKeyword: 'content strategy',
      secondaryKeywords: ['content marketing tips'],
      currentPosition: 12,
    });
    const g = gap('content marketing guide', 3000);
    const stories = buildPageRankStories([p], [g]);
    expect(stories).toHaveLength(1);
    expect(stories[0].gapKeywords.some(gk => gk.keyword === 'content marketing guide')).toBe(true);
  });

  it('does NOT pair an unrelated gap to a page', () => {
    const p = page({ pagePath: '/seo', pageTitle: 'SEO', primaryKeyword: 'seo audit', currentPosition: 5 });
    const related = gap('seo audit report', 1500);
    const unrelated = gap('ppc advertising budget', 7000);
    const stories = buildPageRankStories([p], [related, unrelated]);
    expect(stories).toHaveLength(1);
    expect(stories[0].gapKeywords.length).toBeGreaterThan(0);
    expect(stories[0].gapKeywords.every(gk => gk.keyword !== 'ppc advertising budget')).toBe(true); // every-ok — length asserted on the previous line
  });

  it('single-char normalized tokens are excluded from overlap matching', () => {
    // "i" is a single char and should not cause a match
    const p = page({ pagePath: '/intro', pageTitle: 'Intro', primaryKeyword: 'i am here', currentPosition: 5 });
    const g = gap('i have questions', 1000);
    // Both only share "i" (1 char) which is filtered; no real overlap
    const stories = buildPageRankStories([p], [g]);
    expect(stories).toHaveLength(0);
  });

  it('does NOT pair on a single shared GENERIC token (false-positive guard)', () => {
    // "best dentist near me" and "best coffee shop" share only "best" (generic).
    // A single generic overlap must not create a spurious pairing.
    const p = page({ pagePath: '/dentist', pageTitle: 'Dentist', primaryKeyword: 'best dentist near me', currentPosition: 6 });
    const g = gap('best coffee shop', 4000);
    const stories = buildPageRankStories([p], [g]);
    expect(stories).toHaveLength(0);
  });

  it('does NOT pair on a single shared generic "guide" token', () => {
    const p = page({ pagePath: '/plumbing', pageTitle: 'Plumbing', primaryKeyword: 'plumbing repair guide', currentPosition: 7 });
    const g = gap('mortgage rates guide', 5000);
    // Only "guide" overlaps — generic, single token → no pairing.
    const stories = buildPageRankStories([p], [g]);
    expect(stories).toHaveLength(0);
  });

  it('DOES pair on a single NON-generic anchor token (e.g. "invisalign")', () => {
    // Shares only "invisalign" — a real topical anchor, not generic → valid pair.
    const p = page({ pagePath: '/invisalign', pageTitle: 'Invisalign', primaryKeyword: 'invisalign treatment', currentPosition: 5 });
    const g = gap('invisalign cost', 2200);
    const stories = buildPageRankStories([p], [g]);
    expect(stories).toHaveLength(1);
    expect(stories[0].gapKeywords.some(gk => gk.keyword === 'invisalign cost')).toBe(true);
  });

  it('DOES pair when ≥2 tokens overlap even without a unique anchor', () => {
    // "seo audit" ↔ "seo audit report" shares seo + audit = 2 tokens → valid.
    const p = page({ pagePath: '/seo', pageTitle: 'SEO', primaryKeyword: 'seo audit', currentPosition: 8 });
    const g = gap('seo audit report', 1500);
    const stories = buildPageRankStories([p], [g]);
    expect(stories).toHaveLength(1);
  });
});

// ── Banded/labeled output — no raw integers ───────────────────────────────────

describe('buildPageRankStories — banded output contract', () => {
  const p = page({ pagePath: '/seo', pageTitle: 'SEO', primaryKeyword: 'seo audit tool', currentPosition: 7 });
  const g = gap('free seo audit', 3200);

  it('positionLabel is a friendly band string, never a raw integer', () => {
    const stories = buildPageRankStories([p], [g]);
    const kw = stories[0].rankedKeywords[0];
    expect(['Top 3', 'Page 1', 'Page 2', 'Page 3+']).toContain(kw.positionLabel);
    expect(Number.isFinite(Number(kw.positionLabel))).toBe(false);
  });

  it('volumeLabel is a descriptive band string, never a raw integer', () => {
    const stories = buildPageRankStories([p], [g]);
    const gk = stories[0].gapKeywords[0];
    expect(['High demand', 'Good demand', 'Growing', 'Niche']).toContain(gk.volumeLabel);
    expect(Number.isFinite(Number(gk.volumeLabel))).toBe(false);
  });

  it('positionLabel bands: ≤3 → Top 3, ≤10 → Page 1, ≤20 → Page 2, >20 → Page 3+', () => {
    for (const [pos, expected] of [[1, 'Top 3'], [3, 'Top 3'], [4, 'Page 1'], [10, 'Page 1'], [11, 'Page 2'], [20, 'Page 2'], [21, 'Page 3+'], [50, 'Page 3+']] as [number, string][]) {
      const pg = page({ pagePath: `/p${pos}`, pageTitle: 'T', primaryKeyword: 'seo audit', currentPosition: pos });
      const stories = buildPageRankStories([pg], [g]);
      expect(stories[0].rankedKeywords[0].positionLabel).toBe(expected);
    }
  });

  it('volumeLabel bands: ≥5000 → High demand, ≥1000 → Good demand, ≥200 → Growing, else → Niche', () => {
    for (const [vol, expected] of [[5000, 'High demand'], [1000, 'Good demand'], [200, 'Growing'], [199, 'Niche'], [0, 'Niche']] as [number, string][]) {
      const gapItem = gap('seo audit free', vol);
      const stories = buildPageRankStories([p], [gapItem]);
      expect(stories[0].gapKeywords[0].volumeLabel).toBe(expected);
    }
  });
});

// ── No raw score/EMV/competitor fields leak ───────────────────────────────────

describe('buildPageRankStories — no forbidden fields in output', () => {
  it('story items do not carry opportunityScore, EMV, cpc, or competitorDomain', () => {
    const p = page({ pagePath: '/seo', pageTitle: 'SEO', primaryKeyword: 'seo audit', currentPosition: 5 });
    const g = gap('seo audit tool', 2000);
    const stories = buildPageRankStories([p], [g]);
    const story = stories[0] as Record<string, unknown>;
    expect(story.opportunityScore).toBeUndefined();
    expect(story.emv).toBeUndefined();
    expect(story.cpc).toBeUndefined();
    expect(story.competitorDomain).toBeUndefined();
    expect(story.competitorPosition).toBeUndefined();
  });

  it('gapKeyword items do not carry volume, difficulty, or competitorPosition', () => {
    const p = page({ pagePath: '/seo', pageTitle: 'SEO', primaryKeyword: 'seo audit', currentPosition: 5 });
    const g = gap('seo audit tool', 2000);
    const stories = buildPageRankStories([p], [g]);
    const gk = stories[0].gapKeywords[0] as Record<string, unknown>;
    expect(gk.volume).toBeUndefined();
    expect(gk.difficulty).toBeUndefined();
    expect(gk.competitorPosition).toBeUndefined();
    expect(gk.competitorDomain).toBeUndefined();
  });
});

// ── Caps ──────────────────────────────────────────────────────────────────────

describe('buildPageRankStories — caps', () => {
  it('caps ranked keywords per page at 3', () => {
    // page with 4 GSC ranked keywords
    const p: PageKeywordMap = {
      pagePath: '/seo',
      pageTitle: 'SEO',
      primaryKeyword: 'seo audit tool',
      secondaryKeywords: ['seo audit guide', 'seo checklist', 'audit tool free'],
      currentPosition: 5,
      gscKeywords: [
        { query: 'seo audit guide', clicks: 5, impressions: 100, position: 6 },
        { query: 'seo checklist', clicks: 3, impressions: 80, position: 8 },
        { query: 'audit tool free', clicks: 2, impressions: 60, position: 9 },
      ],
    };
    const g = gap('seo audit report', 1500);
    const stories = buildPageRankStories([p], [g]);
    expect(stories[0].rankedKeywords.length).toBeLessThanOrEqual(3);
  });

  it('caps gap keywords per page at 3', () => {
    const p = page({ pagePath: '/seo', pageTitle: 'SEO', primaryKeyword: 'seo audit', currentPosition: 5 });
    const gaps: KeywordGapItem[] = [
      gap('seo audit tool', 5000),
      gap('seo audit report', 3000),
      gap('seo audit checklist', 2000),
      gap('free seo audit', 1500),
    ];
    const stories = buildPageRankStories([p], gaps);
    expect(stories[0].gapKeywords.length).toBeLessThanOrEqual(3);
  });

  it('caps total pages at 10', () => {
    const pages: PageKeywordMap[] = Array.from({ length: 15 }, (_, i) => ({
      pagePath: `/page-${i}`,
      pageTitle: `Page ${i}`,
      primaryKeyword: `seo audit page${i}`,
      secondaryKeywords: [],
      currentPosition: i + 1,
    }));
    const gaps: KeywordGapItem[] = [gap('seo audit tool', 2000)];
    const stories = buildPageRankStories(pages, gaps);
    expect(stories.length).toBeLessThanOrEqual(10);
  });
});

// ── GSC secondary keywords ────────────────────────────────────────────────────

describe('buildPageRankStories — GSC secondary keywords', () => {
  it('includes GSC keyword as ranked when it has a position and differs from primary', () => {
    const p: PageKeywordMap = {
      pagePath: '/seo',
      pageTitle: 'SEO',
      primaryKeyword: 'seo audit tool',
      secondaryKeywords: [],
      currentPosition: 7,
      gscKeywords: [{ query: 'seo audit checklist', clicks: 10, impressions: 200, position: 9 }],
    };
    const g = gap('seo audit report', 1500);
    const stories = buildPageRankStories([p], [g]);
    const rankedKws = stories[0].rankedKeywords.map(k => k.keyword);
    expect(rankedKws).toContain('seo audit checklist');
  });

  it('does not duplicate primary keyword when GSC also shows it', () => {
    const p: PageKeywordMap = {
      pagePath: '/seo',
      pageTitle: 'SEO',
      primaryKeyword: 'seo audit tool',
      secondaryKeywords: [],
      currentPosition: 5,
      gscKeywords: [{ query: 'seo audit tool', clicks: 20, impressions: 500, position: 5 }],
    };
    const g = gap('seo audit report', 1500);
    const stories = buildPageRankStories([p], [g]);
    const keywords = stories[0].rankedKeywords.map(k => k.keyword);
    const uniqueCount = new Set(keywords.map(k => k.toLowerCase())).size;
    expect(uniqueCount).toBe(keywords.length);
  });
});

// ── Narrative ─────────────────────────────────────────────────────────────────

describe('buildPageRankStories — narrative', () => {
  it('generates a non-empty narrative string for each story', () => {
    const p = page({ pagePath: '/seo', pageTitle: 'SEO', primaryKeyword: 'seo audit', currentPosition: 5 });
    const g = gap('seo audit tool', 2000);
    const stories = buildPageRankStories([p], [g]);
    expect(typeof stories[0].narrative).toBe('string');
    expect(stories[0].narrative.length).toBeGreaterThan(0);
  });

  it('narrative says "Ranking for 1 keyword" when exactly one ranked keyword', () => {
    const p = page({ pagePath: '/seo', pageTitle: 'SEO', primaryKeyword: 'seo audit', currentPosition: 5 });
    const g = gap('seo audit tool', 2000);
    const stories = buildPageRankStories([p], [g]);
    // single ranked kw → should mention the keyword itself
    expect(stories[0].narrative).toMatch(/Ranking for "/);
  });
});

// ── pageTitle fallback ────────────────────────────────────────────────────────

describe('buildPageRankStories — pageTitle', () => {
  it('uses pagePath as pageTitle when pageTitle is absent', () => {
    const p: PageKeywordMap = {
      pagePath: '/seo-audit',
      pageTitle: '',
      primaryKeyword: 'seo audit',
      secondaryKeywords: [],
      currentPosition: 5,
    };
    const g = gap('seo audit tool', 1500);
    const stories = buildPageRankStories([p], [g]);
    // pageTitle fallback from pagePath
    expect(stories[0].pageTitle).toBeTruthy();
  });
});
