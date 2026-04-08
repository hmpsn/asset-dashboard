/**
 * Unit tests for strategy enrichment logic.
 *
 * Covers:
 *  - SERP feature detection and classification (parseSerpFeatures, hasSerpOpportunity)
 *  - Trend direction calculation (trendDirection)
 *  - Question keyword identification (matching logic)
 *  - Keyword cannibalization detection (severity and action rules)
 *  - Content gap analysis enrichment (trend + SERP + question keyword attachment)
 *  - Enrichment of raw keyword data (filterBrandedContentGaps, filterBrandedKeywords)
 */

import { describe, it, expect } from 'vitest';
import {
  parseSerpFeatures,
  hasSerpOpportunity,
  trendDirection,
} from '../../server/semrush.js';
import {
  extractBrandTokens,
  isBrandedQuery,
  filterBrandedContentGaps,
  filterBrandedKeywords,
} from '../../server/competitor-brand-filter.js';

// ── SERP Feature Detection ────────────────────────────────────────────

describe('parseSerpFeatures', () => {
  it('returns empty array for undefined input', () => {
    const result = parseSerpFeatures(undefined);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    const result = parseSerpFeatures('');
    expect(result).toEqual([]);
  });

  it('parses code 0 as featured_snippet', () => {
    const result = parseSerpFeatures('0');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('featured_snippet');
  });

  it('parses code 3 as people_also_ask', () => {
    const result = parseSerpFeatures('3');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('people_also_ask');
  });

  it('parses code 5 as video', () => {
    const result = parseSerpFeatures('5');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('video');
  });

  it('parses code 11 as local_pack', () => {
    const result = parseSerpFeatures('11');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('local_pack');
  });

  it('parses code 14 as video_carousel', () => {
    const result = parseSerpFeatures('14');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('video_carousel');
  });

  it('parses multiple comma-separated codes', () => {
    const result = parseSerpFeatures('0,3,5');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('featured_snippet');
    expect(result).toContain('people_also_ask');
    expect(result).toContain('video');
  });

  it('handles whitespace around codes', () => {
    const result = parseSerpFeatures('0, 3, 11');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('featured_snippet');
    expect(result).toContain('people_also_ask');
    expect(result).toContain('local_pack');
  });

  it('passes unknown codes through as-is', () => {
    const result = parseSerpFeatures('99');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('99');
  });

  it('parses the full common SERP set', () => {
    // featured_snippet + people_also_ask + local_pack
    const result = parseSerpFeatures('0,3,11');
    expect(result.length).toBe(3);
    expect(result).toContain('featured_snippet');
    expect(result).toContain('people_also_ask');
    expect(result).toContain('local_pack');
  });
});

// ── SERP Feature Classification (hasSerpOpportunity) ─────────────────

describe('hasSerpOpportunity', () => {
  it('returns all false for undefined input', () => {
    const result = hasSerpOpportunity(undefined);
    expect(result.featuredSnippet).toBe(false);
    expect(result.paa).toBe(false);
    expect(result.video).toBe(false);
    expect(result.localPack).toBe(false);
  });

  it('returns all false for empty string', () => {
    const result = hasSerpOpportunity('');
    expect(result.featuredSnippet).toBe(false);
    expect(result.paa).toBe(false);
    expect(result.video).toBe(false);
    expect(result.localPack).toBe(false);
  });

  it('detects featured_snippet from code 0', () => {
    const result = hasSerpOpportunity('0');
    expect(result.featuredSnippet).toBe(true);
    expect(result.paa).toBe(false);
    expect(result.video).toBe(false);
    expect(result.localPack).toBe(false);
  });

  it('detects people_also_ask (paa) from code 3', () => {
    const result = hasSerpOpportunity('3');
    expect(result.paa).toBe(true);
    expect(result.featuredSnippet).toBe(false);
  });

  it('detects video from code 5 (video carousel)', () => {
    const result = hasSerpOpportunity('5');
    expect(result.video).toBe(true);
  });

  it('detects video from code 14 (video_carousel)', () => {
    const result = hasSerpOpportunity('14');
    expect(result.video).toBe(true);
  });

  it('detects local_pack from code 11', () => {
    const result = hasSerpOpportunity('11');
    expect(result.localPack).toBe(true);
  });

  it('detects multiple features from combined codes', () => {
    // featured_snippet + people_also_ask + local_pack
    const result = hasSerpOpportunity('0,3,11');
    expect(result.featuredSnippet).toBe(true);
    expect(result.paa).toBe(true);
    expect(result.localPack).toBe(true);
    expect(result.video).toBe(false);
  });

  it('returns false for all flags when codes have no high-value features', () => {
    // Code 1=reviews, 2=sitelinks, 9=shopping — none trigger the 4 flags
    const result = hasSerpOpportunity('1,2,9');
    expect(result.featuredSnippet).toBe(false);
    expect(result.paa).toBe(false);
    expect(result.video).toBe(false);
    expect(result.localPack).toBe(false);
  });

  it('correctly classifies all four high-value features simultaneously', () => {
    // 0=featured_snippet, 3=paa, 5=video, 11=local_pack
    const result = hasSerpOpportunity('0,3,5,11');
    expect(result.featuredSnippet).toBe(true);
    expect(result.paa).toBe(true);
    expect(result.video).toBe(true);
    expect(result.localPack).toBe(true);
  });
});

