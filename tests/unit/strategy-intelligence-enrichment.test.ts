/**
 * Unit tests for Phase 4A — Strategy generation enrichment with analytics intelligence.
 *
 * Tests buildStrategyIntelligenceBlock() which injects keyword clusters,
 * competitor gaps, performance deltas, and conversion-weighted data
 * into the strategy generation prompt.
 */
import { describe, it, expect, beforeAll } from 'vitest';

describe('buildStrategyIntelligenceBlock', () => {
  let buildStrategyIntelligenceBlock: (opts: {
    keywordClusters?: Array<{
      label: string;
      queries: string[];
      totalImpressions: number;
      avgPosition: number;
      pillarPage: string | null;
    }>;
    competitorGaps?: Array<{
      keyword: string;
      competitorDomain: string;
      competitorPosition: number;
      ourPosition: number | null;
      volume: number;
      difficulty: number;
    }>;
    performanceDeltas?: Array<{
      query: string;
      positionDelta: number;
      clicksDelta: number;
      currentPosition: number;
    }>;
    conversionPages?: Array<{
      pageUrl: string;
      conversions: number;
      conversionRate: number;
      sessions: number;
    }>;
  }) => string;

  beforeAll(async () => {
    const mod = await import('../../server/routes/keyword-strategy.js');
    buildStrategyIntelligenceBlock = mod.buildStrategyIntelligenceBlock;
  });

  it('returns empty string when no intelligence data provided', () => {
    expect(buildStrategyIntelligenceBlock({})).toBe('');
  });

  it('includes keyword clusters with aggregate metrics', () => {
    const result = buildStrategyIntelligenceBlock({
      keywordClusters: [
        { label: 'seo tips', queries: ['seo tips', 'seo tips 2024', 'best seo tips'], totalImpressions: 4300, avgPosition: 8.3, pillarPage: 'https://example.com/blog/seo' },
        { label: 'web design', queries: ['web design services', 'web design agency'], totalImpressions: 2700, avgPosition: 5.0, pillarPage: null },
      ],
    });
    expect(result).toContain('KEYWORD CLUSTERS');
    expect(result).toContain('seo tips');
    expect(result).toContain('3 queries');
    expect(result).toContain('4300');
    expect(result).toContain('/blog/seo');
  });

  it('includes competitor gaps sorted by volume', () => {
    const result = buildStrategyIntelligenceBlock({
      competitorGaps: [
        { keyword: 'backlink checker', competitorDomain: 'ahrefs.com', competitorPosition: 1, ourPosition: null, volume: 5000, difficulty: 70 },
        { keyword: 'seo audit tool', competitorDomain: 'ahrefs.com', competitorPosition: 3, ourPosition: 15, volume: 2000, difficulty: 45 },
      ],
    });
    expect(result).toContain('COMPETITOR GAPS');
    expect(result).toContain('backlink checker');
    expect(result).toContain('ahrefs.com');
    expect(result).toContain('5000');
    // Should mention we don't rank for first keyword
    expect(result).toMatch(/backlink checker.*not ranking|backlink checker.*don.*rank/i);
  });

  it('includes performance deltas for declining keywords', () => {
    const result = buildStrategyIntelligenceBlock({
      performanceDeltas: [
        { query: 'seo tips', positionDelta: 5, clicksDelta: -30, currentPosition: 12 },
        { query: 'web design pricing', positionDelta: -2, clicksDelta: 15, currentPosition: 6 },
      ],
    });
    expect(result).toContain('PERFORMANCE CHANGES');
    expect(result).toContain('seo tips');
    expect(result).toContain('-30');
  });

  it('includes conversion-weighted pages for prioritization', () => {
    const result = buildStrategyIntelligenceBlock({
      conversionPages: [
        { pageUrl: 'https://example.com/services', conversions: 25, conversionRate: 12.5, sessions: 200 },
        { pageUrl: 'https://example.com/contact', conversions: 40, conversionRate: 40.0, sessions: 100 },
      ],
    });
    expect(result).toContain('CONVERSION DATA');
    expect(result).toContain('/services');
    expect(result).toContain('12.5%');
    expect(result).toContain('25 conversions');
  });

  it('combines all intelligence sections', () => {
    const result = buildStrategyIntelligenceBlock({
      keywordClusters: [
        { label: 'seo tips', queries: ['seo tips'], totalImpressions: 2000, avgPosition: 5, pillarPage: null },
      ],
      competitorGaps: [
        { keyword: 'audit tool', competitorDomain: 'moz.com', competitorPosition: 2, ourPosition: null, volume: 1500, difficulty: 40 },
      ],
      performanceDeltas: [
        { query: 'local seo', positionDelta: 3, clicksDelta: -20, currentPosition: 14 },
      ],
      conversionPages: [
        { pageUrl: 'https://example.com/services', conversions: 10, conversionRate: 5.0, sessions: 200 },
      ],
    });
    expect(result).toContain('ANALYTICS INTELLIGENCE');
    expect(result).toContain('KEYWORD CLUSTERS');
    expect(result).toContain('COMPETITOR GAPS');
    expect(result).toContain('PERFORMANCE CHANGES');
    expect(result).toContain('CONVERSION DATA');
  });

  it('caps keyword clusters at 10', () => {
    const clusters = Array.from({ length: 15 }, (_, i) => ({
      label: `cluster ${i}`,
      queries: [`query ${i}`],
      totalImpressions: 1000 - i * 10,
      avgPosition: 5 + i,
      pillarPage: null,
    }));
    const result = buildStrategyIntelligenceBlock({ keywordClusters: clusters });
    const clusterMatches = result.match(/cluster \d+/g) || [];
    expect(clusterMatches.length).toBeLessThanOrEqual(10);
  });

  it('caps competitor gaps at 15', () => {
    const gaps = Array.from({ length: 20 }, (_, i) => ({
      keyword: `keyword ${i}`,
      competitorDomain: 'example.com',
      competitorPosition: 3,
      ourPosition: null,
      volume: 1000 - i * 10,
      difficulty: 40,
    }));
    const result = buildStrategyIntelligenceBlock({ competitorGaps: gaps });
    const gapMatches = result.match(/keyword \d+/g) || [];
    expect(gapMatches.length).toBeLessThanOrEqual(15);
  });
});
