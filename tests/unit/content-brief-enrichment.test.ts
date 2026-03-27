/**
 * Unit tests for Phase 2B — Content brief enrichment with analytics intelligence.
 *
 * Tests the buildBriefIntelligenceBlock() helper that injects
 * traffic potential, cannibalization warnings, decay context, and
 * conversion data into the content brief generation prompt.
 */
import { describe, it, expect, beforeAll } from 'vitest';

describe('buildBriefIntelligenceBlock', () => {
  let buildBriefIntelligenceBlock: (opts: {
    targetKeyword: string;
    workspaceId: string;
    cannibalizationInsights?: Array<{ query: string; pages: string[]; positions: number[] }>;
    decayInsights?: Array<{ pageId: string; deltaPercent: number; baselineClicks: number; currentClicks: number }>;
    quickWins?: Array<{ pageUrl: string; query: string; currentPosition: number; estimatedTrafficGain: number }>;
    pageHealthScores?: Array<{ pageId: string; score: number; trend: string }>;
  }) => string;

  beforeAll(async () => {
    const mod = await import('../../server/content-brief.js');
    buildBriefIntelligenceBlock = mod.buildBriefIntelligenceBlock;
  });

  it('returns empty string when no intelligence data provided', () => {
    const result = buildBriefIntelligenceBlock({
      targetKeyword: 'seo tips',
      workspaceId: 'ws1',
    });
    expect(result).toBe('');
  });

  it('includes cannibalization warning when pages compete for target keyword', () => {
    const result = buildBriefIntelligenceBlock({
      targetKeyword: 'seo tips',
      workspaceId: 'ws1',
      cannibalizationInsights: [
        { query: 'seo tips', pages: ['https://example.com/blog/seo-tips', 'https://example.com/services/seo'], positions: [5, 12] },
      ],
    });
    expect(result).toContain('CANNIBALIZATION');
    expect(result).toContain('seo tips');
    expect(result).toContain('/blog/seo-tips');
    expect(result).toContain('consider updating');
  });

  it('only includes cannibalization insights matching the target keyword', () => {
    const result = buildBriefIntelligenceBlock({
      targetKeyword: 'seo tips',
      workspaceId: 'ws1',
      cannibalizationInsights: [
        { query: 'seo tips', pages: ['https://example.com/blog/seo-tips'], positions: [5] },
        { query: 'web design', pages: ['https://example.com/design'], positions: [3] },
      ],
    });
    expect(result).toContain('seo tips');
    expect(result).not.toContain('web design');
  });

  it('includes decay context when related pages are losing traffic', () => {
    const result = buildBriefIntelligenceBlock({
      targetKeyword: 'seo tips',
      workspaceId: 'ws1',
      decayInsights: [
        { pageId: 'https://example.com/blog/seo-tips', deltaPercent: -35, baselineClicks: 150, currentClicks: 98 },
      ],
    });
    expect(result).toContain('CONTENT DECAY');
    expect(result).toContain('-35');
    expect(result).toContain('freshness');
  });

  it('includes quick win context when related pages are near page 1', () => {
    const result = buildBriefIntelligenceBlock({
      targetKeyword: 'seo tips',
      workspaceId: 'ws1',
      quickWins: [
        { pageUrl: 'https://example.com/blog/seo-tips', query: 'seo tips for beginners', currentPosition: 7, estimatedTrafficGain: 175 },
      ],
    });
    expect(result).toContain('QUICK WIN');
    expect(result).toContain('seo tips for beginners');
    expect(result).toContain('175');
  });

  it('includes page health context for related pages', () => {
    const result = buildBriefIntelligenceBlock({
      targetKeyword: 'seo tips',
      workspaceId: 'ws1',
      pageHealthScores: [
        { pageId: 'https://example.com/blog/seo-tips', score: 72, trend: 'declining' },
      ],
    });
    expect(result).toContain('PAGE HEALTH');
    expect(result).toContain('72/100');
    expect(result).toContain('declining');
  });

  it('combines all intelligence sections when multiple data available', () => {
    const result = buildBriefIntelligenceBlock({
      targetKeyword: 'seo tips',
      workspaceId: 'ws1',
      cannibalizationInsights: [
        { query: 'seo tips', pages: ['https://example.com/a', 'https://example.com/b'], positions: [5, 12] },
      ],
      decayInsights: [
        { pageId: 'https://example.com/a', deltaPercent: -25, baselineClicks: 100, currentClicks: 75 },
      ],
      quickWins: [
        { pageUrl: 'https://example.com/a', query: 'seo tips guide', currentPosition: 8, estimatedTrafficGain: 120 },
      ],
      pageHealthScores: [
        { pageId: 'https://example.com/a', score: 45, trend: 'declining' },
      ],
    });
    expect(result).toContain('ANALYTICS INTELLIGENCE');
    expect(result).toContain('CANNIBALIZATION');
    expect(result).toContain('CONTENT DECAY');
    expect(result).toContain('QUICK WIN');
    expect(result).toContain('PAGE HEALTH');
  });
});