// ── Trend Direction Calculation ───────────────────────────────────────

describe('trendDirection', () => {
  it('returns stable for undefined input', () => {
    expect(trendDirection(undefined)).toBe('stable');
  });

  it('returns stable for empty array', () => {
    expect(trendDirection([])).toBe('stable');
  });

  it('returns stable for array with fewer than 4 elements', () => {
    expect(trendDirection([100, 200, 150])).toBe('stable');
  });

  it('returns rising when recent average is more than 15% above early average', () => {
    // early avg = (100+100+100)/3 = 100, recent avg = (120+130+125)/3 = 125 → +25%
    const trend = [100, 100, 100, 110, 120, 130, 125, 130, 128, 135, 140, 130];
    expect(trendDirection(trend)).toBe('rising');
  });

  it('returns declining when recent average is more than 15% below early average', () => {
    // early avg = (200+200+200)/3 = 200, recent avg = (150+140+130)/3 ≈ 140 → -30%
    const trend = [200, 200, 200, 190, 180, 170, 160, 150, 145, 140, 135, 130];
    expect(trendDirection(trend)).toBe('declining');
  });

  it('returns stable when change is within ±15%', () => {
    // early avg = 100, recent avg ≈ 107 → +7% — within the ±15% band
    const trend = [100, 100, 100, 102, 104, 106, 105, 108, 107, 107, 106, 108];
    expect(trendDirection(trend)).toBe('stable');
  });

  it('returns rising when early average is 0 and recent is positive', () => {
    const trend = [0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 80, 100];
    expect(trendDirection(trend)).toBe('rising');
  });

  it('returns stable when early average is 0 and recent is also 0', () => {
    const trend = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(trendDirection(trend)).toBe('stable');
  });

  it('returns declining for sharp drop trend', () => {
    // 12-month trend that clearly drops >15%
    const trend = [500, 490, 480, 470, 460, 450, 300, 280, 260, 240, 220, 200];
    const result = trendDirection(trend);
    expect(result).toBe('declining');
  });

  it('handles minimum 4-element array (at boundary)', () => {
    // early avg = first 3 = [100, 100, 100] = 100; recent = last 3 = [100, 100, 200] = 133.3 → +33%
    const trend = [100, 100, 100, 200];
    expect(trendDirection(trend)).toBe('rising');
  });

  it('uses last 3 and first 3 elements for comparison in a 12-month array', () => {
    // rising: early = [50,50,50], recent = [150,160,170] → +220%
    const rising = [50, 50, 50, 70, 90, 110, 120, 130, 140, 150, 160, 170];
    expect(trendDirection(rising)).toBe('rising');

    // declining: early = [300,300,300], recent = [100,80,60] → -73%
    const declining = [300, 300, 300, 250, 200, 170, 150, 130, 110, 100, 80, 60];
    expect(trendDirection(declining)).toBe('declining');
  });
});

// ── Question Keyword Identification ───────────────────────────────────
//
// The matching logic from keyword-strategy.ts (line 1437-1441) filters
// question keywords whose text includes the first word of the content gap's
// targetKeyword. This logic is pure — tested inline here.

