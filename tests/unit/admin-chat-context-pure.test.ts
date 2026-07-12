/**
 * Wave 7 — Pure function unit tests for server/admin-chat-context.ts
 *
 * Covers:
 *   - extractUrl: full URLs, relative paths, embedded URLs, multiple URLs, no URL
 *   - classifyQuestion: copy/approvals/competitors/performance/general expansion
 *     and edge cases not covered by admin-chat-question-routing.test.ts
 *   - buildInsightsContext: ALL insight types, sorting/pagination limits,
 *     critical severity summary, unknown types, enrichment fields
 *
 * Does NOT re-test patterns already covered by:
 *   - tests/unit/admin-chat-question-routing.test.ts (search/analytics/content/
 *     strategy/insights/performance/audit/competitors/ranks/client/activity/
 *     page_analysis/content_review/general routing + multi-category combos)
 *   - tests/unit/chat-context-insights.test.ts (basic page_health/ranking_opportunity/
 *     content_decay/cannibalization buildInsightsContext basics)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';

// ── Dynamic imports (module uses side-effect imports that need mocking isolation) ──
// These three functions are pure (no DB, no I/O) and can be imported directly.
// The module has many side-effect imports (logger, db-backed modules) but since
// we only call pure functions they never execute during the test run.

let extractUrl: (question: string) => string | null;
let classifyQuestion: (question: string) => Set<string>;
let buildInsightsContext: (insights: AnalyticsInsight[]) => string;

beforeAll(async () => {
  const mod = await import('../../server/admin-chat-context.js');
  extractUrl = mod.extractUrl;
  classifyQuestion = mod.classifyQuestion;
  buildInsightsContext = mod.buildInsightsContext;
});

// ════════════════════════════════════════════════════════════════════════════
// extractUrl
// ════════════════════════════════════════════════════════════════════════════

describe('extractUrl', () => {
  // ── Full HTTP/HTTPS URLs ──────────────────────────────────────────────────

  describe('full HTTP/HTTPS URLs', () => {
    it('returns a bare https URL', () => {
      expect(extractUrl('https://example.com/blog')).toBe('https://example.com/blog');
    });

    it('returns a bare http URL', () => {
      expect(extractUrl('http://example.com/page')).toBe('http://example.com/page');
    });

    it('extracts URL embedded in a sentence', () => {
      expect(extractUrl('Can you analyze https://example.com/services for me?')).toBe(
        'https://example.com/services',
      );
    });

    it('extracts URL at the end of a sentence (no trailing punctuation)', () => {
      expect(extractUrl('Please review https://acme.io/about')).toBe('https://acme.io/about');
    });

    it('returns the FIRST URL when multiple are present', () => {
      const result = extractUrl(
        'Compare https://example.com/a with https://example.com/b',
      );
      expect(result).toBe('https://example.com/a');
    });

    it('handles URLs with query strings', () => {
      expect(extractUrl('Check https://example.com/search?q=seo&page=2')).toBe(
        'https://example.com/search?q=seo&page=2',
      );
    });

    it('handles URLs with hash fragments', () => {
      expect(extractUrl('Go to https://example.com/docs#section-3')).toBe(
        'https://example.com/docs#section-3',
      );
    });

    it('handles URLs with path segments', () => {
      expect(extractUrl('Analyze https://example.com/blog/category/seo-tips')).toBe(
        'https://example.com/blog/category/seo-tips',
      );
    });
  });

  // ── Relative paths ────────────────────────────────────────────────────────

  describe('relative paths starting with /', () => {
    it('returns a simple relative path at start of string', () => {
      expect(extractUrl('/services')).toBe('/services');
    });

    it('returns a relative path after whitespace', () => {
      expect(extractUrl('Review the page at /blog/post-title')).toBe('/blog/post-title');
    });

    it('returns a nested relative path', () => {
      expect(extractUrl('What is wrong with /services/seo-consulting?')).toBe(
        '/services/seo-consulting',
      );
    });

    it('returns a relative path with numbers in segments', () => {
      expect(extractUrl('Check /2024/annual-report')).toBe('/2024/annual-report');
    });
  });

  // ── No URL cases ──────────────────────────────────────────────────────────

  describe('no URL present', () => {
    it('returns null for a plain text question', () => {
      expect(extractUrl('What is our overall SEO score?')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(extractUrl('')).toBeNull();
    });

    it('returns null for a question with no path-like text', () => {
      expect(extractUrl('How are our rankings this month?')).toBeNull();
    });

    it('returns null for a question mentioning a domain without protocol or slash-path', () => {
      // Plain domain names without https:// and without a / path
      expect(extractUrl('Our competitor is acme.io, what do they do?')).toBeNull();
    });
  });

  // ── Priority: full URL wins over relative path ────────────────────────────

  describe('URL type priority', () => {
    it('returns the full https URL when both a full URL and relative path appear', () => {
      const result = extractUrl(
        'Compare https://example.com/services with /services-local',
      );
      // Full URL match is checked first, so it takes precedence
      expect(result).toBe('https://example.com/services');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// classifyQuestion — edge cases not in admin-chat-question-routing.test.ts
// ════════════════════════════════════════════════════════════════════════════

describe('classifyQuestion — additional edge cases', () => {
  // ── Copy category ─────────────────────────────────────────────────────────

  describe('copy category', () => {
    it('detects "copywriting" as copy', () => {
      const cats = classifyQuestion('Can you review our copywriting approach?');
      expect(cats.has('copy')).toBe(true);
    });

    it('detects "copy blueprint" as copy', () => {
      const cats = classifyQuestion('Show me the copy blueprint status');
      expect(cats.has('copy')).toBe(true);
    });

    it('detects "copy pipeline" as copy', () => {
      const cats = classifyQuestion('What is in the copy pipeline?');
      expect(cats.has('copy')).toBe(true);
    });

    it('detects "copy deck" as copy', () => {
      const cats = classifyQuestion('Can you pull up the copy deck?');
      expect(cats.has('copy')).toBe(true);
    });

    it('detects "blueprint status" as copy', () => {
      const cats = classifyQuestion('What is the blueprint status for the homepage?');
      expect(cats.has('copy')).toBe(true);
    });

    it('detects "approved copy" as copy', () => {
      const cats = classifyQuestion('How much approved copy do we have?');
      expect(cats.has('copy')).toBe(true);
    });

    it('detects "section status" as copy', () => {
      const cats = classifyQuestion('What is the section status for the about page?');
      expect(cats.has('copy')).toBe(true);
    });

    it('detects "generated copy" as copy', () => {
      const cats = classifyQuestion('Can you show me the generated copy for the services page?');
      expect(cats.has('copy')).toBe(true);
    });

    it('detects "copy review" as copy', () => {
      const cats = classifyQuestion('We need a copy review on the homepage');
      expect(cats.has('copy')).toBe(true);
    });
  });

  // ── Approvals category ────────────────────────────────────────────────────

  describe('approvals category', () => {
    it('detects "approval" as approvals', () => {
      const cats = classifyQuestion('How many approvals are pending?');
      expect(cats.has('approvals')).toBe(true);
    });

    it('detects "pending" as approvals', () => {
      const cats = classifyQuestion('What items are pending review?');
      expect(cats.has('approvals')).toBe(true);
    });

    it('detects "batch" as approvals', () => {
      const cats = classifyQuestion('Show me the approval batch status');
      expect(cats.has('approvals')).toBe(true);
    });

    it('detects "sign off" as approvals', () => {
      const cats = classifyQuestion('The client needs to sign off on the changes');
      expect(cats.has('approvals')).toBe(true);
    });

    it('detects "approve" as approvals', () => {
      const cats = classifyQuestion('Did the client approve the latest batch?');
      expect(cats.has('approvals')).toBe(true);
    });

    it('detects "reject" as approvals', () => {
      const cats = classifyQuestion('Which items did the client reject?');
      expect(cats.has('approvals')).toBe(true);
    });
  });

  // ── General expansion — specific trigger words ────────────────────────────

  describe('general category trigger words', () => {
    it('"full report" triggers general and expands to all core sources', () => {
      const cats = classifyQuestion('Give me a full report');
      expect(cats.has('general')).toBe(true);
      expect(cats.has('search')).toBe(true);
      expect(cats.has('analytics')).toBe(true);
      expect(cats.has('audit')).toBe(true);
    });

    it('"everything" triggers general', () => {
      const cats = classifyQuestion('Tell me everything about this workspace');
      expect(cats.has('general')).toBe(true);
    });

    it('"what is next" triggers general', () => {
      const cats = classifyQuestion('What is next for the SEO campaign?');
      expect(cats.has('general')).toBe(true);
    });

    it('"this month" triggers general', () => {
      const cats = classifyQuestion('How did we do this month?');
      expect(cats.has('general')).toBe(true);
    });

    it('"work on" triggers general', () => {
      const cats = classifyQuestion('What should we work on today?');
      expect(cats.has('general')).toBe(true);
    });
  });

  // ── General expansion set contents ────────────────────────────────────────

  describe('general expansion completeness', () => {
    it('empty-ish question expands to all 8 expected core categories', () => {
      // A question that matches no specific pattern → should hit general + expansion
      const cats = classifyQuestion('zxqyzxqy gibberish plzklpq');
      expect(cats.has('general')).toBe(true);
      expect(cats.has('search')).toBe(true);
      expect(cats.has('analytics')).toBe(true);
      expect(cats.has('audit')).toBe(true);
      expect(cats.has('content')).toBe(true);
      expect(cats.has('ranks')).toBe(true);
      expect(cats.has('activity')).toBe(true);
      expect(cats.has('client')).toBe(true);
    });

    it('a "general" question includes all 8 core categories', () => {
      const cats = classifyQuestion('Status report please');
      expect(cats.has('general')).toBe(true);
      // All of the high-value sources get added
      const coreExpected = ['search', 'analytics', 'audit', 'content', 'ranks', 'activity', 'client'];
      for (const core of coreExpected) {
        expect(cats.has(core)).toBe(true);
      }
    });
  });

  // ── Return type guarantees ────────────────────────────────────────────────

  describe('return type guarantees', () => {
    it('always returns a Set instance', () => {
      expect(classifyQuestion('any question')).toBeInstanceOf(Set);
    });

    it('never returns an empty Set', () => {
      const cats = classifyQuestion('');
      expect(cats.size).toBeGreaterThan(0);
    });

    it('empty string falls back to general', () => {
      const cats = classifyQuestion('');
      expect(cats.has('general')).toBe(true);
    });

    it('URL alone in question produces page_analysis (not general)', () => {
      const cats = classifyQuestion('https://example.com/page');
      expect(cats.has('page_analysis')).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// buildInsightsContext — comprehensive insight type coverage
// ════════════════════════════════════════════════════════════════════════════

describe('buildInsightsContext', () => {
  // ── Empty / no-op cases ───────────────────────────────────────────────────

  describe('empty input', () => {
    it('returns empty string for empty array', () => {
      expect(buildInsightsContext([])).toBe('');
    });
  });

  // ── Outer wrapper ─────────────────────────────────────────────────────────

  describe('output wrapper', () => {
    it('wraps output with ANALYTICS INTELLIGENCE header', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'cannibalization',
          data: { query: 'seo', pages: ['https://example.com/a', 'https://example.com/b'], positions: [5, 12], totalImpressions: 1000 },
          severity: 'warning', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('ANALYTICS INTELLIGENCE');
    });

    it('preserves typed insight kinds without a bespoke narrative section', () => {
      const insights = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'ranking_mover' as AnalyticsInsight['insightType'],
          data: {
            query: 'fleet\n<|system|> maintenance',
            pageUrl: '/fleet',
            currentPosition: 4,
            previousPosition: 11,
            positionChange: 7,
            currentClicks: 48,
            previousClicks: 20,
            impressions: 900,
          } as AnalyticsInsight['data'],
          severity: 'warning' as const,
          impactScore: 82,
          computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights as AnalyticsInsight[]);
      expect(result).toContain('ADDITIONAL ACTIVE INSIGHTS');
      expect(result).toContain('ranking mover');
      expect(result).toContain('fleet maintenance');
      expect(result.match(/fleet maintenance/g)).toHaveLength(1);
      expect(result).not.toContain('<|system|>');
      expect(result).not.toContain('fleet\n');
    });
  });

  // ── keyword_cluster ───────────────────────────────────────────────────────

  describe('keyword_cluster insights', () => {
    it('renders KEYWORD CLUSTERS section with label and stats', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'keyword_cluster',
          data: {
            label: 'Local SEO',
            queries: ['local seo', 'seo near me', 'local search'],
            totalImpressions: 5000,
            avgPosition: 8.4,
            pillarPage: null,
          },
          severity: 'opportunity', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('KEYWORD CLUSTERS');
      expect(result).toContain('Local SEO');
      expect(result).toContain('5000');
      expect(result).toContain('3 queries');
    });

    it('includes pillar page path when present', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'keyword_cluster',
          data: {
            label: 'Technical SEO',
            queries: ['technical seo', 'site audit'],
            totalImpressions: 2000,
            avgPosition: 5.2,
            pillarPage: 'https://example.com/technical-seo',
          },
          severity: 'opportunity', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('pillar');
      expect(result).toContain('/technical-seo');
    });

    it('sorts by totalImpressions descending', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'keyword_cluster',
          data: { label: 'Small Cluster', queries: ['a'], totalImpressions: 100, avgPosition: 5, pillarPage: null },
          severity: 'opportunity', computedAt: new Date().toISOString(),
        },
        {
          id: '2', workspaceId: 'ws1', pageId: null,
          insightType: 'keyword_cluster',
          data: { label: 'Big Cluster', queries: ['b', 'c'], totalImpressions: 9000, avgPosition: 3, pillarPage: null },
          severity: 'opportunity', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      const bigIdx = result.indexOf('Big Cluster');
      const smallIdx = result.indexOf('Small Cluster');
      expect(bigIdx).toBeLessThan(smallIdx);
    });
  });

  // ── competitor_gap ────────────────────────────────────────────────────────

  describe('competitor_gap insights', () => {
    it('renders COMPETITOR GAPS section', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'competitor_gap',
          data: {
            keyword: 'seo services nyc',
            competitorDomain: 'rival.com',
            competitorPosition: 3,
            ourPosition: null,
            volume: 1200,
            difficulty: 45,
          },
          severity: 'opportunity', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('COMPETITOR GAPS');
      expect(result).toContain('seo services nyc');
      expect(result).toContain('rival.com');
      expect(result).toContain("don't rank");
    });

    it('shows our position when we do rank', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'competitor_gap',
          data: {
            keyword: 'seo audit',
            competitorDomain: 'rival.com',
            competitorPosition: 2,
            ourPosition: 14,
            volume: 800,
            difficulty: 38,
          },
          severity: 'opportunity', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('our pos 14');
    });

    it('sorts by volume descending', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'competitor_gap',
          data: { keyword: 'low vol', competitorDomain: 'a.com', competitorPosition: 5, ourPosition: null, volume: 50, difficulty: 20 },
          severity: 'opportunity', computedAt: new Date().toISOString(),
        },
        {
          id: '2', workspaceId: 'ws1', pageId: null,
          insightType: 'competitor_gap',
          data: { keyword: 'high vol', competitorDomain: 'b.com', competitorPosition: 3, ourPosition: null, volume: 5000, difficulty: 60 },
          severity: 'opportunity', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      const highIdx = result.indexOf('high vol');
      const lowIdx = result.indexOf('low vol');
      expect(highIdx).toBeLessThan(lowIdx);
    });
  });

  // ── conversion_attribution ────────────────────────────────────────────────

  describe('conversion_attribution insights', () => {
    it('renders CONVERSION ATTRIBUTION section', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'https://example.com/contact',
          insightType: 'conversion_attribution',
          data: {
            sessions: 500,
            conversions: 20,
            conversionRate: 4.0,
            estimatedRevenue: null,
          },
          severity: 'positive', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('CONVERSION ATTRIBUTION');
      expect(result).toContain('/contact');
      expect(result).toContain('4.0%');
      expect(result).toContain('20 conversions');
    });

    it('handles non-URL pageId gracefully', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'contact-page',
          insightType: 'conversion_attribution',
          data: { sessions: 100, conversions: 5, conversionRate: 5.0, estimatedRevenue: null },
          severity: 'positive', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('CONVERSION ATTRIBUTION');
      expect(result).toContain('contact-page');
    });

    it('sorts by conversionRate descending', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'https://example.com/low-cvr',
          insightType: 'conversion_attribution',
          data: { sessions: 1000, conversions: 5, conversionRate: 0.5, estimatedRevenue: null },
          severity: 'positive', computedAt: new Date().toISOString(),
        },
        {
          id: '2', workspaceId: 'ws1', pageId: 'https://example.com/high-cvr',
          insightType: 'conversion_attribution',
          data: { sessions: 200, conversions: 30, conversionRate: 15.0, estimatedRevenue: null },
          severity: 'positive', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      const highIdx = result.indexOf('/high-cvr');
      const lowIdx = result.indexOf('/low-cvr');
      expect(highIdx).toBeLessThan(lowIdx);
    });
  });

  // ── anomaly_digest ────────────────────────────────────────────────────────

  describe('anomaly_digest insights', () => {
    it('renders ANOMALY DIGEST section', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'anomaly_digest',
          data: {
            anomalyType: 'traffic_drop',
            metric: 'clicks',
            currentValue: 50,
            expectedValue: 200,
            deviationPercent: -75,
            durationDays: 7,
            firstDetected: new Date().toISOString(),
            severity: 'critical',
          },
          severity: 'critical', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('ANOMALY DIGEST');
      expect(result).toContain('traffic_drop');
      expect(result).toContain('clicks');
      expect(result).toContain('-75%');
      expect(result).toContain('7 day');
    });

    it('includes affected page when present', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'anomaly_digest',
          data: {
            anomalyType: 'ctr_drop',
            metric: 'ctr',
            currentValue: 1.2,
            expectedValue: 5.0,
            deviationPercent: -76,
            durationDays: 3,
            firstDetected: new Date().toISOString(),
            severity: 'warning',
            affectedPage: '/blog/seo-guide',
          },
          severity: 'warning', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('/blog/seo-guide');
    });

    it('omits affected page suffix when affectedPage is absent', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'anomaly_digest',
          data: {
            anomalyType: 'impression_spike',
            metric: 'impressions',
            currentValue: 8000,
            expectedValue: 2000,
            deviationPercent: 300,
            durationDays: 2,
            firstDetected: new Date().toISOString(),
            severity: 'positive',
          },
          severity: 'positive', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).not.toContain('affected page:');
    });
  });

  // ── competitor_alert ──────────────────────────────────────────────────────

  describe('competitor_alert insights', () => {
    it('renders COMPETITOR ALERTS section', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'competitor_alert',
          data: {
            competitorDomain: 'rival.com',
            alertType: 'keyword_gained',
            keyword: 'seo audit tool',
            previousPosition: undefined,
            currentPosition: 5,
            volume: 2000,
            snapshotDate: '2026-05-01',
          },
          severity: 'warning', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('COMPETITOR ALERTS');
      expect(result).toContain('rival.com');
      expect(result).toContain('keyword_gained');
      expect(result).toContain('seo audit tool');
    });

    it('includes position change when previousPosition and currentPosition are both set', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'competitor_alert',
          data: {
            competitorDomain: 'rival.com',
            alertType: 'keyword_gained',
            keyword: 'content strategy',
            previousPosition: 12,
            currentPosition: 4,
            volume: 1500,
            snapshotDate: '2026-05-01',
          },
          severity: 'warning', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      // Should show "pos 12 → 4"
      expect(result).toContain('12');
      expect(result).toContain('4');
    });

    it('includes volume suffix when volume is present', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'competitor_alert',
          data: {
            competitorDomain: 'rival.com',
            alertType: 'authority_change',
            volume: 5000,
            snapshotDate: '2026-05-01',
          },
          severity: 'warning', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('5,000');
    });
  });

  // ── emerging_keyword ──────────────────────────────────────────────────────

  describe('emerging_keyword insights', () => {
    it('renders EMERGING KEYWORDS section', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'emerging_keyword',
          data: {
            keyword: 'ai seo tools',
            volume: 3000,
            difficulty: 42,
            currentPosition: 18,
          },
          severity: 'opportunity', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('EMERGING KEYWORDS');
      expect(result).toContain('ai seo tools');
      expect(result).toContain('3,000');
      expect(result).toContain('KD 42');
      expect(result).toContain('pos 18');
    });

    it('shows "(not yet ranking)" when currentPosition is null', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'emerging_keyword',
          data: {
            keyword: 'brand new keyword',
            volume: 500,
            difficulty: 20,
            currentPosition: undefined,
          },
          severity: 'opportunity', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('not yet ranking');
    });

    it('omits KD when difficulty is null/undefined', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'emerging_keyword',
          data: {
            keyword: 'no kd keyword',
            volume: 200,
            difficulty: undefined as unknown as number,
            currentPosition: undefined,
          },
          severity: 'opportunity', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).not.toContain('KD');
    });
  });

  // ── freshness_alert ───────────────────────────────────────────────────────

  describe('freshness_alert insights', () => {
    it('renders STALE CONTENT section', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'freshness_alert',
          data: {
            pagePath: '/blog/old-post',
            lastAnalyzedAt: '2025-12-01T00:00:00Z',
            daysSinceLastAnalysis: 175,
            impressions: 12000,
          },
          severity: 'warning', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('STALE CONTENT');
      expect(result).toContain('/blog/old-post');
      expect(result).toContain('175 days');
    });

    it('includes impressions when present', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'freshness_alert',
          data: {
            pagePath: '/services',
            lastAnalyzedAt: '2025-11-01T00:00:00Z',
            daysSinceLastAnalysis: 200,
            impressions: 8500,
          },
          severity: 'warning', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('8,500');
    });

    it('sorts by daysSinceLastAnalysis descending (stalest first)', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'freshness_alert',
          data: { pagePath: '/recent', lastAnalyzedAt: '2026-04-01T00:00:00Z', daysSinceLastAnalysis: 30 },
          severity: 'warning', computedAt: new Date().toISOString(),
        },
        {
          id: '2', workspaceId: 'ws1', pageId: null,
          insightType: 'freshness_alert',
          data: { pagePath: '/ancient', lastAnalyzedAt: '2025-01-01T00:00:00Z', daysSinceLastAnalysis: 500 },
          severity: 'warning', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      const ancientIdx = result.indexOf('/ancient');
      const recentIdx = result.indexOf('/recent');
      expect(ancientIdx).toBeLessThan(recentIdx);
    });
  });

  // ── Critical severity summary ─────────────────────────────────────────────

  describe('critical severity summary', () => {
    it('adds a critical count line when any insight is critical', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'https://example.com/bad',
          insightType: 'page_health',
          data: { score: 10, trend: 'declining', clicks: 5, impressions: 100, position: 50, ctr: 0.05, pageviews: 10, bounceRate: 90, avgEngagementTime: 5 },
          severity: 'critical', computedAt: new Date().toISOString(),
        },
        {
          id: '2', workspaceId: 'ws1', pageId: 'https://example.com/also-bad',
          insightType: 'page_health',
          data: { score: 15, trend: 'declining', clicks: 2, impressions: 50, position: 60, ctr: 0.04, pageviews: 5, bounceRate: 95, avgEngagementTime: 2 },
          severity: 'critical', computedAt: new Date().toISOString(),
        },
        {
          id: '3', workspaceId: 'ws1', pageId: 'https://example.com/ok',
          insightType: 'page_health',
          data: { score: 80, trend: 'stable', clicks: 500, impressions: 5000, position: 3, ctr: 0.1, pageviews: 1000, bounceRate: 30, avgEngagementTime: 90 },
          severity: 'positive', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('2 CRITICAL INSIGHTS');
    });

    it('does not add critical line when no critical insights exist', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'https://example.com/ok',
          insightType: 'page_health',
          data: { score: 75, trend: 'stable', clicks: 300, impressions: 3000, position: 5, ctr: 0.1, pageviews: 700, bounceRate: 35, avgEngagementTime: 80 },
          severity: 'warning', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).not.toContain('CRITICAL INSIGHTS');
    });

    it('counts exactly 1 critical insight correctly', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'cannibalization',
          data: { query: 'critical kw', pages: ['https://a.com/1', 'https://a.com/2'], positions: [3, 5], totalImpressions: 2000 },
          severity: 'critical', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('1 CRITICAL INSIGHTS');
    });
  });

  // ── Pagination / slice limits ─────────────────────────────────────────────

  describe('pagination limits', () => {
    it('page_health is limited to 10 entries', () => {
      const insights: AnalyticsInsight[] = Array.from({ length: 15 }, (_, i) => ({
        id: String(i), workspaceId: 'ws1', pageId: `https://example.com/page-${i}`,
        insightType: 'page_health' as const,
        data: { score: i * 5, trend: 'stable' as const, clicks: i, impressions: i * 10, position: 50 - i, ctr: 0.05, pageviews: i * 2, bounceRate: 50, avgEngagementTime: 60 },
        severity: 'warning' as const, computedAt: new Date().toISOString(),
      }));
      const result = buildInsightsContext(insights);
      // Only 10 should appear. Each has a unique /page-N path.
      // Easiest check: the 11th lowest-score page (page-10 with score 50) should be absent.
      // The 10 lowest scores are pages 0–9 (scores 0–45).
      expect(result).toContain('/page-0');
      expect(result).toContain('/page-9');
      expect(result).not.toContain('/page-10');
    });

    it('ranking_opportunity is limited to 10 entries', () => {
      const insights: AnalyticsInsight[] = Array.from({ length: 15 }, (_, i) => ({
        id: String(i), workspaceId: 'ws1', pageId: null,
        insightType: 'ranking_opportunity' as const,
        data: { query: `query-${i}`, currentPosition: 8, impressions: 1000, estimatedTrafficGain: 100 + i * 10, pageUrl: 'https://example.com' },
        severity: 'opportunity' as const, computedAt: new Date().toISOString(),
      }));
      const result = buildInsightsContext(insights);
      // Sorted descending by estimatedTrafficGain: query-14 (240) through query-5 (150) are top 10
      expect(result).toContain('query-14');
      expect(result).not.toContain('query-4'); // estimatedTrafficGain: 140 — rank 11
    });

    it('content_decay is limited to 8 entries', () => {
      const insights: AnalyticsInsight[] = Array.from({ length: 12 }, (_, i) => ({
        id: String(i), workspaceId: 'ws1', pageId: `https://example.com/decay-${i}`,
        insightType: 'content_decay' as const,
        data: { baselineClicks: 100, currentClicks: 50 - i, deltaPercent: -50 - i, baselinePeriod: '30d', currentPeriod: '30d' },
        severity: 'warning' as const, computedAt: new Date().toISOString(),
      }));
      const result = buildInsightsContext(insights);
      // Worst 8 by deltaPercent ascending: decay-11 through decay-4
      expect(result).toContain('/decay-11');
      expect(result).not.toContain('/decay-0'); // least bad, rank 12
    });

    it('competitor_gap is limited to 10 entries', () => {
      const insights: AnalyticsInsight[] = Array.from({ length: 15 }, (_, i) => ({
        id: String(i), workspaceId: 'ws1', pageId: null,
        insightType: 'competitor_gap' as const,
        data: { keyword: `gap-kw-${i}`, competitorDomain: 'rival.com', competitorPosition: 3, ourPosition: null, volume: i * 100, difficulty: 40 },
        severity: 'opportunity' as const, computedAt: new Date().toISOString(),
      }));
      const result = buildInsightsContext(insights);
      // Top 10 by volume: gap-kw-14 (1400) down to gap-kw-5 (500)
      expect(result).toContain('gap-kw-14');
      expect(result).not.toContain('gap-kw-4'); // volume 400, rank 11
    });
  });

  // ── Enrichment fields on page_health ─────────────────────────────────────

  describe('page_health enrichment fields', () => {
    it('includes strategy alignment when not "untracked"', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'https://example.com/aligned',
          insightType: 'page_health',
          data: { score: 60, trend: 'stable', clicks: 200, impressions: 2000, position: 8, ctr: 0.1, pageviews: 400, bounceRate: 50, avgEngagementTime: 60 },
          severity: 'warning', computedAt: new Date().toISOString(),
          strategyAlignment: 'aligned',
          pageTitle: 'Aligned Page',
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('strategy: aligned');
    });

    it('omits strategy when strategyAlignment is "untracked"', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'https://example.com/untracked',
          insightType: 'page_health',
          data: { score: 55, trend: 'stable', clicks: 100, impressions: 1000, position: 12, ctr: 0.1, pageviews: 200, bounceRate: 55, avgEngagementTime: 45 },
          severity: 'warning', computedAt: new Date().toISOString(),
          strategyAlignment: 'untracked',
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).not.toContain('strategy:');
    });

    it('uses pageTitle when available instead of URL pathname', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'https://example.com/contact',
          insightType: 'page_health',
          data: { score: 45, trend: 'declining', clicks: 30, impressions: 500, position: 18, ctr: 0.06, pageviews: 80, bounceRate: 70, avgEngagementTime: 20 },
          severity: 'warning', computedAt: new Date().toISOString(),
          pageTitle: 'Contact Us — My Company',
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('Contact Us — My Company');
    });

    it('includes pipeline status when present', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'https://example.com/in-progress',
          insightType: 'page_health',
          data: { score: 40, trend: 'stable', clicks: 50, impressions: 800, position: 22, ctr: 0.0625, pageviews: 100, bounceRate: 65, avgEngagementTime: 30 },
          severity: 'warning', computedAt: new Date().toISOString(),
          pipelineStatus: 'in_progress',
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('pipeline: in_progress');
    });

    it('sorts page_health worst-first (lowest score first)', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'https://example.com/great',
          insightType: 'page_health',
          data: { score: 90, trend: 'improving', clicks: 1000, impressions: 10000, position: 2, ctr: 0.1, pageviews: 2000, bounceRate: 20, avgEngagementTime: 180 },
          severity: 'positive', computedAt: new Date().toISOString(),
        },
        {
          id: '2', workspaceId: 'ws1', pageId: 'https://example.com/terrible',
          insightType: 'page_health',
          data: { score: 5, trend: 'declining', clicks: 1, impressions: 20, position: 85, ctr: 0.05, pageviews: 2, bounceRate: 99, avgEngagementTime: 2 },
          severity: 'critical', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      const terribleIdx = result.indexOf('/terrible');
      const greatIdx = result.indexOf('/great');
      expect(terribleIdx).toBeLessThan(greatIdx);
    });
  });

  // ── ranking_opportunity enrichment ────────────────────────────────────────

  describe('ranking_opportunity enrichment fields', () => {
    it('includes pageTitle in output when set', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'https://example.com/blog',
          insightType: 'ranking_opportunity',
          data: { query: 'seo tips 2026', currentPosition: 9, impressions: 3000, estimatedTrafficGain: 250, pageUrl: 'https://example.com/blog' },
          severity: 'opportunity', computedAt: new Date().toISOString(),
          pageTitle: 'Our SEO Blog',
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('Our SEO Blog');
    });

    it('includes strategy alignment for ranking_opportunity', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'https://example.com/service',
          insightType: 'ranking_opportunity',
          data: { query: 'web design services', currentPosition: 11, impressions: 5000, estimatedTrafficGain: 400, pageUrl: 'https://example.com/service' },
          severity: 'opportunity', computedAt: new Date().toISOString(),
          strategyAlignment: 'aligned',
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('strategy: aligned');
    });
  });

  // ── Mixed insight types in single call ────────────────────────────────────

  describe('mixed insight types', () => {
    it('renders all handled sections when multiple types are present', () => {
      const now = new Date().toISOString();
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'https://example.com/p1',
          insightType: 'page_health',
          data: { score: 40, trend: 'declining', clicks: 20, impressions: 300, position: 30, ctr: 0.067, pageviews: 50, bounceRate: 80, avgEngagementTime: 15 },
          severity: 'warning', computedAt: now,
        },
        {
          id: '2', workspaceId: 'ws1', pageId: null,
          insightType: 'ranking_opportunity',
          data: { query: 'best seo', currentPosition: 8, impressions: 2000, estimatedTrafficGain: 180, pageUrl: 'https://example.com/p1' },
          severity: 'opportunity', computedAt: now,
        },
        {
          id: '3', workspaceId: 'ws1', pageId: 'https://example.com/decay',
          insightType: 'content_decay',
          data: { baselineClicks: 200, currentClicks: 80, deltaPercent: -60, baselinePeriod: '30d', currentPeriod: '30d' },
          severity: 'critical', computedAt: now,
        },
        {
          id: '4', workspaceId: 'ws1', pageId: null,
          insightType: 'keyword_cluster',
          data: { label: 'Content Marketing', queries: ['content strategy', 'blog seo'], totalImpressions: 3000, avgPosition: 7.5, pillarPage: null },
          severity: 'opportunity', computedAt: now,
        },
        {
          id: '5', workspaceId: 'ws1', pageId: null,
          insightType: 'competitor_gap',
          data: { keyword: 'enterprise seo', competitorDomain: 'big.com', competitorPosition: 2, ourPosition: 28, volume: 4000, difficulty: 65 },
          severity: 'opportunity', computedAt: now,
        },
        {
          id: '6', workspaceId: 'ws1', pageId: 'https://example.com/contact',
          insightType: 'conversion_attribution',
          data: { sessions: 400, conversions: 16, conversionRate: 4.0, estimatedRevenue: null },
          severity: 'positive', computedAt: now,
        },
        {
          id: '7', workspaceId: 'ws1', pageId: null,
          insightType: 'anomaly_digest',
          data: { anomalyType: 'position_drop', metric: 'position', currentValue: 25, expectedValue: 8, deviationPercent: 213, durationDays: 4, firstDetected: now, severity: 'critical' },
          severity: 'critical', computedAt: now,
        },
        {
          id: '8', workspaceId: 'ws1', pageId: null,
          insightType: 'competitor_alert',
          data: { competitorDomain: 'fast.com', alertType: 'new_keyword', keyword: 'ai content', volume: 1800, snapshotDate: '2026-05-01' },
          severity: 'warning', computedAt: now,
        },
        {
          id: '9', workspaceId: 'ws1', pageId: null,
          insightType: 'emerging_keyword',
          data: { keyword: 'generative seo', volume: 700, difficulty: 28, currentPosition: undefined },
          severity: 'opportunity', computedAt: now,
        },
        {
          id: '10', workspaceId: 'ws1', pageId: null,
          insightType: 'freshness_alert',
          data: { pagePath: '/old-guide', lastAnalyzedAt: '2025-08-01T00:00:00Z', daysSinceLastAnalysis: 300 },
          severity: 'warning', computedAt: now,
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('PAGE HEALTH SCORES');
      expect(result).toContain('QUICK WINS');
      expect(result).toContain('CONTENT DECAY');
      expect(result).toContain('KEYWORD CLUSTERS');
      expect(result).toContain('COMPETITOR GAPS');
      expect(result).toContain('CONVERSION ATTRIBUTION');
      expect(result).toContain('ANOMALY DIGEST');
      expect(result).toContain('COMPETITOR ALERTS');
      expect(result).toContain('EMERGING KEYWORDS');
      expect(result).toContain('STALE CONTENT');
      // Two critical insights (decay + anomaly)
      expect(result).toContain('2 CRITICAL INSIGHTS');
    });
  });

  // ── Non-URL pageId fallback ───────────────────────────────────────────────

  describe('pageId fallback handling', () => {
    it('uses pageId directly when it is not a valid URL (for content_decay)', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: 'not-a-url',
          insightType: 'content_decay',
          data: { baselineClicks: 100, currentClicks: 30, deltaPercent: -70, baselinePeriod: '30d', currentPeriod: '30d' },
          severity: 'critical', computedAt: new Date().toISOString(),
        },
      ];
      const result = buildInsightsContext(insights);
      expect(result).toContain('not-a-url');
    });

    it('handles null pageId for content_decay gracefully', () => {
      const insights: AnalyticsInsight[] = [
        {
          id: '1', workspaceId: 'ws1', pageId: null,
          insightType: 'content_decay',
          data: { baselineClicks: 80, currentClicks: 20, deltaPercent: -75, baselinePeriod: '30d', currentPeriod: '30d' },
          severity: 'critical', computedAt: new Date().toISOString(),
        },
      ];
      // Should not throw
      expect(() => buildInsightsContext(insights)).not.toThrow();
      const result = buildInsightsContext(insights);
      expect(result).toContain('CONTENT DECAY');
    });
  });
});
