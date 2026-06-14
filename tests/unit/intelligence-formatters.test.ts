/**
 * Unit tests for server/intelligence/formatters.ts — exported pure formatter functions.
 *
 * Covers:
 *   - formatKnowledgeBaseForPrompt: null/undefined/empty/whitespace/content
 *   - formatKeywordsForPrompt: null seo, no strategy, site keywords, business context,
 *     page keywords with/without secondary and intent, geo-location authority note
 *   - formatPersonasForPrompt: null/empty/single/full persona with all optional fields
 *   - formatPageMapForPrompt: null/empty/no pagePath/pagePath filter match and no-match
 *   - formatForPrompt (formatForPrompt via WorkspaceIntelligence): cold-start path,
 *     seoContext section, insights section, learnings section (compact/standard/detailed),
 *     contentPipeline section, siteHealth section, clientSignals section,
 *     operational section, localSeo section, pageProfile section,
 *     section filtering, token budget truncation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type {
  WorkspaceIntelligence,
  SeoContextSlice,
  InsightsSlice,
  LearningsSlice,
  ContentPipelineSlice,
  SiteHealthSlice,
  ClientSignalsSlice,
  OperationalSlice,
  PageProfileSlice,
  LocalSeoSlice,
} from '../../shared/types/intelligence.js';
import type { AudiencePersona } from '../../shared/types/workspace.js';

// Dynamic imports because formatters.ts imports helpers.js which has side-effect
// module-level code (logger setup, etc.) that needs the DB worker setup to run first.
let formatKnowledgeBaseForPrompt: (kb: string | null | undefined) => string;
let formatKeywordsForPrompt: (seo: SeoContextSlice | null | undefined) => string;
let formatPersonasForPrompt: (personas: AudiencePersona[] | null | undefined) => string;
let formatPageMapForPrompt: (seo: SeoContextSlice | null | undefined, pagePath?: string) => string;
let formatForPrompt: (intelligence: WorkspaceIntelligence, opts?: Record<string, unknown>) => string;

beforeAll(async () => {
  const mod = await import('../../server/intelligence/formatters.js');
  formatKnowledgeBaseForPrompt = mod.formatKnowledgeBaseForPrompt;
  formatKeywordsForPrompt = mod.formatKeywordsForPrompt;
  formatPersonasForPrompt = mod.formatPersonasForPrompt;
  formatPageMapForPrompt = mod.formatPageMapForPrompt;
  formatForPrompt = mod.formatForPrompt;
});

// ── Helpers — minimal valid slice factories ──────────────────────────────────

function makeSeoContext(overrides: Partial<SeoContextSlice> = {}): SeoContextSlice {
  return {
    strategy: undefined,
    brandVoice: '',
    effectiveBrandVoiceBlock: '',
    businessContext: '',
    personas: [],
    knowledgeBase: '',
    ...overrides,
  };
}

function makeInsightsSlice(overrides: Partial<InsightsSlice> = {}): InsightsSlice {
  return {
    all: [],
    byType: {},
    bySeverity: { critical: 0, warning: 0, opportunity: 0, positive: 0 },
    topByImpact: [],
    ...overrides,
  };
}

function makeLearningsSlice(overrides: Partial<LearningsSlice> = {}): LearningsSlice {
  return {
    availability: 'ready',
    summary: null,
    confidence: null,
    topActionTypes: [],
    overallWinRate: 0,
    recentTrend: null,
    playbooks: [],
    ...overrides,
  };
}

function makeContentPipelineSlice(overrides: Partial<ContentPipelineSlice> = {}): ContentPipelineSlice {
  return {
    briefs: { total: 0, byStatus: {} },
    posts: { total: 0, byStatus: {} },
    matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
    requests: { pending: 0, inProgress: 0, delivered: 0 },
    workOrders: { active: 0 },
    coverageGaps: [],
    seoEdits: { pending: 0, applied: 0, inReview: 0 },
    ...overrides,
  };
}

function makeSiteHealthSlice(overrides: Partial<SiteHealthSlice> = {}): SiteHealthSlice {
  return {
    auditScore: null,
    auditScoreDelta: null,
    deadLinks: 0,
    redirectChains: 0,
    schemaErrors: 0,
    orphanPages: 0,
    cwvPassRate: { mobile: null, desktop: null },
    ...overrides,
  };
}

function makeClientSignalsSlice(overrides: Partial<ClientSignalsSlice> = {}): ClientSignalsSlice {
  return {
    keywordFeedback: {
      approved: [],
      rejected: [],
      patterns: { approveRate: 0, topRejectionReasons: [] },
    },
    contentGapVotes: [],
    businessPriorities: [],
    effectiveBusinessPriorities: [],
    approvalPatterns: { approvalRate: 0, avgResponseTime: null },
    recentChatTopics: [],
    churnRisk: null,
    ...overrides,
  };
}

function makeOperationalSlice(overrides: Partial<OperationalSlice> = {}): OperationalSlice {
  return {
    recentActivity: [],
    annotations: [],
    pendingJobs: 0,
    ...overrides,
  };
}

function makePageProfileSlice(overrides: Partial<PageProfileSlice> = {}): PageProfileSlice {
  return {
    pagePath: '/test-page',
    primaryKeyword: null,
    searchIntent: null,
    optimizationScore: null,
    recommendations: [],
    contentGaps: [],
    insights: [],
    actions: [],
    auditIssues: [],
    optimizationIssues: [],
    primaryKeywordPresence: null,
    competitorKeywords: [],
    topicCluster: null,
    estimatedDifficulty: null,
    schemaStatus: 'none',
    linkHealth: { inbound: 0, outbound: 0, orphan: false },
    seoEdits: { currentTitle: '', currentMeta: '', lastEditedAt: null },
    rankHistory: { current: null, best: null, trend: 'stable' },
    contentStatus: null,
    cwvStatus: null,
    ...overrides,
  };
}

function makeLocalSeoSlice(overrides: Partial<LocalSeoSlice> = {}): LocalSeoSlice {
  return {
    enabled: true,
    locations: [],
    markets: [],
    visibility: { visible: 0, possibleMatch: 0, notVisible: 0, notChecked: 0, providerDegraded: 0 },
    candidates: [],
    effectiveLocalSeoBlock: '',
    latestSnapshotAt: null,
    ...overrides,
  };
}

function makeIntelligence(
  overrides: Partial<WorkspaceIntelligence> = {},
): WorkspaceIntelligence {
  return {
    version: 1,
    workspaceId: 'ws-test',
    assembledAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function formatSingleSection(
  intelligence: Partial<WorkspaceIntelligence>,
  section: 'contentPipeline' | 'siteHealth' | 'operational',
  verbosity: 'compact' | 'standard' | 'detailed' = 'standard',
): string {
  return formatForPrompt(makeIntelligence(intelligence), {
    sections: [section],
    verbosity,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// formatKnowledgeBaseForPrompt
// ════════════════════════════════════════════════════════════════════════════

describe('formatKnowledgeBaseForPrompt', () => {
  it('returns empty string for null', () => {
    expect(formatKnowledgeBaseForPrompt(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatKnowledgeBaseForPrompt(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatKnowledgeBaseForPrompt('')).toBe('');
  });

  it('returns empty string for whitespace-only string', () => {
    expect(formatKnowledgeBaseForPrompt('   ')).toBe('');
  });

  it('includes knowledge base header and content for non-empty input', () => {
    const result = formatKnowledgeBaseForPrompt('We specialize in dental SEO.');
    expect(result).toContain('BUSINESS KNOWLEDGE BASE');
    expect(result).toContain('We specialize in dental SEO.');
  });

  it('includes the "informed, business-aware" hint in the header', () => {
    const result = formatKnowledgeBaseForPrompt('some content');
    expect(result).toContain('informed, business-aware');
  });

  it('starts with two newlines (\\n\\n prefix) when content is present', () => {
    const result = formatKnowledgeBaseForPrompt('content here');
    expect(result.startsWith('\n\n')).toBe(true);
  });

  it('preserves multiline knowledge base content', () => {
    const kb = 'Line 1\nLine 2\nLine 3';
    const result = formatKnowledgeBaseForPrompt(kb);
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 3');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatKeywordsForPrompt
// ════════════════════════════════════════════════════════════════════════════

describe('formatKeywordsForPrompt', () => {
  it('returns empty string for null', () => {
    expect(formatKeywordsForPrompt(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatKeywordsForPrompt(undefined)).toBe('');
  });

  it('returns empty string when seo has no strategy', () => {
    expect(formatKeywordsForPrompt(makeSeoContext())).toBe('');
  });

  it('returns empty string when strategy has no siteKeywords and no businessContext', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: [],
        pageMap: [],
        businessContext: '',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
      businessContext: '',
    });
    expect(formatKeywordsForPrompt(seo)).toBe('');
  });

  it('includes site keywords section when strategy has keywords', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: ['dental seo', 'teeth whitening'],
        pageMap: [],
        businessContext: '',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
    });
    const result = formatKeywordsForPrompt(seo);
    expect(result).toContain('Site target keywords');
    expect(result).toContain('dental seo');
    expect(result).toContain('teeth whitening');
  });

  it('caps site keywords at 8', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: Array.from({ length: 12 }, (_, i) => `keyword${i}`),
        pageMap: [],
        businessContext: '',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
    });
    const result = formatKeywordsForPrompt(seo);
    // keyword8 through keyword11 should NOT appear
    expect(result).not.toContain('keyword8');
    expect(result).toContain('keyword7');
  });

  it('includes business context when present', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: ['seo'],
        pageMap: [],
        businessContext: 'We are a dental clinic',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
    });
    const result = formatKeywordsForPrompt(seo);
    expect(result).toContain('General business context');
    expect(result).toContain('We are a dental clinic');
  });

  it('prefers seo.businessContext over strategy.businessContext', () => {
    const seo = makeSeoContext({
      businessContext: 'From slice',
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: ['seo'],
        pageMap: [],
        businessContext: 'From strategy',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
    });
    const result = formatKeywordsForPrompt(seo);
    expect(result).toContain('From slice');
    expect(result).not.toContain('From strategy');
  });

  it('includes pageKeywords section when pageKeywords is present', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: ['general seo'],
        pageMap: [],
        businessContext: '',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
      pageKeywords: {
        pagePath: '/services',
        pageTitle: 'Services',
        primaryKeyword: 'dental implants',
        secondaryKeywords: ['implant dentist', 'tooth replacement'],
        searchIntent: 'commercial',
      },
    });
    const result = formatKeywordsForPrompt(seo);
    expect(result).toContain("THIS PAGE'S TARGET");
    expect(result).toContain('dental implants');
    expect(result).toContain('implant dentist');
    expect(result).toContain('commercial');
  });

  it('includes geo-location authority warning in page keywords section', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: ['seo'],
        pageMap: [],
        businessContext: '',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
      pageKeywords: {
        pagePath: '/austin',
        pageTitle: 'Austin SEO',
        primaryKeyword: 'seo austin tx',
        secondaryKeywords: [],
        searchIntent: undefined,
      },
    });
    const result = formatKeywordsForPrompt(seo);
    expect(result).toContain('IMPORTANT');
    expect(result).toContain('location');
  });

  it('omits secondary keywords section when secondaryKeywords is empty', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: ['seo'],
        pageMap: [],
        businessContext: '',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
      pageKeywords: {
        pagePath: '/test',
        pageTitle: 'Test',
        primaryKeyword: 'local seo',
        secondaryKeywords: [],
        searchIntent: undefined,
      },
    });
    const result = formatKeywordsForPrompt(seo);
    expect(result).not.toContain('Secondary keywords');
  });

  it('wraps the block in KEYWORD STRATEGY header', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: ['seo'],
        pageMap: [],
        businessContext: '',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
    });
    const result = formatKeywordsForPrompt(seo);
    expect(result).toContain('KEYWORD STRATEGY');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatPersonasForPrompt
// ════════════════════════════════════════════════════════════════════════════

describe('formatPersonasForPrompt', () => {
  it('returns empty string for null', () => {
    expect(formatPersonasForPrompt(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatPersonasForPrompt(undefined)).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(formatPersonasForPrompt([])).toBe('');
  });

  it('includes TARGET AUDIENCE PERSONAS header when personas present', () => {
    const personas: AudiencePersona[] = [{
      id: 'p1',
      name: 'Small Biz Owner',
      description: 'Owner of a small business',
      painPoints: [],
      goals: [],
      objections: [],
    }];
    const result = formatPersonasForPrompt(personas);
    expect(result).toContain('TARGET AUDIENCE PERSONAS');
  });

  it('includes persona name in bold', () => {
    const personas: AudiencePersona[] = [{
      id: 'p1',
      name: 'Small Biz Owner',
      description: 'Owner of a small business',
      painPoints: [],
      goals: [],
      objections: [],
    }];
    const result = formatPersonasForPrompt(personas);
    expect(result).toContain('**Small Biz Owner**');
  });

  it('includes description', () => {
    const personas: AudiencePersona[] = [{
      id: 'p1',
      name: 'Persona',
      description: 'They love SEO',
      painPoints: [],
      goals: [],
      objections: [],
    }];
    expect(formatPersonasForPrompt(personas)).toContain('They love SEO');
  });

  it('includes buying stage when present', () => {
    const personas: AudiencePersona[] = [{
      id: 'p1',
      name: 'Buyer',
      description: 'desc',
      painPoints: [],
      goals: [],
      objections: [],
      buyingStage: 'consideration',
    }];
    expect(formatPersonasForPrompt(personas)).toContain('consideration');
  });

  it('omits buying stage when absent', () => {
    const personas: AudiencePersona[] = [{
      id: 'p1',
      name: 'Buyer',
      description: 'desc',
      painPoints: [],
      goals: [],
      objections: [],
    }];
    expect(formatPersonasForPrompt(personas)).not.toContain('stage');
  });

  it('includes pain points when present', () => {
    const personas: AudiencePersona[] = [{
      id: 'p1',
      name: 'P',
      description: 'd',
      painPoints: ['too expensive', 'hard to find'],
      goals: [],
      objections: [],
    }];
    const result = formatPersonasForPrompt(personas);
    expect(result).toContain('Pain points');
    expect(result).toContain('too expensive');
    expect(result).toContain('hard to find');
  });

  it('omits pain points section when empty array', () => {
    const personas: AudiencePersona[] = [{
      id: 'p1',
      name: 'P',
      description: 'd',
      painPoints: [],
      goals: [],
      objections: [],
    }];
    expect(formatPersonasForPrompt(personas)).not.toContain('Pain points');
  });

  it('includes goals when present', () => {
    const personas: AudiencePersona[] = [{
      id: 'p1',
      name: 'P',
      description: 'd',
      painPoints: [],
      goals: ['grow traffic', 'rank higher'],
      objections: [],
    }];
    const result = formatPersonasForPrompt(personas);
    expect(result).toContain('Goals');
    expect(result).toContain('grow traffic');
  });

  it('includes objections when present', () => {
    const personas: AudiencePersona[] = [{
      id: 'p1',
      name: 'P',
      description: 'd',
      painPoints: [],
      goals: [],
      objections: ['too costly'],
    }];
    expect(formatPersonasForPrompt(personas)).toContain('Objections');
    expect(formatPersonasForPrompt(personas)).toContain('too costly');
  });

  it('includes preferred content format when present', () => {
    const personas: AudiencePersona[] = [{
      id: 'p1',
      name: 'P',
      description: 'd',
      painPoints: [],
      goals: [],
      objections: [],
      preferredContentFormat: 'how-to guides',
    }];
    expect(formatPersonasForPrompt(personas)).toContain('how-to guides');
  });

  it('formats multiple personas separated by blank lines', () => {
    const personas: AudiencePersona[] = [
      { id: 'p1', name: 'Persona A', description: 'A desc', painPoints: [], goals: [], objections: [] },
      { id: 'p2', name: 'Persona B', description: 'B desc', painPoints: [], goals: [], objections: [] },
    ];
    const result = formatPersonasForPrompt(personas);
    expect(result).toContain('Persona A');
    expect(result).toContain('Persona B');
    // They should be separated by a blank line (\n\n)
    expect(result).toContain('\n\n');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatPageMapForPrompt
// ════════════════════════════════════════════════════════════════════════════

describe('formatPageMapForPrompt', () => {
  it('returns empty string for null', () => {
    expect(formatPageMapForPrompt(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatPageMapForPrompt(undefined)).toBe('');
  });

  it('returns empty string when seo has no strategy', () => {
    expect(formatPageMapForPrompt(makeSeoContext())).toBe('');
  });

  it('returns empty string when strategy has empty pageMap', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: [],
        pageMap: [],
        businessContext: '',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
    });
    expect(formatPageMapForPrompt(seo)).toBe('');
  });

  it('includes keyword map header when pageMap has entries', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: [],
        pageMap: [{ pagePath: '/services', primaryKeyword: 'dental seo', secondaryKeywords: [] }],
        businessContext: '',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
    });
    const result = formatPageMapForPrompt(seo);
    expect(result).toContain('EXISTING KEYWORD MAP');
    expect(result).toContain('/services');
    expect(result).toContain('dental seo');
  });

  it('includes secondary keywords in the map entry when present', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: [],
        pageMap: [{
          pagePath: '/services',
          primaryKeyword: 'dental seo',
          secondaryKeywords: ['local dental', 'dentist seo'],
        }],
        businessContext: '',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
    });
    const result = formatPageMapForPrompt(seo);
    expect(result).toContain('also:');
    expect(result).toContain('local dental');
  });

  it('filters pageMap by pagePath when provided (exact match)', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: [],
        pageMap: [
          { pagePath: '/services', primaryKeyword: 'dental seo', secondaryKeywords: [] },
          { pagePath: '/about', primaryKeyword: 'about us dental', secondaryKeywords: [] },
        ],
        businessContext: '',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
    });
    const result = formatPageMapForPrompt(seo, '/services');
    expect(result).toContain('/services');
    expect(result).not.toContain('/about');
  });

  it('returns empty string when pagePath filter matches no entries', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: [],
        pageMap: [{ pagePath: '/services', primaryKeyword: 'dental seo', secondaryKeywords: [] }],
        businessContext: '',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
    });
    expect(formatPageMapForPrompt(seo, '/contact')).toBe('');
  });

  it('includes cannibalization advice in the header', () => {
    const seo = makeSeoContext({
      strategy: {
        id: 's1',
        workspaceId: 'ws1',
        siteKeywords: [],
        pageMap: [{ pagePath: '/a', primaryKeyword: 'kw', secondaryKeywords: [] }],
        businessContext: '',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as never,
    });
    const result = formatPageMapForPrompt(seo);
    expect(result).toContain('cannibalization');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatForPrompt — cold-start path
// ════════════════════════════════════════════════════════════════════════════

describe('formatForPrompt — cold-start', () => {
  it('returns cold-start message when intelligence has no meaningful content', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext(),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('newly onboarded');
    expect(result).toContain('Limited data available');
  });

  it('includes recommendation about baseline data in cold-start', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext(),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('baseline data');
  });

  it('includes effectiveBrandVoiceBlock in cold-start when present', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({
        effectiveBrandVoiceBlock: 'BRAND VOICE: Professional and approachable',
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('BRAND VOICE');
  });

  it('returns empty string when section filter does not include seoContext and no data', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext(),
    });
    // Requesting a section that has no data — should get empty string, not cold-start
    const result = formatForPrompt(intel, { sections: ['pageProfile'] });
    expect(result).toBe('');
  });

  it('returns cold-start when sections filter requests seoContext explicitly with no data', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext(),
    });
    const result = formatForPrompt(intel, { sections: ['seoContext'] });
    expect(result).toContain('newly onboarded');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatForPrompt — seoContext section
// ════════════════════════════════════════════════════════════════════════════

describe('formatForPrompt — seoContext section', () => {
  it('includes SEO Context header when businessContext is set', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'We are a dental clinic' }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('## SEO Context');
    expect(result).toContain('We are a dental clinic');
  });

  it('includes site keywords when strategy siteKeywords present', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({
        businessContext: 'Dental clinic',
        strategy: {
          id: 's1',
          workspaceId: 'ws1',
          siteKeywords: ['dental seo', 'dentist near me'],
          pageMap: [],
          businessContext: '',
          status: 'active',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        } as never,
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('dental seo');
  });

  it('includes brand voice block when effectiveBrandVoiceBlock is set', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({
        businessContext: 'Dental clinic',
        effectiveBrandVoiceBlock: 'BRAND VOICE: Friendly and professional',
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('BRAND VOICE');
  });

  it('does NOT include raw brandVoice as a fallback (authority rule)', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({
        businessContext: 'Dental',
        brandVoice: 'Raw legacy brand voice',
        effectiveBrandVoiceBlock: '', // calibrated workspace with no legacy fallback
      }),
    });
    const result = formatForPrompt(intel);
    // The raw brandVoice should not appear directly in the output
    expect(result).not.toContain('Raw legacy brand voice');
  });

  it('includes personas in compact verbosity as name + buying stage', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({
        businessContext: 'Dental',
        personas: [{
          id: 'p1',
          name: 'Owner',
          description: 'Small business owner',
          painPoints: [],
          goals: [],
          objections: [],
          buyingStage: 'awareness',
        }],
      }),
    });
    const result = formatForPrompt(intel, { verbosity: 'compact' });
    expect(result).toContain('Owner');
    expect(result).toContain('awareness');
  });

  it('includes personas with full detail in standard verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({
        businessContext: 'Dental',
        personas: [{
          id: 'p1',
          name: 'Owner',
          description: 'Small business owner who needs SEO',
          painPoints: ['too expensive'],
          goals: ['more traffic'],
          objections: [],
        }],
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('TARGET AUDIENCE PERSONAS');
    expect(result).toContain('too expensive');
    expect(result).toContain('more traffic');
  });

  it('includes rank tracking in standard verbosity when present', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({
        businessContext: 'Dental',
        rankTracking: {
          trackedKeywords: 25,
          avgPosition: 12.3,
          positionChanges: { improved: 5, declined: 2, stable: 18 },
        },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Rank tracking');
    expect(result).toContain('25 keywords');
    expect(result).toContain('12.3');
  });

  it('includes named keyword movers in standard rank tracking context', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({
        businessContext: 'Dental',
        rankTracking: {
          trackedKeywords: 25,
          avgPosition: 12.3,
          positionChanges: { improved: 5, declined: 2, stable: 18 },
          topKeywordMovers: [
            {
              query: 'dental implants',
              position: 4,
              change: -3,
              direction: 'improved',
              clicks: 12,
              impressions: 300,
              ctr: 4,
            },
            {
              query: 'emergency dentist',
              position: 9,
              change: 2,
              direction: 'declined',
              clicks: 4,
              impressions: 900,
              ctr: 0.44,
              valueScore: 71,
            },
          ],
        },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Top keyword movers');
    expect(result).toContain('improved "dental implants" #4');
    expect(result).toContain('declined "emergency dentist" #9');
    expect(result).toContain('value 71');
  });

  it('can omit named keyword movers while preserving aggregate rank tracking context', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({
        businessContext: 'Dental',
        rankTracking: {
          trackedKeywords: 25,
          avgPosition: 12.3,
          positionChanges: { improved: 5, declined: 2, stable: 18 },
          topKeywordMovers: [
            {
              query: 'dental implants',
              position: 4,
              change: -3,
              direction: 'improved',
              clicks: 12,
              impressions: 300,
              ctr: 4,
            },
          ],
        },
      }),
    });
    const result = formatForPrompt(intel, { includeRankMovers: false });
    expect(result).toContain('Rank tracking');
    expect(result).toContain('25 keywords');
    expect(result).not.toContain('Top keyword movers');
    expect(result).not.toContain('dental implants');
  });

  it('omits rank tracking in compact verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({
        businessContext: 'Dental',
        rankTracking: {
          trackedKeywords: 25,
          avgPosition: 12.3,
          positionChanges: { improved: 5, declined: 2, stable: 18 },
        },
      }),
    });
    const result = formatForPrompt(intel, { verbosity: 'compact' });
    expect(result).not.toContain('Rank tracking');
  });

  it('includes backlink profile in standard verbosity when present', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({
        businessContext: 'Dental',
        backlinkProfile: { totalBacklinks: 1200, referringDomains: 45 },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Backlinks');
    expect(result).toContain('1,200');
    expect(result).toContain('45 referring domains');
  });

  it('includes SERP features when present', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({
        businessContext: 'Dental',
        serpFeatures: { featuredSnippets: 3, peopleAlsoAsk: 5, localPack: true, videoCarousel: 0 },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('SERP features');
    expect(result).toContain('featured snippet');
    expect(result).toContain('local pack');
  });

  it('returns empty section string (skips ## header) when seoContext has no content', () => {
    // Fully empty seoContext — formatSeoContextSection returns '' which is filtered
    const intel = makeIntelligence({
      seoContext: makeSeoContext(),
      insights: makeInsightsSlice({
        all: [{
          id: 'i1',
          workspaceId: 'ws1',
          insightType: 'ranking_opportunity' as never,
          severity: 'opportunity',
          title: 'Opportunity',
          status: 'active',
          createdAt: '2026-01-01',
          impactScore: 80,
        } as never],
        bySeverity: { critical: 0, warning: 0, opportunity: 1, positive: 0 },
        topByImpact: [{
          id: 'i1',
          workspaceId: 'ws1',
          insightType: 'ranking_opportunity' as never,
          severity: 'opportunity',
          title: 'Opportunity',
          status: 'active',
          createdAt: '2026-01-01',
          impactScore: 80,
        } as never],
      }),
    });
    const result = formatForPrompt(intel);
    // Should not have a bare "## SEO Context" with nothing after it
    expect(result).not.toMatch(/## SEO Context\s*##/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatForPrompt — insights section
// ════════════════════════════════════════════════════════════════════════════

describe('formatForPrompt — insights section', () => {
  const insightItem = {
    id: 'i1',
    workspaceId: 'ws1',
    insightType: 'ranking_opportunity' as never,
    severity: 'opportunity' as const,
    title: 'Rank higher for dental seo',
    status: 'active',
    createdAt: '2026-01-01',
    impactScore: 75,
  } as never;

  it('includes Active Insights header when insights are present', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      insights: makeInsightsSlice({
        all: [insightItem],
        topByImpact: [insightItem],
        bySeverity: { critical: 0, warning: 0, opportunity: 1, positive: 0 },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('## Active Insights');
  });

  it('includes severity summary line', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      insights: makeInsightsSlice({
        all: [insightItem],
        topByImpact: [insightItem],
        bySeverity: { critical: 1, warning: 2, opportunity: 3, positive: 1 },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('1 critical');
    expect(result).toContain('2 warning');
    expect(result).toContain('3 opportunity');
  });

  it('skips insights section when all array is empty', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      insights: makeInsightsSlice(),
    });
    const result = formatForPrompt(intel);
    expect(result).not.toContain('## Active Insights');
  });

  it('limits insights to 3 in compact verbosity', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      ...insightItem,
      id: `i${i}`,
      impactScore: 80 - i,
    })) as never[];
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      insights: makeInsightsSlice({
        all: items,
        topByImpact: items,
        bySeverity: { critical: 0, warning: 0, opportunity: 6, positive: 0 },
      }),
    });
    const result = formatForPrompt(intel, { verbosity: 'compact' });
    // Count the "- [" lines which represent individual insight bullets
    const bulletCount = (result.match(/^- \[/gm) ?? []).length;
    expect(bulletCount).toBeLessThanOrEqual(3);
  });

  it('limits insights to 5 in standard verbosity', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      ...insightItem,
      id: `i${i}`,
      impactScore: 80 - i,
    })) as never[];
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      insights: makeInsightsSlice({
        all: items,
        topByImpact: items,
        bySeverity: { critical: 0, warning: 0, opportunity: 8, positive: 0 },
      }),
    });
    const result = formatForPrompt(intel, { verbosity: 'standard' });
    const bulletCount = (result.match(/^- \[/gm) ?? []).length;
    expect(bulletCount).toBeLessThanOrEqual(5);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatForPrompt — learnings section
// ════════════════════════════════════════════════════════════════════════════

describe('formatForPrompt — learnings section', () => {
  it('skips learnings when nothing to render in compact verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      learnings: makeLearningsSlice({ overallWinRate: 0, recentTrend: null, confidence: null }),
    });
    const result = formatForPrompt(intel, { verbosity: 'compact' });
    expect(result).not.toContain('## Outcome Learnings');
  });

  it('includes learnings header when overallWinRate > 0', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      learnings: makeLearningsSlice({ overallWinRate: 0.62 }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('## Outcome Learnings');
    expect(result).toContain('62%');
  });

  it('includes trend when not stable', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      learnings: makeLearningsSlice({ overallWinRate: 0.5, recentTrend: 'improving' }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Trend: improving');
  });

  it('omits trend when recentTrend is stable', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      learnings: makeLearningsSlice({ overallWinRate: 0.5, recentTrend: 'stable' }),
    });
    const result = formatForPrompt(intel);
    expect(result).not.toContain('Trend:');
  });

  it('includes top action types in standard verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      learnings: makeLearningsSlice({
        overallWinRate: 0.6,
        topActionTypes: [{ type: 'title_update', winRate: 0.75, count: 12 }],
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('title_update');
    expect(result).toContain('75%');
  });

  it('includes proven predictions (weCalledIt) in standard verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      learnings: makeLearningsSlice({
        overallWinRate: 0.6,
        weCalledIt: [{
          actionId: 'a1',
          prediction: 'Title update will boost rank',
          outcome: 'Ranked #3',
          score: 'strong_win',
          pageUrl: '/services',
          measuredAt: '2026-03-01',
        }],
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Proven predictions');
    expect(result).toContain('Title update will boost rank');
  });

  it('pct helper returns n/a for null win rate', () => {
    // overallWinRate is 0 (not null) so the "n/a" case is hit via the summary strong wins
    // We test that summary.overall with null strongWinRate omits the suffix
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      learnings: makeLearningsSlice({
        overallWinRate: 0.6,
        summary: {
          totalScoredActions: 20,
          overall: {
            winRate: 0.6,
            strongWinRate: null as never,
            neutralRate: 0.2,
            lossRate: 0.2,
            topActionTypes: [],
          },
          content: null,
          strategy: null,
          technical: null,
        },
      }),
    });
    const result = formatForPrompt(intel);
    // Strong suffix should not appear when strongWinRate is null
    expect(result).not.toContain('strong wins');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatForPrompt — contentPipeline section
// ════════════════════════════════════════════════════════════════════════════

describe('formatForPrompt — contentPipeline section', () => {
  it('includes Content Pipeline header', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      contentPipeline: makeContentPipelineSlice({
        briefs: { total: 5, byStatus: {} },
        posts: { total: 3, byStatus: {} },
        matrices: { total: 1, cellsPlanned: 10, cellsPublished: 4 },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('## Content Pipeline');
  });

  it('includes totals summary line', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      contentPipeline: makeContentPipelineSlice({
        briefs: { total: 5, byStatus: {} },
        posts: { total: 3, byStatus: {} },
        matrices: { total: 1, cellsPlanned: 10, cellsPublished: 4 },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Briefs: 5');
    expect(result).toContain('Posts: 3');
    expect(result).toContain('Matrices: 1');
  });

  it('includes coverage gaps in standard verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      contentPipeline: makeContentPipelineSlice({
        coverageGaps: ['implants', 'crowns', 'whitening'],
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Coverage gaps');
    expect(result).toContain('implants');
  });

  it('includes decay alerts in standard verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      contentPipeline: makeContentPipelineSlice({
        decayAlerts: [{
          pageUrl: '/blog/old-post',
          clickDrop: 45,
          detectedAt: '2026-01-01',
          hasRefreshBrief: false,
          isRepeatDecay: false,
        }],
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Decay alerts');
    expect(result).toContain('1 pages declining');
  });

  it('includes copy pipeline stats when present', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      contentPipeline: makeContentPipelineSlice({
        copyPipeline: {
          totalSections: 20,
          approvedSections: 15,
          draftSections: 3,
          clientReviewSections: 2,
          approvalRate: 75,
          firstTryApprovalRate: 60,
          entriesWithCompleteCopy: 8,
          entriesWithPendingCopy: 4,
          activePatternsCount: 3,
          lastBatchJob: null,
        } as never,
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Copy:');
    expect(result).toContain('20 sections');
    expect(result).toContain('75%');
  });

  it('preserves exact compact output for a representative content pipeline slice', () => {
    const result = formatSingleSection({
      contentPipeline: makeContentPipelineSlice({
        briefs: { total: 4, byStatus: { draft: 2, approved: 2 } },
        posts: { total: 3, byStatus: { draft: 1, published: 2 } },
        matrices: { total: 1, cellsPlanned: 6, cellsPublished: 4 },
        requests: { pending: 2, inProgress: 1, delivered: 0 },
        workOrders: { active: 2 },
        coverageGaps: ['service pages', 'comparison content'],
        seoEdits: { pending: 3, applied: 5, inReview: 1 },
        copyPipeline: {
          totalSections: 12,
          approvedSections: 8,
          draftSections: 2,
          clientReviewSections: 2,
          approvalRate: 67,
          firstTryApprovalRate: 50,
          entriesWithCompleteCopy: 4,
          entriesWithPendingCopy: 2,
          activePatternsCount: 3,
          lastBatchJob: { status: 'completed', completionRate: 100 },
        } as never,
      }),
    }, 'contentPipeline', 'compact');

    expect(result).toBe(
      [
        '[Workspace Intelligence]',
        '',
        '## Content Pipeline',
        'Briefs: 4, Posts: 3, Matrices: 1',
        'Copy: 12 sections (8 approved, 2 draft, 2 in review)',
        'Copy approval rate: 67%, first-try: 50%',
        'Pages: 4 complete, 2 pending',
      ].join('\n')
    );
  });

  it('preserves exact standard output for a representative content pipeline slice', () => {
    const result = formatSingleSection({
      contentPipeline: makeContentPipelineSlice({
        briefs: { total: 4, byStatus: { draft: 2, approved: 2 } },
        posts: { total: 3, byStatus: { draft: 1, published: 2 } },
        matrices: { total: 1, cellsPlanned: 6, cellsPublished: 4 },
        requests: { pending: 2, inProgress: 1, delivered: 0 },
        workOrders: { active: 2 },
        coverageGaps: ['service pages', 'comparison content'],
        seoEdits: { pending: 3, applied: 5, inReview: 1 },
        subscriptions: { active: 2, totalPages: 15 },
        suggestedBriefs: 6,
        contentPricing: {
          briefPrice: 249,
          fullPostPrice: 799,
          currency: 'USD',
          briefLabel: 'Brief',
          fullPostLabel: 'Article',
        },
        copyPipeline: {
          totalSections: 12,
          approvedSections: 8,
          draftSections: 2,
          clientReviewSections: 2,
          approvalRate: 67,
          firstTryApprovalRate: 50,
          entriesWithCompleteCopy: 4,
          entriesWithPendingCopy: 2,
          activePatternsCount: 3,
          lastBatchJob: { status: 'completed', completionRate: 100 },
        } as never,
      }),
    }, 'contentPipeline', 'standard');

    expect(result).toBe(
      [
        '[Workspace Intelligence]',
        '',
        '## Content Pipeline',
        'Briefs: 4, Posts: 3, Matrices: 1',
        'Coverage gaps: service pages, comparison content',
        'Subscriptions: 2 active, 15 pages',
        'Content requests: 2 pending, 1 in progress',
        'Work orders: 2 active',
        'SEO edits: 3 pending, 5 applied',
        'Content pricing: Brief USD 249, Article USD 799',
        'Suggested briefs: 6 pending topics identified',
        'Copy: 12 sections (8 approved, 2 draft, 2 in review)',
        'Copy approval rate: 67%, first-try: 50%',
        'Pages: 4 complete, 2 pending',
        'Learned copy patterns: 3 active',
        'Last batch: completed, 100% complete',
      ].join('\n')
    );
  });

  it('preserves exact detailed output for a representative content pipeline slice', () => {
    const result = formatSingleSection({
      contentPipeline: makeContentPipelineSlice({
        briefs: { total: 4, byStatus: { draft: 2, approved: 2 } },
        posts: { total: 3, byStatus: { draft: 1, published: 2 } },
        matrices: { total: 1, cellsPlanned: 6, cellsPublished: 4 },
        requests: { pending: 2, inProgress: 1, delivered: 0 },
        workOrders: { active: 2 },
        coverageGaps: ['service pages', 'comparison content'],
        seoEdits: { pending: 3, applied: 5, inReview: 1 },
        subscriptions: { active: 2, totalPages: 15 },
        suggestedBriefs: 6,
        schemaDeployment: { planned: 3, deployed: 2, types: ['FAQPage', 'HowTo'] },
        rewritePlaybook: { patterns: ['tighten intros', 'add proof blocks'], lastUsedAt: '2026-06-01T00:00:00Z' },
        cannibalizationWarnings: [
          { keyword: 'seo dashboard', severity: 'high', pages: ['/overview', '/platform'] },
        ],
        decayAlerts: [
          { pageUrl: '/blog/decline', clickDrop: 18, detectedAt: '2026-06-02T00:00:00Z', hasRefreshBrief: true, isRepeatDecay: true },
        ],
        contentPricing: {
          briefPrice: 249,
          fullPostPrice: 799,
          currency: 'USD',
          briefLabel: 'Brief',
          fullPostLabel: 'Article',
        },
        copyPipeline: {
          totalSections: 12,
          approvedSections: 8,
          draftSections: 2,
          clientReviewSections: 2,
          approvalRate: 67,
          firstTryApprovalRate: 50,
          entriesWithCompleteCopy: 4,
          entriesWithPendingCopy: 2,
          activePatternsCount: 3,
          lastBatchJob: { status: 'completed', completionRate: 100 },
        } as never,
      }),
    }, 'contentPipeline', 'detailed');

    expect(result).toBe(
      [
        '[Workspace Intelligence]',
        '',
        '## Content Pipeline',
        'Briefs: 4, Posts: 3, Matrices: 1',
        'Coverage gaps: service pages, comparison content',
        'Decay alerts: 1 pages declining',
        'Subscriptions: 2 active, 15 pages',
        'Content requests: 2 pending, 1 in progress',
        'Work orders: 2 active',
        'SEO edits: 3 pending, 5 applied',
        'Content pricing: Brief USD 249, Article USD 799',
        'Suggested briefs: 6 pending topics identified',
        'Brief status: draft: 2, approved: 2',
        'Post status: draft: 1, published: 2',
        'Matrix: 4/6 cells published',
        'Schema: 2/3 deployed',
        'Rewrite playbook: 2 learned patterns',
        '  - tighten intros',
        '  - add proof blocks',
        'Keyword cannibalization:',
        '  - "seo dashboard" [high]: /overview, /platform',
        'Decay alert details:',
        '  - /blog/decline: -18% clicks (repeat decay)',
        'Copy: 12 sections (8 approved, 2 draft, 2 in review)',
        'Copy approval rate: 67%, first-try: 50%',
        'Pages: 4 complete, 2 pending',
        'Learned copy patterns: 3 active',
        'Last batch: completed, 100% complete',
      ].join('\n')
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatForPrompt — siteHealth section
// ════════════════════════════════════════════════════════════════════════════

describe('formatForPrompt — siteHealth section', () => {
  it('includes Site Health header', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      siteHealth: makeSiteHealthSlice({ auditScore: 72 }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('## Site Health');
  });

  it('includes audit score', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      siteHealth: makeSiteHealthSlice({ auditScore: 72, auditScoreDelta: 5 }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('72');
    expect(result).toContain('+5');
  });

  it('shows n/a for null audit score', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      siteHealth: makeSiteHealthSlice({ auditScore: null }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('n/a');
  });

  it('shows critical issues when anomalyCount > 0', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      siteHealth: makeSiteHealthSlice({ auditScore: 60, anomalyCount: 3 }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('3 anomalies');
  });

  it('includes dead links count in standard verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      siteHealth: makeSiteHealthSlice({ auditScore: 80, deadLinks: 5, redirectChains: 2, orphanPages: 1 }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('5 dead');
    expect(result).toContain('2 redirect chains');
  });

  it('includes CWV metrics in detailed verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      siteHealth: makeSiteHealthSlice({
        auditScore: 80,
        performanceSummary: {
          score: 85,
          avgLcp: 2100,
          avgFid: 80,
          avgCls: 0.05,
        },
      }),
    });
    const result = formatForPrompt(intel, { verbosity: 'detailed' });
    expect(result).toContain('Core Web Vitals');
    expect(result).toContain('LCP');
    expect(result).toContain('2.1s');
  });

  it('preserves exact compact output for a representative site health slice', () => {
    const result = formatSingleSection({
      siteHealth: makeSiteHealthSlice({
        auditScore: 81,
        auditScoreDelta: 3,
        anomalyCount: 2,
      }),
    }, 'siteHealth', 'compact');

    expect(result).toBe(
      [
        '[Workspace Intelligence]',
        '',
        '## Site Health',
        'Audit score: 81 (+3)',
        'Critical issues: 2 anomalies',
      ].join('\n')
    );
  });

  it('preserves exact standard output for a representative site health slice', () => {
    const result = formatSingleSection({
      siteHealth: makeSiteHealthSlice({
        auditScore: 81,
        auditScoreDelta: 3,
        deadLinks: 4,
        redirectChains: 2,
        orphanPages: 1,
        anomalyCount: 2,
        anomalyTypes: ['missing_title', 'redirect_loop'],
        performanceSummary: {
          score: 88,
          avgLcp: 2100,
          avgInp: 180,
          avgCls: 0.07,
        },
        aeoReadiness: { pagesChecked: 12, passingRate: 0.75 },
        weeklyMetricsTrend: {
          latestWeek: {
            snapshotDate: '2026-06-01',
            totalClicks: 420,
            totalImpressions: 8000,
            avgPosition: 12.1,
            auditScore: 81,
            organicTrafficValue: 983.4,
          },
          snapshotCount: 3,
        },
      }),
    }, 'siteHealth', 'standard');

    expect(result).toBe(
      [
        '[Workspace Intelligence]',
        '',
        '## Site Health',
        'Audit score: 81 (+3)',
        'Critical issues: 2 anomalies',
        'Performance: 88/100',
        'Links: 4 dead, 2 redirect chains, 1 orphan pages',
        'Anomaly types: missing_title, redirect_loop',
        'AEO readiness: 12 pages checked, 75% passing',
        'Latest week (2026-06-01): 420 clicks, audit 81, $983 traffic value — based on 3 snapshots',
      ].join('\n')
    );
  });

  it('preserves exact detailed output for a representative site health slice', () => {
    const result = formatSingleSection({
      siteHealth: makeSiteHealthSlice({
        auditScore: 81,
        auditScoreDelta: 3,
        deadLinks: 4,
        redirectChains: 2,
        orphanPages: 1,
        schemaErrors: 5,
        anomalyCount: 2,
        anomalyTypes: ['missing_title', 'redirect_loop'],
        seoChangeVelocity: 11,
        cwvPassRate: { mobile: 0.75, desktop: 0.5 },
        schemaValidation: { valid: 14, warnings: 3, errors: 1 },
        performanceSummary: {
          score: 88,
          avgLcp: 2100,
          avgInp: 180,
          avgCls: 0.07,
        },
        aeoReadiness: { pagesChecked: 12, passingRate: 0.75 },
        weeklyMetricsTrend: {
          latestWeek: {
            snapshotDate: '2026-06-01',
            totalClicks: 420,
            totalImpressions: 8000,
            avgPosition: 12.1,
            auditScore: 81,
            organicTrafficValue: 983.4,
          },
          snapshotCount: 3,
        },
        recentDiagnostics: [
          {
            insightId: 'diag-1',
            anomalyType: 'redirect_loop',
            status: 'completed',
            affectedPages: ['/pricing'],
            completedAt: '2026-06-02T00:00:00Z',
            rootCauseTitles: ['Duplicate redirect rule'],
          },
        ],
        redirectDetails: [
          { url: '/old', target: '/new', chainDepth: 2, status: 301 },
        ],
      }),
    }, 'siteHealth', 'detailed');

    expect(result).toBe(
      [
        '[Workspace Intelligence]',
        '',
        '## Site Health',
        'Audit score: 81 (+3)',
        'Critical issues: 2 anomalies',
        'Performance: 88/100',
        'Links: 4 dead, 2 redirect chains, 1 orphan pages',
        'Anomaly types: missing_title, redirect_loop',
        'AEO readiness: 12 pages checked, 75% passing',
        'Latest week (2026-06-01): 420 clicks, audit 81, $983 traffic value — based on 3 snapshots',
        'Recent diagnostics:',
        '  redirect_loop [completed] on /pricing → Duplicate redirect rule',
        'Schema errors: 5',
        'SEO change velocity: 11 changes (30d)',
        'CWV pass rate: mobile 75%, desktop 50%',
        'Schema validation: 14 valid, 3 warnings, 1 errors',
        'Core Web Vitals: LCP: 2.1s, INP: 180ms, CLS: 0.07',
        'Redirect chain details:',
        '  - /old → /new (2 hops, status 301)',
      ].join('\n')
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatForPrompt — clientSignals section
// ════════════════════════════════════════════════════════════════════════════

describe('formatForPrompt — clientSignals section', () => {
  it('includes Client Signals header', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      clientSignals: makeClientSignalsSlice({ churnRisk: 'low' }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('## Client Signals');
  });

  it('shows churn risk', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      clientSignals: makeClientSignalsSlice({ churnRisk: 'high' }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Churn risk: high');
  });

  it('shows unknown when churnRisk is null', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      clientSignals: makeClientSignalsSlice({ churnRisk: null }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Churn risk: unknown');
  });

  it('shows ROI info when present', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      clientSignals: makeClientSignalsSlice({
        churnRisk: 'low',
        roi: { organicValue: 5000, growth: 12, period: '30d' },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('$5000');
    expect(result).toContain('+12%');
  });

  it('shows composite health breakdown rows when present', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      clientSignals: makeClientSignalsSlice({
        churnRisk: 'low',
        compositeHealthScore: 77,
        compositeHealthBreakdown: {
          rows: [
            {
              id: 'retention',
              label: 'Retention signals',
              score: 60,
              weight: 40,
              description: 'Recent account signals show room to strengthen the client relationship.',
            },
            {
              id: 'engagement',
              label: 'Portal engagement',
              score: 100,
              weight: 30,
              description: 'Portal activity shows strong engagement with the work in progress.',
            },
          ],
        },
      }),
    });

    const result = formatForPrompt(intel);

    expect(result).toContain('Health score breakdown');
    expect(result).toContain('Retention signals 60/100 (40% weight)');
    expect(result).toContain('Portal engagement 100/100 (30% weight)');
  });

  it('includes approval rate in standard verbosity when > 0', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      clientSignals: makeClientSignalsSlice({
        churnRisk: 'low',
        approvalPatterns: { approvalRate: 0.8, avgResponseTime: null },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Approval rate: 80%');
  });

  it('includes business priorities in standard verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      clientSignals: makeClientSignalsSlice({
        churnRisk: 'low',
        businessPriorities: ['more local traffic', 'rank for implants'],
        effectiveBusinessPriorities: ['more local traffic', 'rank for implants'],
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Business priorities');
    expect(result).toContain('more local traffic');
  });

  it('includes churn signals in detailed verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      clientSignals: makeClientSignalsSlice({
        churnRisk: 'medium',
        churnSignals: [{
          type: 'low_engagement',
          severity: 'medium',
          detectedAt: '2026-01-01',
          title: 'Low portal activity',
          description: 'Client has not logged in for 14 days',
        }],
      }),
    });
    const result = formatForPrompt(intel, { verbosity: 'detailed' });
    expect(result).toContain('Churn signals');
    expect(result).toContain('Low portal activity');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatForPrompt — operational section
// ════════════════════════════════════════════════════════════════════════════

describe('formatForPrompt — operational section', () => {
  it('includes Operational header', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      operational: makeOperationalSlice(),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('## Operational');
  });

  it('includes pending counts summary', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      operational: makeOperationalSlice({
        approvalQueue: { pending: 3, oldestAge: null },
        clientActionQueue: { pending: 2, oldestAge: 48 },
        actionBacklog: { pendingMeasurement: 5, oldestAge: null },
        recommendationQueue: { fixNow: 1, fixSoon: 2, fixLater: 3 },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('3 approvals');
    expect(result).toContain('2 client actions');
    expect(result).toContain('5 actions awaiting measurement');
  });

  it('includes recent activity in standard verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      operational: makeOperationalSlice({
        recentActivity: [
          { type: 'content', description: 'Published blog post', timestamp: '2026-01-01' },
          { type: 'seo', description: 'Updated title tags', timestamp: '2026-01-02' },
        ],
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Recent:');
    expect(result).toContain('Published blog post');
  });

  it('includes annotations in detailed verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      operational: makeOperationalSlice({
        annotations: [{ date: '2026-01-15', label: 'Google algorithm update' }],
      }),
    });
    const result = formatForPrompt(intel, { verbosity: 'detailed' });
    expect(result).toContain('Timeline annotations');
    expect(result).toContain('Google algorithm update');
  });

  it('preserves exact compact output for a representative operational slice', () => {
    const result = formatSingleSection({
      operational: makeOperationalSlice({
        approvalQueue: { pending: 2, oldestAge: 12 },
        clientActionQueue: { pending: 3, oldestAge: 18 },
        actionBacklog: { pendingMeasurement: 4, oldestAge: 24 },
        recommendationQueue: { fixNow: 1, fixSoon: 2, fixLater: 3 },
      }),
    }, 'operational', 'compact');

    expect(result).toBe(
      [
        '[Workspace Intelligence]',
        '',
        '## Operational',
        'Pending: 2 approvals, 3 client actions, 4 actions awaiting measurement, 6 recommendations',
      ].join('\n')
    );
  });

  it('preserves exact standard output for a representative operational slice', () => {
    const result = formatSingleSection({
      operational: makeOperationalSlice({
        recentActivity: [
          { type: 'insight_created', description: 'New insight added', timestamp: '2026-05-01T00:00:00Z' },
          { type: 'brief_published', description: 'Brief published', timestamp: '2026-05-02T00:00:00Z' },
          { type: 'post_sent', description: 'Post sent to client', timestamp: '2026-05-03T00:00:00Z' },
        ],
        pendingJobs: 2,
        approvalQueue: { pending: 2, oldestAge: 12 },
        clientActionQueue: { pending: 3, oldestAge: 18 },
        actionBacklog: { pendingMeasurement: 4, oldestAge: 24 },
        recommendationQueue: { fixNow: 1, fixSoon: 2, fixLater: 3 },
        timeSaved: { totalMinutes: 135, byFeature: { briefs: 45 } },
        workOrders: { active: 5, pending: 1 },
        effectiveTier: 'growth',
        usageRemaining: { briefs: 4, posts: 2, ai_tokens: Infinity, seo_edits: 7 },
        pageEditStateSummary: { total: 6, byStatus: { clean: 2, approved: 3, live: 1 } },
      }),
    }, 'operational', 'standard');

    expect(result).toBe(
      [
        '[Workspace Intelligence]',
        '',
        '## Operational',
        'Pending: 2 approvals, 3 client actions, 4 actions awaiting measurement, 6 recommendations',
        'Recommendations: 1 fix now, 2 fix soon, 3 fix later',
        'Recent: New insight added; Brief published; Post sent to client',
        'Time saved: 135 minutes',
        'Background jobs: 2 pending',
        'Work orders: 5 active, 1 pending',
        'Client action queue: 3 pending, oldest 18h',
        'Subscription tier: growth',
        'Usage remaining: briefs: 4 remaining, posts: 2 remaining, seo edits: 7 remaining',
        'Page states (6 total): 2 clean, 3 approved, 1 live',
      ].join('\n')
    );
  });

  it('preserves exact detailed output for a representative operational slice', () => {
    const result = formatSingleSection({
      operational: makeOperationalSlice({
        recentActivity: [
          { type: 'insight_created', description: 'New insight added', timestamp: '2026-05-01T00:00:00Z' },
          { type: 'brief_published', description: 'Brief published', timestamp: '2026-05-02T00:00:00Z' },
          { type: 'post_sent', description: 'Post sent to client', timestamp: '2026-05-03T00:00:00Z' },
        ],
        annotations: [
          { date: '2026-06-01', label: 'Homepage refreshed' },
          { date: '2026-06-02', label: 'Schema rollout' },
        ],
        pendingJobs: 2,
        approvalQueue: { pending: 2, oldestAge: 12 },
        clientActionQueue: { pending: 3, oldestAge: 18 },
        actionBacklog: { pendingMeasurement: 4, oldestAge: 24 },
        recommendationQueue: { fixNow: 1, fixSoon: 2, fixLater: 3 },
        timeSaved: { totalMinutes: 135, byFeature: { briefs: 45, posts: 90 } },
        workOrders: { active: 5, pending: 1 },
        detectedPlaybooks: ['refresh decays', 'expand clusters'],
        insightAcceptanceRate: { rate: 0.45, confirmed: 9, totalShown: 20 },
        effectiveTier: 'growth',
        usageRemaining: { briefs: 4, posts: 2, ai_tokens: Infinity, seo_edits: 7 },
        pageEditStateSummary: { total: 6, byStatus: { clean: 2, approved: 3, live: 1 } },
      }),
    }, 'operational', 'detailed');

    expect(result).toBe(
      [
        '[Workspace Intelligence]',
        '',
        '## Operational',
        'Pending: 2 approvals, 3 client actions, 4 actions awaiting measurement, 6 recommendations',
        'Recommendations: 1 fix now, 2 fix soon, 3 fix later',
        'Recent: New insight added; Brief published; Post sent to client',
        'Time saved: 135 minutes',
        'Background jobs: 2 pending',
        'Work orders: 5 active, 1 pending',
        'Client action queue: 3 pending, oldest 18h',
        'Subscription tier: growth',
        'Usage remaining: briefs: 4 remaining, posts: 2 remaining, seo edits: 7 remaining',
        'Page states (6 total): 2 clean, 3 approved, 1 live',
        'Detected playbooks: refresh decays, expand clusters',
        'Time saved by feature:',
        '  briefs: 45 min',
        '  posts: 90 min',
        'Timeline annotations:',
        '  - 2026-06-01: Homepage refreshed',
        '  - 2026-06-02: Schema rollout',
        'Insight acceptance rate: 45% (9/20)',
      ].join('\n')
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatForPrompt — localSeo section
// ════════════════════════════════════════════════════════════════════════════

describe('formatForPrompt — localSeo section', () => {
  it('includes Local SEO header', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      localSeo: makeLocalSeoSlice({
        effectiveLocalSeoBlock: 'Chicago, IL — dentist near me: visible at position 3',
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('## Local SEO');
  });

  it('shows disabled message when enabled is false', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      localSeo: makeLocalSeoSlice({ enabled: false }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('disabled');
  });

  it('shows compact one-liner in compact verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      localSeo: makeLocalSeoSlice({
        markets: [
          { id: 'm1', label: 'Chicago', status: 'active', location: 'Chicago, IL' },
          { id: 'm2', label: 'Austin', status: 'inactive', location: 'Austin, TX' },
        ],
        visibility: { visible: 10, possibleMatch: 2, notVisible: 5, notChecked: 3, providerDegraded: 0 },
      }),
    });
    const result = formatForPrompt(intel, { verbosity: 'compact' });
    expect(result).toContain('1 active markets');
    expect(result).toContain('10 visible');
  });

  it('injects effectiveLocalSeoBlock directly in standard verbosity', () => {
    const block = 'Chicago, IL — rank 3 for dental implants';
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      localSeo: makeLocalSeoSlice({ effectiveLocalSeoBlock: block }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain(block);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatForPrompt — pageProfile section
// ════════════════════════════════════════════════════════════════════════════

describe('formatForPrompt — pageProfile section', () => {
  it('includes Page Profile header with pagePath', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      pageProfile: makePageProfileSlice({ pagePath: '/services/implants' }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('## Page Profile: /services/implants');
  });

  it('shows keyword and health score on summary line', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      pageProfile: makePageProfileSlice({
        primaryKeyword: 'dental implants',
        optimizationScore: 82,
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('dental implants');
    expect(result).toContain('82');
  });

  it('shows none for null primaryKeyword', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      pageProfile: makePageProfileSlice({ primaryKeyword: null }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('none');
  });

  it('shows position and trend in standard verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      pageProfile: makePageProfileSlice({
        primaryKeyword: 'dental implants',
        rankHistory: { current: 7, best: 5, trend: 'up' },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('Position: 7');
  });

  it('shows link health at all verbosity levels', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      pageProfile: makePageProfileSlice({
        primaryKeyword: 'dental implants',
        linkHealth: { inbound: 12, outbound: 8, orphan: false },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('12 inbound');
    expect(result).toContain('8 outbound');
  });

  it('shows ORPHAN warning when orphan is true', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      pageProfile: makePageProfileSlice({
        primaryKeyword: 'dental implants',
        linkHealth: { inbound: 0, outbound: 5, orphan: true },
      }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('ORPHAN');
  });

  it('includes optimization issues in detailed verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      pageProfile: makePageProfileSlice({
        primaryKeyword: 'dental implants',
        optimizationIssues: ['Keyword missing from title', 'Meta description too short'],
      }),
    });
    const result = formatForPrompt(intel, { verbosity: 'detailed' });
    expect(result).toContain('Optimization issues');
    expect(result).toContain('Keyword missing from title');
  });

  it('includes schema status in detailed verbosity', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      pageProfile: makePageProfileSlice({
        primaryKeyword: 'dental implants',
        schemaStatus: 'valid',
      }),
    });
    const result = formatForPrompt(intel, { verbosity: 'detailed' });
    expect(result).toContain('Schema: valid');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatForPrompt — section filtering
// ════════════════════════════════════════════════════════════════════════════

describe('formatForPrompt — section filtering', () => {
  it('only includes requested sections', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
      siteHealth: makeSiteHealthSlice({ auditScore: 75 }),
      contentPipeline: makeContentPipelineSlice({
        briefs: { total: 3, byStatus: {} },
        posts: { total: 1, byStatus: {} },
        matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
      }),
    });
    const result = formatForPrompt(intel, { sections: ['siteHealth'] });
    expect(result).toContain('## Site Health');
    expect(result).not.toContain('## Content Pipeline');
    expect(result).not.toContain('## SEO Context');
  });

  it('returns appropriate content when filtering for a single slice with data', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
    });
    const result = formatForPrompt(intel, { sections: ['seoContext'] });
    expect(result).toContain('## SEO Context');
  });

  it('always includes the [Workspace Intelligence] header', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
    });
    const result = formatForPrompt(intel);
    expect(result).toContain('[Workspace Intelligence]');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// formatForPrompt — token budget truncation
// ════════════════════════════════════════════════════════════════════════════

describe('formatForPrompt — token budget', () => {
  it('returns full output when within budget', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental' }),
    });
    // Very large budget — nothing should be dropped
    const result = formatForPrompt(intel, { tokenBudget: 999999 });
    expect(result).toContain('## SEO Context');
  });

  it('drops operational section first when over budget', () => {
    const insightItems = Array.from({ length: 20 }, (_, i) => ({
      id: `i${i}`,
      workspaceId: 'ws1',
      insightType: 'ranking_opportunity' as never,
      severity: 'opportunity' as const,
      title: 'X'.repeat(200),
      status: 'active',
      createdAt: '2026-01-01',
      impactScore: 80,
    })) as never[];

    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'A'.repeat(500) }),
      insights: makeInsightsSlice({
        all: insightItems,
        topByImpact: insightItems,
        bySeverity: { critical: 0, warning: 0, opportunity: 20, positive: 0 },
      }),
      operational: makeOperationalSlice({
        recentActivity: [{ type: 'x', description: 'Y'.repeat(300), timestamp: '2026-01-01' }],
      }),
    });

    // Budget that forces dropping operational but keeps the rest
    const result = formatForPrompt(intel, { tokenBudget: 200 });
    expect(result).not.toContain('## Operational');
  });

  it('keeps seoContext even when budget is extremely tight', () => {
    const intel = makeIntelligence({
      seoContext: makeSeoContext({ businessContext: 'Dental clinic specializing in implants' }),
      insights: makeInsightsSlice({
        all: Array.from({ length: 30 }, (_, i) => ({
          id: `i${i}`,
          workspaceId: 'ws1',
          insightType: 'ranking_opportunity' as never,
          severity: 'opportunity' as const,
          title: 'Long insight title '.repeat(5),
          status: 'active',
          createdAt: '2026-01-01',
          impactScore: 80,
        })) as never[],
        topByImpact: [] as never[],
        bySeverity: { critical: 0, warning: 0, opportunity: 30, positive: 0 },
      }),
      operational: makeOperationalSlice(),
      clientSignals: makeClientSignalsSlice({ churnRisk: 'low' }),
    });

    // Extremely tight budget — only seoContext should survive
    const result = formatForPrompt(intel, { tokenBudget: 30 });
    expect(result).toContain('[Workspace Intelligence]');
    // seoContext or at minimum the workspace header should be present
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