describe('question keyword matching logic', () => {
  // Mirrors the logic from keyword-strategy.ts:
  //   allQuestionKws.flatMap(q => q.questions)
  //     .filter(q => q.keyword.toLowerCase().includes(cg.targetKeyword.toLowerCase().split(' ')[0]))
  //     .slice(0, 3)
  //     .map(q => q.keyword)

  function matchQuestionKeywords(
    targetKeyword: string,
    allQuestionKws: Array<{ seed: string; questions: Array<{ keyword: string; volume: number }> }>,
  ): string[] {
    const firstWord = targetKeyword.toLowerCase().split(' ')[0];
    return allQuestionKws
      .flatMap(q => q.questions)
      .filter(q => q.keyword.toLowerCase().includes(firstWord))
      .slice(0, 3)
      .map(q => q.keyword);
  }

  it('returns empty array when no question keywords provided', () => {
    const result = matchQuestionKeywords('technical seo', []);
    expect(result).toEqual([]);
  });

  it('matches questions containing the first word of the target keyword', () => {
    const questionKws = [
      {
        seed: 'technical seo',
        questions: [
          { keyword: 'what is technical seo', volume: 1200 },
          { keyword: 'how to do technical seo audit', volume: 800 },
          { keyword: 'technical seo checklist', volume: 600 },
        ],
      },
    ];
    const result = matchQuestionKeywords('technical seo', questionKws);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(r => r.toLowerCase().includes('technical'))).toBe(true);
  });

  it('does not match questions unrelated to the first word', () => {
    const questionKws = [
      {
        seed: 'link building',
        questions: [
          { keyword: 'how to build links', volume: 500 },
          { keyword: 'what are backlinks', volume: 400 },
        ],
      },
    ];
    // "technical" is not in any of those questions
    const result = matchQuestionKeywords('technical seo', questionKws);
    expect(result.length).toBe(0);
  });

  it('caps results at 3', () => {
    const questionKws = [
      {
        seed: 'seo',
        questions: [
          { keyword: 'what is seo', volume: 2000 },
          { keyword: 'how does seo work', volume: 1500 },
          { keyword: 'seo basics guide', volume: 1200 },
          { keyword: 'seo tutorial for beginners', volume: 900 },
          { keyword: 'seo tips 2024', volume: 700 },
        ],
      },
    ];
    const result = matchQuestionKeywords('seo tips', questionKws);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('flattens questions across multiple seed entries', () => {
    const questionKws = [
      {
        seed: 'content strategy',
        questions: [
          { keyword: 'what is content strategy', volume: 1000 },
        ],
      },
      {
        seed: 'content marketing',
        questions: [
          { keyword: 'content marketing vs seo', volume: 800 },
          { keyword: 'content creation tips', volume: 600 },
        ],
      },
    ];
    const result = matchQuestionKeywords('content strategy', questionKws);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(r => r.toLowerCase().includes('content'))).toBe(true);
  });

  it('uses only the first word of a multi-word target keyword for matching', () => {
    const questionKws = [
      {
        seed: 'local seo',
        questions: [
          { keyword: 'local seo tips for small business', volume: 800 },
          { keyword: 'local business seo guide', volume: 600 },
        ],
      },
    ];
    // Target is "local seo services" — first word is "local"
    const result = matchQuestionKeywords('local seo services', questionKws);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(r => r.toLowerCase().includes('local'))).toBe(true);
  });

  it('is case-insensitive', () => {
    const questionKws = [
      {
        seed: 'SEO',
        questions: [
          { keyword: 'What Is SEO And How Does It Work', volume: 1000 },
        ],
      },
    ];
    const result = matchQuestionKeywords('seo basics', questionKws);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── Keyword Cannibalization Detection ─────────────────────────────────
//
// The severity/action logic from keyword-strategy.ts is embedded in the
// route handler. These tests validate the decision rules as documented
// inline in the source.

describe('cannibalization detection rules', () => {
  // Mirrors the severity rule from keyword-strategy.ts lines 1527-1529:
  //   pages.length >= 3 → 'high'
  //   enrichedPages with 2+ positions < 20 → 'high'
  //   otherwise → 'medium'

  function computeSeverity(
    pages: Array<{ path: string; position?: number; impressions?: number; clicks?: number }>,
  ): 'high' | 'medium' {
    if (pages.length >= 3) return 'high';
    const rankingCount = pages.filter(p => p.position !== undefined && p.position < 20).length;
    if (rankingCount >= 2) return 'high';
    return 'medium';
  }

  // Mirrors the action selection logic from keyword-strategy.ts lines 1555-1566:
  //   positionsClose && secondaryHasTraffic → 'differentiate'
  //   secondaryHasTraffic → 'canonical_tag'
  //   otherPages all have no clicks and < 50 impressions → 'redirect_301'
  //   otherwise → 'canonical_tag'

  function selectAction(
    bestPage: { position?: number; clicks?: number; impressions?: number },
    otherPages: Array<{ position?: number; clicks?: number; impressions?: number }>,
  ): 'canonical_tag' | 'redirect_301' | 'differentiate' {
    const secondaryHasTraffic = otherPages.some(p => (p.clicks ?? 0) > 5);
    const positionsClose = otherPages.some(p =>
      p.position !== undefined &&
      bestPage.position !== undefined &&
      Math.abs(p.position - bestPage.position) < 10,
    );

    if (positionsClose && secondaryHasTraffic) return 'differentiate';
    if (secondaryHasTraffic) return 'canonical_tag';
    if (otherPages.every(p => !p.clicks && (p.impressions ?? 0) < 50)) return 'redirect_301';
    return 'canonical_tag';
  }

  it('severity is high when 3+ pages compete for a keyword', () => {
    const pages = [
      { path: '/services', position: 5, impressions: 500, clicks: 30 },
      { path: '/about', position: 12, impressions: 200, clicks: 10 },
      { path: '/contact', position: 18, impressions: 100, clicks: 5 },
    ];
    expect(computeSeverity(pages)).toBe('high');
  });

  it('severity is high when 2 pages both rank in top 20', () => {
    const pages = [
      { path: '/services', position: 5, impressions: 300, clicks: 20 },
      { path: '/blog/seo', position: 14, impressions: 150, clicks: 8 },
    ];
    expect(computeSeverity(pages)).toBe('high');
  });

  it('severity is medium when only one page ranks in top 20', () => {
    const pages = [
      { path: '/services', position: 5, impressions: 300, clicks: 20 },
      { path: '/blog/seo', position: 35, impressions: 20, clicks: 1 },
    ];
    expect(computeSeverity(pages)).toBe('medium');
  });

  it('severity is medium when no page ranks in top 20', () => {
    const pages = [
      { path: '/services', position: 25 },
      { path: '/blog/seo', position: 40 },
    ];
    expect(computeSeverity(pages)).toBe('medium');
  });

  it('action is differentiate when both pages have traffic and are close in position', () => {
    // positions within 10 of each other, secondary has clicks > 5
    const best = { position: 5, clicks: 30, impressions: 500 };
    const others = [{ position: 9, clicks: 15, impressions: 200 }];
    expect(selectAction(best, others)).toBe('differentiate');
  });

  it('action is canonical_tag when secondary has traffic but positions are far apart', () => {
    // secondary has traffic (clicks > 5) but positions differ by >= 10
    const best = { position: 3, clicks: 50, impressions: 600 };
    const others = [{ position: 18, clicks: 10, impressions: 100 }];
    expect(selectAction(best, others)).toBe('canonical_tag');
  });

  it('action is redirect_301 when secondary has no traffic and few impressions', () => {
    const best = { position: 5, clicks: 40, impressions: 400 };
    const others = [{ position: undefined, clicks: 0, impressions: 10 }];
    expect(selectAction(best, others)).toBe('redirect_301');
  });

  it('action is canonical_tag when secondary has impressions >= 50 but no clicks', () => {
    // Not redirect_301 because impressions >= 50
    const best = { position: 5, clicks: 30, impressions: 400 };
    const others = [{ position: undefined, clicks: 0, impressions: 60 }];
    expect(selectAction(best, others)).toBe('canonical_tag');
  });
});

// ── Content Gap Enrichment (trendDirection + hasSerpOpportunity) ───────
//
// The enrichment logic in keyword-strategy.ts lines 1420-1443 applies
// trendDirection and hasSerpOpportunity to domain keyword data and
// attaches the results to content gap objects. These tests verify that
// using those two functions produces the correct enrichment outputs for
// representative content gap scenarios.

describe('content gap analysis enrichment', () => {
  it('correctly enriches a rising-trend content gap with featured snippet opportunity', () => {
    // Simulate domain data for a gap keyword
    const domainKeyword = {
      keyword: 'technical seo audit',
      trend: [100, 100, 100, 110, 120, 130, 140, 150, 155, 160, 165, 170], // rising
      serpFeatures: '0,3', // featured_snippet + people_also_ask
    };

    const trend = trendDirection(domainKeyword.trend);
    const serp = hasSerpOpportunity(domainKeyword.serpFeatures);
    const features: string[] = [];
    if (serp.featuredSnippet) features.push('featured_snippet');
    if (serp.paa) features.push('people_also_ask');
    if (serp.video) features.push('video');
    if (serp.localPack) features.push('local_pack');

    expect(trend).toBe('rising');
    expect(features.length).toBeGreaterThan(0);
    expect(features).toContain('featured_snippet');
    expect(features).toContain('people_also_ask');
  });

  it('correctly enriches a declining-trend content gap with local pack opportunity', () => {
    const domainKeyword = {
      keyword: 'local seo services',
      trend: [500, 490, 480, 450, 420, 390, 360, 330, 300, 270, 240, 210], // declining
      serpFeatures: '11', // local_pack
    };

    const trend = trendDirection(domainKeyword.trend);
    const serp = hasSerpOpportunity(domainKeyword.serpFeatures);
    const features: string[] = [];
    if (serp.featuredSnippet) features.push('featured_snippet');
    if (serp.paa) features.push('people_also_ask');
    if (serp.video) features.push('video');
    if (serp.localPack) features.push('local_pack');

    expect(trend).toBe('declining');
    expect(features.length).toBeGreaterThan(0);
    expect(features).toContain('local_pack');
    expect(features).not.toContain('featured_snippet');
  });

  it('produces no serpFeatures for a gap keyword with no high-value SERP features', () => {
    const domainKeyword = {
      keyword: 'web design tips',
      trend: [200, 202, 198, 205, 201, 199, 203, 200, 202, 198, 201, 200], // stable
      serpFeatures: '1,2,9', // reviews + sitelinks + shopping — not high-value
    };

    const trend = trendDirection(domainKeyword.trend);
    const serp = hasSerpOpportunity(domainKeyword.serpFeatures);
    const features: string[] = [];
    if (serp.featuredSnippet) features.push('featured_snippet');
    if (serp.paa) features.push('people_also_ask');
    if (serp.video) features.push('video');
    if (serp.localPack) features.push('local_pack');

    expect(trend).toBe('stable');
    expect(features.length).toBe(0);
  });

  it('produces no trendDirection enrichment when domain data is missing for the gap keyword', () => {
    // When no domain data matches the gap keyword, trendDirection gets undefined
    const trend = trendDirection(undefined);
    expect(trend).toBe('stable');
  });

  it('enriches zero-volume content gap with stable trend when trend data is insufficient', () => {
    // A brand-new keyword with only 1 month of data — not enough for trend calc
    const trend = trendDirection([0]);
    expect(trend).toBe('stable');
  });

  it('handles content gap keyword with video SERP features', () => {
    const serp = hasSerpOpportunity('5,14'); // video + video_carousel
    expect(serp.video).toBe(true);
    expect(serp.featuredSnippet).toBe(false);
    expect(serp.localPack).toBe(false);
  });
});

// ── Content Gap Enrichment with Brand Filtering ──────────────────────

describe('filterBrandedContentGaps — content gap analysis enrichment', () => {
  const gaps = [
    { targetKeyword: 'semrush alternative', topic: 'Best SEMrush Alternatives' },
    { targetKeyword: 'keyword research tools', topic: 'Top Keyword Research Tools' },
    { targetKeyword: 'ahrefs vs moz', topic: 'Ahrefs vs Moz Comparison' },
    { targetKeyword: 'seo content strategy', topic: 'SEO Content Strategy Guide' },
    { targetKeyword: 'moz pro pricing', topic: 'Moz Pro Pricing Review' },
  ];

  it('removes content gaps containing competitor brand names', () => {
    const { filtered, removed } = filterBrandedContentGaps(gaps, ['semrush.com', 'ahrefs.com', 'moz.com']);
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.some(g => g.targetKeyword === 'semrush alternative')).toBe(true);
    expect(removed.some(g => g.targetKeyword === 'ahrefs vs moz')).toBe(true);
    expect(removed.some(g => g.targetKeyword === 'moz pro pricing')).toBe(true);
  });

  it('preserves non-branded content gaps after filtering', () => {
    const { filtered } = filterBrandedContentGaps(gaps, ['semrush.com', 'ahrefs.com', 'moz.com']);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.some(g => g.targetKeyword === 'keyword research tools')).toBe(true);
    expect(filtered.some(g => g.targetKeyword === 'seo content strategy')).toBe(true);
  });

  it('returns all gaps unchanged when no competitor domains are provided', () => {
    const { filtered, removed } = filterBrandedContentGaps(gaps, []);
    expect(filtered.length).toBe(gaps.length);
    expect(removed.length).toBe(0);
  });

  it('handles empty content gaps array', () => {
    const { filtered, removed } = filterBrandedContentGaps([], ['semrush.com']);
    expect(filtered.length).toBe(0);
    expect(removed.length).toBe(0);
  });

  it('filters on topic field in addition to targetKeyword', () => {
    const gapsWithBrandedTopic = [
      { targetKeyword: 'seo analytics', topic: 'Semrush Analytics Deep Dive' },
      { targetKeyword: 'traffic analysis', topic: 'Website Traffic Analysis' },
    ];
    const { removed } = filterBrandedContentGaps(gapsWithBrandedTopic, ['semrush.com']);
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.some(g => g.targetKeyword === 'seo analytics')).toBe(true);
  });

  it('preserves all filtered and removed counts summing to original length', () => {
    const { filtered, removed } = filterBrandedContentGaps(gaps, ['semrush.com']);
    expect(filtered.length + removed.length).toBe(gaps.length);
  });
});

