import { describe, expect, it } from 'vitest';
import {
  buildCandidateIds,
  buildClosedSetBlock,
  buildClosedSetPageAssignmentPrompt,
  buildClosedSetSiteSynthesisPrompt,
  resolveClosedSetKeyword,
} from '../../server/keyword-strategy-synthesis/prompts.js';
import {
  buildGa4Context,
  buildGscSummary,
} from '../../server/keyword-strategy-synthesis/site-synthesis-context.js';
import { siteSynthesisResponseSchema } from '../../server/schemas/keyword-strategy-schemas.js';
import type { KeywordCandidate } from '../../shared/types/keyword-universe.js';
import type { KeywordStrategySearchData } from '../../server/keyword-strategy-search-data.js';
import type { PageMapping } from '../../server/keyword-strategy-synthesis/types.js';

const candidates: KeywordCandidate[] = [
  {
    keyword: 'platform analytics',
    volume: 1200,
    difficulty: 24,
    requested: true,
    voteWeight: 3,
    priority: 'high',
  },
  {
    keyword: 'declined analytics',
    volume: 900,
    difficulty: 20,
    declined: true,
  },
];

describe('keyword strategy synthesis prompt stages', () => {
  it('builds a closed candidate block that annotates requested candidates and hides declined candidates', () => {
    const block = buildClosedSetBlock(candidates);

    expect(block).toContain('CLOSED CANDIDATE SET');
    expect(block).toContain('id:"platform analytics"');
    expect(block).toContain('CLIENT-REQUESTED');
    expect(block).toContain('votes:3');
    expect(block).toContain('priority:high');
    expect(block).not.toContain('declined analytics');
  });

  it('resolves only in-set source IDs or keywords', () => {
    const ids = buildCandidateIds(candidates);

    expect(resolveClosedSetKeyword(ids, 'platform analytics', 'invented')).toBe('platform analytics');
    expect(resolveClosedSetKeyword(ids, 'invented', 'platform analytics')).toBe('platform analytics');
    expect(resolveClosedSetKeyword(ids, 'invented', 'also invented')).toBeNull();
  });

  it('keeps OP1 closed-set prompt clauses stable', () => {
    const prompt = buildClosedSetPageAssignmentPrompt({
      businessSection: 'BUSINESS',
      closedSetBlock: buildClosedSetBlock(candidates),
      batchPages: '- /services: "Services"',
      batchLength: 1,
    });

    expect(prompt).toContain('Return a JSON OBJECT');
    expect(prompt).toContain('primaryKeywordSourceId');
    expect(prompt).toContain('MUST come from the CLOSED CANDIDATE SET');
    expect(prompt).toContain('Cover ALL 1 pages');
  });

  it('keeps OP2 closed-set prompt clauses stable', () => {
    const prompt = buildClosedSetSiteSynthesisPrompt({
      businessSection: 'BUSINESS',
      pageMappingCount: 1,
      keywordSummary: '/services: "platform analytics"',
      conflictNote: '',
      gscSummary: '',
      ga4Context: '',
      auditContext: '',
      providerContext: '',
      intelligenceBlock: '',
      closedSetBlock: buildClosedSetBlock(candidates),
      effectiveBusinessPriorities: ['growth'],
      hasProviderContext: true,
      hasKeywordGaps: true,
      competitorDomains: ['competitor.example'],
      competitorBrandTokens: ['competitor'],
      conflictsCount: 0,
    });

    expect(prompt).toContain('targetKeywordSourceId');
    expect(prompt).toContain('CLIENT-REQUESTED candidates');
    expect(prompt).toContain('BUSINESS PRIORITIES');
    expect(prompt).toContain('NEVER suggest a keyword that contains a competitor');
  });

  it('normalizes partial or invalid OP2 content gaps to persistence-safe values', () => {
    const parsed = siteSynthesisResponseSchema.parse({
      contentGaps: [
        {
          topic: 'Analytics guide',
          targetKeyword: 'analytics guide',
          intent: 'not-real',
          priority: 'urgent',
          suggestedPageType: 'microsite',
        },
      ],
    });

    expect(parsed.contentGaps).toEqual([
      {
        topic: 'Analytics guide',
        targetKeyword: 'analytics guide',
        intent: 'informational',
        priority: 'medium',
        rationale: 'AI-identified keyword opportunity.',
        suggestedPageType: undefined,
      },
    ]);
  });

  it('builds OP2 GSC evidence without dropping device, period, or country clauses', () => {
    const searchData: Pick<KeywordStrategySearchData, 'gscData' | 'deviceBreakdown' | 'countryBreakdown' | 'periodComparison'> = {
      gscData: [
        { query: 'lower volume', page: 'https://example.com/low', clicks: 2, impressions: 10, position: 8.25 },
        { query: 'top query', page: 'https://example.com/services?utm=x', clicks: 12, impressions: 200, position: 3.12 },
      ],
      deviceBreakdown: [
        { device: 'MOBILE', clicks: 8, impressions: 300, ctr: 2.7, position: 8.4 },
        { device: 'DESKTOP', clicks: 4, impressions: 100, ctr: 4, position: 5.1 },
      ],
      countryBreakdown: [
        { country: 'United States', clicks: 9, impressions: 240, ctr: 3.8, position: 4.2 },
      ],
      periodComparison: {
        current: { clicks: 40, impressions: 1000, ctr: 4, position: 5 },
        previous: { clicks: 30, impressions: 800, ctr: 3.8, position: 4 },
        change: { clicks: 10, impressions: 200, ctr: 0.2, position: 1 },
        changePercent: { clicks: 33.3, impressions: 25, ctr: 5.3, position: 25 },
      },
    };

    const summary = buildGscSummary(searchData);

    expect(summary.indexOf('"top query"')).toBeLessThan(summary.indexOf('"lower volume"'));
    expect(summary).toContain('Top GSC queries (last 90 days)');
    expect(summary).toContain('- "top query" → /services (pos: 3.1, clicks: 12, imp: 200)');
    expect(summary).toContain('DEVICE BREAKDOWN (last 28 days)');
    expect(summary).toContain('MOBILE GAP');
    expect(summary).toContain('PERIOD COMPARISON (last 28 days vs previous 28 days)');
    expect(summary).toContain('- Clicks: +10 (+33.3%)');
    expect(summary).toContain('TOP COUNTRIES by clicks');
  });

  it('builds OP2 GA4 evidence from unmapped, high-bounce, overview, conversion, and event-page signals', () => {
    const searchData: Pick<KeywordStrategySearchData, 'organicLandingPages' | 'organicOverview' | 'ga4Conversions' | 'ga4EventsByPage'> = {
      organicLandingPages: [
        { landingPage: '/mapped', sessions: 20, users: 15, bounceRate: 20, avgEngagementTime: 60, conversions: 1 },
        { landingPage: '/unmapped', sessions: 12, users: 8, bounceRate: 81, avgEngagementTime: 20, conversions: 0 },
      ],
      organicOverview: {
        organicUsers: 140,
        organicSessions: 180,
        organicPageviews: 300,
        organicBounceRate: 42,
        engagementRate: 58,
        avgEngagementTime: 75.4,
        shareOfTotalUsers: 33.2,
        dateRange: { start: '2026-05-01', end: '2026-05-28' },
      },
      ga4Conversions: [
        { eventName: 'lead_submit', conversions: 7, users: 5, rate: 3.5 },
      ],
      ga4EventsByPage: [
        { pagePath: '/money', eventName: 'book_call', eventCount: 9, users: 6 },
        { pagePath: '/money', eventName: 'minor_click', eventCount: 2, users: 2 },
      ],
    };
    const pageMappings: PageMapping[] = [{
      pagePath: '/mapped',
      pageTitle: 'Mapped',
      primaryKeyword: 'mapped keyword',
      secondaryKeywords: [],
      searchIntent: 'commercial',
    }];

    const context = buildGa4Context(searchData, pageMappings);

    expect(context).toContain('GA4 ORGANIC LANDING PAGES not in keyword map');
    expect(context).toContain('/unmapped: 12 organic sessions, 8 users, bounce 81%');
    expect(context).not.toContain('/mapped: 20 organic sessions');
    expect(context).toContain('HIGH-BOUNCE ORGANIC PAGES');
    expect(context).toContain('ORGANIC SEARCH OVERVIEW (GA4, last 28 days)');
    expect(context).toContain('- Avg engagement time: 75s');
    expect(context).toContain('CONVERSION EVENTS (GA4, last 28 days');
    expect(context).toContain('"lead_submit": 7 events, 5 users (3.5% conversion rate)');
    expect(context).toContain('TOP CONVERTING PAGES');
    expect(context).toContain('/money: 9 events (top: "book_call")');
  });
});
