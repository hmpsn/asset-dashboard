/**
 * Unit tests for Phase 2C — Chat advisor insight classification and context building.
 *
 * Tests that:
 * 1. classifyQuestion detects the new 'insights' category
 * 2. buildInsightsContext() formats intelligence layer data for the chat prompt
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';

// ── Question Classification ────────────────────────────────────

describe('classifyQuestion — insights category', () => {
  let classifyQuestion: (question: string) => Set<string>;

  beforeAll(async () => {
    const mod = await import('../../server/admin-chat-context.js');
    classifyQuestion = mod.classifyQuestion;
  });

  it('detects "what should I work on" as insights', () => {
    const cats = classifyQuestion('What should I work on next?');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "opportunities" as insights', () => {
    const cats = classifyQuestion('What are the biggest opportunities?');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "priorities" as insights', () => {
    const cats = classifyQuestion('What are my priorities this week?');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "quick wins" as insights (also matches strategy)', () => {
    const cats = classifyQuestion('Show me the quick wins');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "declining pages" as insights', () => {
    const cats = classifyQuestion('Which pages are declining?');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "cannibalization" as insights', () => {
    const cats = classifyQuestion('Do I have any keyword cannibalization issues?');
    expect(cats.has('insights')).toBe(true);
  });

  it('detects "page health" as insights', () => {
    const cats = classifyQuestion('Show me page health scores');
    expect(cats.has('insights')).toBe(true);
  });
});

// ── Insights Context Builder ────────────────────────────────────

describe('buildInsightsContext', () => {
  let buildInsightsContext: (insights: AnalyticsInsight[]) => string;

  beforeAll(async () => {
    const mod = await import('../../server/admin-chat-context.js');
    buildInsightsContext = mod.buildInsightsContext;
  });

  it('returns empty string when no insights provided', () => {
    expect(buildInsightsContext([])).toBe('');
  });

  it('includes page health summary', () => {
    const insights: AnalyticsInsight[] = [
      { id: '1', workspaceId: 'ws1', pageId: 'https://example.com/blog', insightType: 'page_health', data: { score: 72, trend: 'improving', clicks: 500, impressions: 8000, position: 3.2, ctr: 0.0625, pageviews: 1200, bounceRate: 0, avgEngagementTime: 120 }, severity: 'positive', computedAt: new Date().toISOString() },
      { id: '2', workspaceId: 'ws1', pageId: 'https://example.com/about', insightType: 'page_health', data: { score: 25, trend: 'declining', clicks: 10, impressions: 200, position: 25, ctr: 0.05, pageviews: 0, bounceRate: 0, avgEngagementTime: 0 }, severity: 'warning', computedAt: new Date().toISOString() },
    ];
    const result = buildInsightsContext(insights);
    expect(result).toContain('PAGE HEALTH');
    expect(result).toContain('72');
    expect(result).toContain('25');
  });

  it('includes quick wins section', () => {
    const insights: AnalyticsInsight[] = [
      { id: '1', workspaceId: 'ws1', pageId: 'https://example.com/blog', insightType: 'ranking_opportunity', data: { query: 'seo tips', currentPosition: 7, impressions: 2000, estimatedTrafficGain: 175, pageUrl: 'https://example.com/blog' }, severity: 'opportunity', computedAt: new Date().toISOString() },
    ];
    const result = buildInsightsContext(insights);
    expect(result).toContain('QUICK WINS');
    expect(result).toContain('seo tips');
    expect(result).toContain('175');
  });

  it('includes content decay section', () => {
    const insights: AnalyticsInsight[] = [
      { id: '1', workspaceId: 'ws1', pageId: 'https://example.com/old', insightType: 'content_decay', data: { baselineClicks: 150, currentClicks: 50, deltaPercent: -66.7, baselinePeriod: 'previous_30d', currentPeriod: 'current_30d' }, severity: 'critical', computedAt: new Date().toISOString() },
    ];
    const result = buildInsightsContext(insights);
    expect(result).toContain('CONTENT DECAY');
    expect(result).toContain('-66.7%');
  });

  it('includes cannibalization section', () => {
    const insights: AnalyticsInsight[] = [
      { id: '1', workspaceId: 'ws1', pageId: null, insightType: 'cannibalization', data: { query: 'seo services', pages: ['https://example.com/a', 'https://example.com/b'], positions: [5, 12] }, severity: 'warning', computedAt: new Date().toISOString() },
    ];
    const result = buildInsightsContext(insights);
    expect(result).toContain('CANNIBALIZATION');
    expect(result).toContain('seo services');
  });

  it('groups multiple insight types together', () => {
    const insights: AnalyticsInsight[] = [
      { id: '1', workspaceId: 'ws1', pageId: 'https://example.com/blog', insightType: 'page_health', data: { score: 72, trend: 'stable', clicks: 500, impressions: 8000, position: 3.2, ctr: 0.0625, pageviews: 1200, bounceRate: 0, avgEngagementTime: 120 }, severity: 'positive', computedAt: new Date().toISOString() },
      { id: '2', workspaceId: 'ws1', pageId: 'https://example.com/blog', insightType: 'ranking_opportunity', data: { query: 'seo tips', currentPosition: 7, impressions: 2000, estimatedTrafficGain: 175, pageUrl: 'https://example.com/blog' }, severity: 'opportunity', computedAt: new Date().toISOString() },
      { id: '3', workspaceId: 'ws1', pageId: null, insightType: 'cannibalization', data: { query: 'seo', pages: ['https://example.com/a', 'https://example.com/b'], positions: [3, 8] }, severity: 'warning', computedAt: new Date().toISOString() },
    ];
    const result = buildInsightsContext(insights);
    expect(result).toContain('ANALYTICS INTELLIGENCE');
    expect(result).toContain('PAGE HEALTH');
    expect(result).toContain('QUICK WINS');
    expect(result).toContain('CANNIBALIZATION');
  });
});