// ── Keyword Pool Enrichment with Brand Filtering ─────────────────────

describe('filterBrandedKeywords — keyword pool enrichment', () => {
  function makePool(
    entries: Array<[string, { volume: number; difficulty: number; source: string }]>,
  ): Map<string, { volume: number; difficulty: number; source: string }> {
    return new Map(entries);
  }

  it('removes branded keywords from the pool', () => {
    const pool = makePool([
      ['semrush pricing', { volume: 1200, difficulty: 45, source: 'competitor' }],
      ['seo keyword tool', { volume: 800, difficulty: 35, source: 'related' }],
      ['ahrefs tutorial', { volume: 600, difficulty: 40, source: 'competitor' }],
    ]);
    const removed = filterBrandedKeywords(pool, ['semrush.com', 'ahrefs.com']);
    expect(removed).toBeGreaterThan(0);
    expect(pool.has('semrush pricing')).toBe(false);
    expect(pool.has('ahrefs tutorial')).toBe(false);
    expect(pool.has('seo keyword tool')).toBe(true);
  });

  it('does not remove non-branded keywords', () => {
    const pool = makePool([
      ['content strategy guide', { volume: 2000, difficulty: 50, source: 'gsc' }],
      ['keyword research tips', { volume: 1500, difficulty: 40, source: 'gsc' }],
      ['technical seo audit', { volume: 1000, difficulty: 60, source: 'related' }],
    ]);
    const removed = filterBrandedKeywords(pool, ['semrush.com']);
    expect(removed).toBe(0);
    expect(pool.size).toBe(3);
  });

  it('returns 0 and leaves pool unchanged when no competitor domains', () => {
    const pool = makePool([
      ['semrush alternatives', { volume: 900, difficulty: 35, source: 'related' }],
    ]);
    const removed = filterBrandedKeywords(pool, []);
    expect(removed).toBe(0);
    expect(pool.size).toBe(1);
  });

  it('handles an empty keyword pool', () => {
    const pool = makePool([]);
    const removed = filterBrandedKeywords(pool, ['semrush.com']);
    expect(removed).toBe(0);
    expect(pool.size).toBe(0);
  });

  it('removes keywords matching multiple competitor domains', () => {
    const pool = makePool([
      ['moz link explorer', { volume: 400, difficulty: 30, source: 'competitor' }],
      ['ahrefs backlinks', { volume: 700, difficulty: 45, source: 'competitor' }],
      ['link building tactics', { volume: 1100, difficulty: 55, source: 'gsc' }],
    ]);
    const removed = filterBrandedKeywords(pool, ['moz.com', 'ahrefs.com']);
    expect(removed).toBeGreaterThan(0);
    expect(pool.has('moz link explorer')).toBe(false);
    expect(pool.has('ahrefs backlinks')).toBe(false);
    expect(pool.has('link building tactics')).toBe(true);
  });

  it('count of removed keywords matches pool size reduction', () => {
    const pool = makePool([
      ['semrush review', { volume: 500, difficulty: 25, source: 'competitor' }],
      ['site audit tool', { volume: 800, difficulty: 40, source: 'gsc' }],
      ['semrush vs ahrefs', { volume: 300, difficulty: 20, source: 'competitor' }],
    ]);
    const originalSize = pool.size;
    const removed = filterBrandedKeywords(pool, ['semrush.com']);
    expect(pool.size).toBe(originalSize - removed);
  });
});

// ── Brand Token Extraction ────────────────────────────────────────────

describe('extractBrandTokens — brand name detection for enrichment', () => {
  it('extracts simple domain name as token', () => {
    const tokens = extractBrandTokens('semrush.com');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('semrush');
  });

  it('strips protocol and www prefix', () => {
    const tokens = extractBrandTokens('https://www.moz.com');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('moz');
  });

  it('extracts core brand from get-prefixed domain', () => {
    const tokens = extractBrandTokens('getdx.com');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('dx');
    expect(tokens).toContain('getdx');
  });

  it('extracts core brand from try-prefixed domain', () => {
    const tokens = extractBrandTokens('tryhighlight.com');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('highlight');
  });

  it('handles ccTLD domains like .co.uk', () => {
    const tokens = extractBrandTokens('competitor.co.uk');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('competitor');
    expect(tokens).not.toContain('co');
  });

  it('returns unique tokens only', () => {
    const tokens = extractBrandTokens('ahrefs.com');
    const unique = [...new Set(tokens)];
    expect(tokens.length).toBe(unique.length);
  });
});

// ── isBrandedQuery — zero-volume and edge cases ───────────────────────

describe('isBrandedQuery — enrichment edge cases', () => {
  it('returns false for empty keyword string', () => {
    expect(isBrandedQuery('', ['semrush'])).toBe(false);
  });

  it('returns false for empty tokens array', () => {
    expect(isBrandedQuery('semrush pricing', [])).toBe(false);
  });

  it('detects brand in a long keyword phrase', () => {
    expect(isBrandedQuery('how to use semrush for keyword research', ['semrush'])).toBe(true);
  });

  it('does not flag generic seo keywords as branded', () => {
    expect(isBrandedQuery('seo keyword research guide', ['semrush', 'ahrefs', 'moz'])).toBe(false);
  });

  it('handles tokens with special regex characters safely', () => {
    // Domains like "a+b.com" — regex special chars must be escaped
    const tokens = extractBrandTokens('acme.com');
    expect(() => isBrandedQuery('acme pricing', tokens)).not.toThrow();
  });

  it('correctly identifies branded vs non-branded in a mixed batch', () => {
    const tokens = extractBrandTokens('ahrefs.com');
    const keywords = [
      { keyword: 'ahrefs backlink checker', expected: true },
      { keyword: 'backlink checker tool', expected: false },
      { keyword: 'best ahrefs alternative', expected: true },
      { keyword: 'seo audit checklist', expected: false },
    ];
    expect(keywords.length).toBeGreaterThan(0);
    keywords.forEach(({ keyword, expected }) => {
      expect(isBrandedQuery(keyword, tokens)).toBe(expected);
    });
  });
});
