/**
 * Integration tests for the content brief generation pipeline.
 *
 * Tests generateBrief(), regenerateBrief(), and regenerateOutline() with
 * mocked OpenAI calls. Validates:
 *   - Brief generation with full context sources (keyword data, competitor analysis, site context)
 *   - AI prompt construction (context blocks injected correctly)
 *   - Brief structure validation (all required sections present)
 *   - DB persistence after generation
 *   - Error handling when AI call fails
 *   - Regeneration with modified parameters
 *   - Outline-only regeneration
 *
 * Existing unit tests cover: CRUD (list/get/update/delete), buildBriefIntelligenceBlock,
 * buildStrategyCardBlock, getPageTypeConfig. This file focuses on the async generation pipeline.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// ── Module-level mocks (hoisted by Vitest) ──────────────────────────────────

import {
  setupOpenAIMocks,
  mockOpenAIJsonResponse,
  mockOpenAIError,
  getCapturedOpenAICalls,
  resetOpenAIMocks,
  mockOpenAIResponse,
} from '../mocks/openai.js';

setupOpenAIMocks();

// Mock workspace-intelligence to avoid needing a fully-populated workspace
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async () => ({
    version: 1,
    workspaceId: '',
    assembledAt: new Date().toISOString(),
    seoContext: {
      strategy: {
        siteKeywords: ['seo', 'web design', 'content marketing'],
        businessContext: 'Digital agency specializing in SEO and web design',
        pageMap: [
          {
            pagePath: '/services/seo',
            primaryKeyword: 'seo services',
            secondaryKeywords: ['seo agency', 'search engine optimization'],
            serpFeatures: ['featured_snippet', 'people_also_ask'],
          },
        ],
      },
      brandVoice: 'Professional but approachable. Data-driven.',
      // Pre-formatted block with voice-authority applied. content-brief.ts now reads
      // this directly instead of calling formatBrandVoiceForPrompt on the raw brandVoice.
      effectiveBrandVoiceBlock: '\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\nProfessional but approachable. Data-driven.',
      knowledgeBase: 'We serve small to mid-size businesses.',
      businessContext: 'Digital agency specializing in SEO and web design',
      personas: null,
      pageKeywords: null,
    },
    pageProfile: null,
  })),
  formatKeywordsForPrompt: vi.fn(() => '\n\nKEYWORD STRATEGY (incorporate these naturally):\nSite target keywords: seo, web design'),
  formatPersonasForPrompt: vi.fn(() => ''),
  formatPageMapForPrompt: vi.fn(() => ''),
  formatKnowledgeBaseForPrompt: vi.fn(() => '\n\nBUSINESS KNOWLEDGE BASE:\nWe serve small to mid-size businesses.'),
}));

// Mock web-scraper (reference URL scraping)
vi.mock('../../server/web-scraper.js', () => ({
  buildReferenceContext: vi.fn(() => '\n\nREFERENCE PAGES:\n- https://competitor.com/guide'),
  buildSerpContext: vi.fn(() => '\n\nSERP DATA:\nPAA: How does SEO work?'),
  buildStyleExampleContext: vi.fn(() => ''),
}));

// Mock analytics-insights-store
vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));

// Mock broadcast (writes trigger broadcast calls)
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import db from '../../server/db/index.js';
import {
  generateBrief,
  regenerateBrief,
  regenerateOutline,
  getBrief,
  listBriefs,
  getPageTypeConfig,
  type ContentBrief,
} from '../../server/content-brief.js';
import { getInsights } from '../../server/analytics-insights-store.js';

// ── Test fixtures ───────────────────────────────────────────────────────────

const TEST_WS_ID = `ws_brief_gen_${Date.now()}`;
const now = new Date().toISOString();

/** A well-formed brief JSON response that the mock AI will return. */
function makeMockBriefResponse(overrides: Record<string, unknown> = {}) {
  return {
    executiveSummary: 'This guide helps businesses understand SEO fundamentals and implement effective strategies.',
    suggestedTitle: 'SEO Best Practices: A Complete Guide for 2026',
    titleVariants: ['The Ultimate SEO Guide for Small Business', 'How to Master SEO in 2026'],
    suggestedMetaDesc: 'Learn proven SEO strategies that drive organic traffic. Our complete guide covers keyword research, on-page optimization, and link building.',
    metaDescVariants: ['Master SEO with our step-by-step guide to ranking higher.'],
    secondaryKeywords: ['keyword research', 'on-page seo', 'link building', 'organic traffic', 'search rankings', 'seo strategy'],
    contentFormat: 'guide',
    toneAndStyle: 'Authoritative but approachable. Data-driven with practical examples.',
    outline: [
      {
        heading: 'What Is SEO and Why It Matters',
        subheadings: ['Core SEO Concepts', 'How Search Engines Work'],
        notes: 'Direct answer section covering fundamentals.',
        wordCount: 300,
        keywords: ['seo', 'search engine optimization'],
      },
      {
        heading: 'Keyword Research Strategies',
        subheadings: ['Finding the Right Keywords', 'Analyzing Keyword Difficulty'],
        notes: 'Practical guide to finding target keywords.',
        wordCount: 350,
        keywords: ['keyword research', 'keyword difficulty'],
      },
      {
        heading: 'On-Page Optimization Techniques',
        subheadings: ['Title Tags and Meta Descriptions', 'Content Structure'],
        notes: 'Specific on-page elements to optimize.',
        wordCount: 350,
        keywords: ['on-page seo', 'title tags'],
      },
      {
        heading: 'Building Quality Backlinks',
        subheadings: ['Link Building Strategies', 'Measuring Link Quality'],
        notes: 'Actionable link building tactics.',
        wordCount: 300,
        keywords: ['link building', 'backlinks'],
      },
      {
        heading: 'Measuring SEO Success',
        subheadings: ['Key Metrics to Track', 'Tools for SEO Reporting'],
        notes: 'How to track and measure ROI.',
        wordCount: 300,
        keywords: ['seo metrics', 'search rankings'],
      },
    ],
    wordCountTarget: 1800,
    intent: 'informational',
    audience: 'Small business owners looking to improve their organic search visibility.',
    peopleAlsoAsk: [
      'How long does SEO take to work?',
      'What are the most important SEO ranking factors?',
      'Is SEO worth it for small businesses?',
      'How much does SEO cost?',
      'What is the difference between SEO and SEM?',
    ],
    topicalEntities: ['Google algorithm', 'SERP', 'domain authority', 'crawlability', 'indexing', 'schema markup', 'core web vitals', 'E-E-A-T'],
    serpAnalysis: {
      contentType: 'comprehensive guide',
      avgWordCount: 2200,
      commonElements: ['comparison tables', 'step-by-step instructions', 'expert quotes'],
      gaps: ['real case studies', 'updated 2026 data', 'video walkthroughs'],
    },
    difficultyScore: 55,
    trafficPotential: '1,000-2,500 monthly searches, moderate competition',
    competitorInsights: 'Top-ranking content tends to be 2,000+ words with original data. Gap: most lack recent case studies.',
    ctaRecommendations: ['Download our SEO checklist', 'Book a free SEO audit'],
    internalLinkSuggestions: ['/services/seo', '/case-studies', '/blog/keyword-research-guide'],
    eeatGuidance: {
      experience: 'Include original screenshots and real client data.',
      expertise: 'Reference Google documentation and industry standards.',
      authority: 'Link to authoritative sources like Google Search Central.',
      trust: 'Include author bio with credentials and last-updated date.',
    },
    contentChecklist: [
      'Include at least 2 original data points',
      'Add a comparison table in the tools section',
      'Include FAQ section with PAA questions',
      'Add author byline with credentials',
      'Add visible last-updated date',
      'Verify all internal links resolve correctly',
      'Include at least 3 external citations',
      'Add alt text to all images using secondary keywords',
    ],
    schemaRecommendations: [
      { type: 'Article', notes: 'Use BlogPosting for the main content.' },
      { type: 'FAQPage', notes: 'Add FAQ schema for the People Also Ask section.' },
    ],
    ...overrides,
  };
}

// ── Setup / Teardown ────────────────────────────────────────────────────────

beforeAll(() => {
  // Seed workspace so FK constraints are satisfied
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, tier, created_at)
     VALUES (?, ?, ?, 'growth', ?)`,
  ).run(TEST_WS_ID, 'Brief Gen Test WS', `brief-gen-test`, now);

  // Set OPENAI_API_KEY so the guard check passes
  process.env.OPENAI_API_KEY = 'test-key-for-brief-generation';
});

beforeEach(() => {
  resetOpenAIMocks();
});

afterAll(() => {
  // Clean up all briefs and the workspace
  db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(TEST_WS_ID);
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(TEST_WS_ID);
  delete process.env.OPENAI_API_KEY;
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. generateBrief — happy path with full context
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateBrief — happy path', () => {
  it('generates a brief with all required fields populated', async () => {
    const mockResponse = makeMockBriefResponse();
    mockOpenAIJsonResponse('content-brief', mockResponse);

    const brief = await generateBrief(TEST_WS_ID, 'seo best practices', {
      relatedQueries: [
        { query: 'seo tips', position: 5, clicks: 100, impressions: 2000 },
        { query: 'seo strategy 2026', position: 8, clicks: 50, impressions: 1200 },
      ],
      businessContext: 'We help small businesses grow online.',
      existingPages: ['/services/seo', '/blog/keyword-research', '/about'],
    });

    // Required top-level fields
    expect(brief.id).toMatch(/^brief_/);
    expect(brief.workspaceId).toBe(TEST_WS_ID);
    expect(brief.targetKeyword).toBe('seo best practices');
    expect(brief.suggestedTitle).toBe(mockResponse.suggestedTitle);
    expect(brief.suggestedMetaDesc).toBe(mockResponse.suggestedMetaDesc);
    expect(brief.wordCountTarget).toBe(1800);
    expect(brief.intent).toBe('informational');
    expect(brief.createdAt).toBeTruthy();

    // Secondary keywords
    expect(brief.secondaryKeywords.length).toBeGreaterThan(0);
    expect(brief.secondaryKeywords).toContain('keyword research');

    // Outline structure
    expect(brief.outline.length).toBeGreaterThan(0);
    const firstSection = brief.outline[0];
    expect(firstSection.heading).toBeTruthy();
    expect(firstSection.notes).toBeTruthy();
    expect(typeof firstSection.wordCount).toBe('number');
    expect(firstSection.keywords!.length).toBeGreaterThan(0);

    // Enhanced v2 fields
    expect(brief.executiveSummary).toBeTruthy();
    expect(brief.contentFormat).toBe('guide');
    expect(brief.toneAndStyle).toBeTruthy();
    expect(brief.peopleAlsoAsk!.length).toBeGreaterThan(0);
    expect(brief.topicalEntities!.length).toBeGreaterThan(0);
    expect(brief.serpAnalysis).toBeDefined();
    expect(brief.serpAnalysis!.contentType).toBeTruthy();
    expect(brief.serpAnalysis!.avgWordCount).toBeGreaterThan(0);
    expect(typeof brief.difficultyScore).toBe('number');
    expect(brief.trafficPotential).toBeTruthy();
    expect(brief.competitorInsights).toBeTruthy();
    expect(brief.ctaRecommendations!.length).toBeGreaterThan(0);
    expect(brief.internalLinkSuggestions.length).toBeGreaterThan(0);

    // v3 EEAT fields
    expect(brief.eeatGuidance).toBeDefined();
    expect(brief.eeatGuidance!.experience).toBeTruthy();
    expect(brief.eeatGuidance!.expertise).toBeTruthy();
    expect(brief.eeatGuidance!.authority).toBeTruthy();
    expect(brief.eeatGuidance!.trust).toBeTruthy();
    expect(brief.contentChecklist!.length).toBeGreaterThan(0);
    expect(brief.schemaRecommendations!.length).toBeGreaterThan(0);

    // v7 title/meta variants
    expect(brief.titleVariants!.length).toBeGreaterThan(0);
    expect(brief.metaDescVariants!.length).toBeGreaterThan(0);
  });

  it('persists generated brief to the database', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    const brief = await generateBrief(TEST_WS_ID, 'content marketing strategy', {});

    // Verify we can retrieve it from DB
    const fetched = getBrief(TEST_WS_ID, brief.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(brief.id);
    expect(fetched!.targetKeyword).toBe('content marketing strategy');
    expect(fetched!.suggestedTitle).toBe(brief.suggestedTitle);
    expect(fetched!.outline.length).toBe(brief.outline.length);

    // Verify it appears in the list
    const all = listBriefs(TEST_WS_ID);
    const found = all.find(b => b.id === brief.id);
    expect(found).toBeDefined();
  });

  it('passes the correct feature name to callOpenAI', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    await generateBrief(TEST_WS_ID, 'test keyword', {});

    const calls = getCapturedOpenAICalls();
    expect(calls.length).toBeGreaterThan(0);
    const briefCall = calls.find(c => c.feature === 'content-brief');
    expect(briefCall).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. generateBrief — prompt construction with context sources
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateBrief — prompt construction', () => {
  it('includes related queries in the prompt', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    await generateBrief(TEST_WS_ID, 'dental seo', {
      relatedQueries: [
        { query: 'dental marketing', position: 3, clicks: 200, impressions: 5000 },
      ],
    });

    const calls = getCapturedOpenAICalls();
    const briefCall = calls.find(c => c.feature === 'content-brief');
    expect(briefCall).toBeDefined();
    const promptContent = (briefCall!.messages.find(m => m.role === 'user') ?? briefCall!.messages[0]).content;
    expect(promptContent).toContain('dental marketing');
    expect(promptContent).toContain('200 clicks');
  });

  it('includes SEMRush metrics in the prompt when provided', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    await generateBrief(TEST_WS_ID, 'seo tools', {
      semrushMetrics: {
        keyword: 'seo tools',
        volume: 12000,
        difficulty: 65,
        cpc: 4.50,
        competition: 0.82,
        results: 450000000,
        trend: [9000, 9500, 10000, 10500, 11000, 11500, 12000, 12000, 12500, 12000, 11500, 12000],
      },
      semrushRelated: [
        { keyword: 'best seo tools', volume: 6000, difficulty: 55, cpc: 3.25 },
        { keyword: 'free seo tools', volume: 8000, difficulty: 45, cpc: 2.10 },
      ],
    });

    const calls = getCapturedOpenAICalls();
    const briefCall = calls.find(c => c.feature === 'content-brief');
    const promptContent = (briefCall!.messages.find(m => m.role === 'user') ?? briefCall!.messages[0]).content;
    expect(promptContent).toContain('REAL KEYWORD DATA');
    expect(promptContent).toContain('12,000');
    expect(promptContent).toContain('65/100');
    expect(promptContent).toContain('RELATED KEYWORDS');
    expect(promptContent).toContain('best seo tools');
    expect(promptContent).toContain('free seo tools');
  });

  it('includes GA4 page performance data in the prompt', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    await generateBrief(TEST_WS_ID, 'content refresh', {
      ga4PagePerformance: [
        { landingPage: '/blog/old-seo-guide', sessions: 500, users: 420, bounceRate: 65.2, avgEngagementTime: 180, conversions: 5 },
      ],
    });

    const calls = getCapturedOpenAICalls();
    const briefCall = calls.find(c => c.feature === 'content-brief');
    const promptContent = (briefCall!.messages.find(m => m.role === 'user') ?? briefCall!.messages[0]).content;
    expect(promptContent).toContain('EXISTING PAGE PERFORMANCE DATA');
    expect(promptContent).toContain('/blog/old-seo-guide');
    expect(promptContent).toContain('500 sessions');
  });

  it('includes SERP data in the prompt', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    await generateBrief(TEST_WS_ID, 'best crm software', {
      serpData: {
        peopleAlsoAsk: ['What is the best CRM for small business?', 'How much does CRM cost?'],
        organicResults: [
          { position: 1, title: 'Top 10 CRM Software', url: 'https://example.com/crm' },
        ],
      },
    });

    const calls = getCapturedOpenAICalls();
    const briefCall = calls.find(c => c.feature === 'content-brief');
    const promptContent = (briefCall!.messages.find(m => m.role === 'user') ?? briefCall!.messages[0]).content;
    // buildSerpContext is mocked and returns PAA content
    expect(promptContent).toContain('SERP DATA');
  });

  it('includes template constraints in the prompt when provided', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    await generateBrief(TEST_WS_ID, 'service page seo', {
      templateSections: [
        { name: 'Overview', headingTemplate: '{service} Overview', guidance: 'Describe the service in detail', wordCountTarget: 300 },
        { name: 'Benefits', headingTemplate: 'Benefits of {service}', guidance: 'List the key benefits', wordCountTarget: 250 },
      ],
      templateToneOverride: 'Formal and authoritative',
      templateTitlePattern: '{service} | Expert {location} Services',
      templateMetaDescPattern: 'Get expert {service} in {location}.',
    });

    const calls = getCapturedOpenAICalls();
    const briefCall = calls.find(c => c.feature === 'content-brief');
    const promptContent = (briefCall!.messages.find(m => m.role === 'user') ?? briefCall!.messages[0]).content;
    expect(promptContent).toContain('TEMPLATE STRUCTURE');
    expect(promptContent).toContain('Overview');
    expect(promptContent).toContain('Benefits');
    expect(promptContent).toContain('TONE OVERRIDE');
    expect(promptContent).toContain('Formal and authoritative');
    expect(promptContent).toContain('TITLE PATTERN');
    expect(promptContent).toContain('META DESC PATTERN');
  });

  it('includes page analysis context in the prompt', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    await generateBrief(TEST_WS_ID, 'new topic keyword', {
      pageAnalysisContext: {
        optimizationScore: 42,
        optimizationIssues: ['Missing H1 tag', 'Thin content'],
        recommendations: ['Add structured data', 'Improve internal linking'],
        contentGaps: ['Competitor covers pricing section'],
        searchIntent: 'commercial',
      },
    });

    const calls = getCapturedOpenAICalls();
    const briefCall = calls.find(c => c.feature === 'content-brief');
    const promptContent = (briefCall!.messages.find(m => m.role === 'user') ?? briefCall!.messages[0]).content;
    expect(promptContent).toContain('PAGE ANALYSIS CONTEXT');
    expect(promptContent).toContain('42/100');
    expect(promptContent).toContain('Missing H1 tag');
    expect(promptContent).toContain('Competitor covers pricing section');
  });

  it('includes strategy card context in the prompt', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    await generateBrief(TEST_WS_ID, 'strategy-driven keyword', {
      strategyCardContext: {
        rationale: 'High-volume gap with no existing page',
        intent: 'informational',
        priority: 'high',
        journeyStage: 'awareness',
      },
    });

    const calls = getCapturedOpenAICalls();
    const briefCall = calls.find(c => c.feature === 'content-brief');
    const promptContent = (briefCall!.messages.find(m => m.role === 'user') ?? briefCall!.messages[0]).content;
    expect(promptContent).toContain('STRATEGY CARD CONTEXT');
    expect(promptContent).toContain('High-volume gap with no existing page');
    expect(promptContent).toContain('awareness');
  });

  it('applies page-type-specific configuration for landing pages', async () => {
    const landingResponse = makeMockBriefResponse({ wordCountTarget: 900 });
    mockOpenAIJsonResponse('content-brief', landingResponse);

    const brief = await generateBrief(TEST_WS_ID, 'landing page keyword', {
      pageType: 'landing',
    });

    const calls = getCapturedOpenAICalls();
    const briefCall = calls.find(c => c.feature === 'content-brief');
    const promptContent = (briefCall!.messages.find(m => m.role === 'user') ?? briefCall!.messages[0]).content;
    expect(promptContent).toContain('PAGE TYPE: Landing Page');
    expect(promptContent).toContain('conversion-focused');
    expect(brief.pageType).toBe('landing');
  });

  it('persists reference URLs and SERP data on the brief', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    const brief = await generateBrief(TEST_WS_ID, 'crm comparison', {
      referenceUrls: ['https://competitor.com/crm-guide', 'https://another.com/crm'],
      serpData: {
        peopleAlsoAsk: ['Which CRM is best?', 'How to choose a CRM?'],
        organicResults: [
          { position: 1, title: 'Best CRM 2026', url: 'https://example.com/best-crm' },
          { position: 2, title: 'CRM Comparison', url: 'https://example.com/compare' },
        ],
      },
    });

    expect(brief.referenceUrls).toEqual(['https://competitor.com/crm-guide', 'https://another.com/crm']);
    expect(brief.realPeopleAlsoAsk!.length).toBe(2);
    expect(brief.realPeopleAlsoAsk).toContain('Which CRM is best?');
    expect(brief.realTopResults!.length).toBe(2);
    expect(brief.realTopResults![0].position).toBe(1);
    expect(brief.realTopResults![0].title).toBe('Best CRM 2026');

    // Verify DB persistence of SERP data
    const fetched = getBrief(TEST_WS_ID, brief.id);
    expect(fetched!.realPeopleAlsoAsk).toEqual(brief.realPeopleAlsoAsk);
    expect(fetched!.realTopResults).toEqual(brief.realTopResults);
    expect(fetched!.referenceUrls).toEqual(brief.referenceUrls);
  });

  it('persists keyword tracking metadata on the brief', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    const brief = await generateBrief(TEST_WS_ID, 'locked keyword', {
      keywordLocked: true,
      keywordSource: 'semrush',
      keywordValidation: {
        volume: 5000,
        difficulty: 40,
        cpc: 2.50,
        validatedAt: '2026-03-15T00:00:00Z',
      },
      templateId: 'tmpl-123',
    });

    expect(brief.keywordLocked).toBe(true);
    expect(brief.keywordSource).toBe('semrush');
    expect(brief.keywordValidation!.volume).toBe(5000);
    expect(brief.templateId).toBe('tmpl-123');

    // Verify DB persistence
    const fetched = getBrief(TEST_WS_ID, brief.id);
    expect(fetched!.keywordLocked).toBe(true);
    expect(fetched!.keywordSource).toBe('semrush');
    expect(fetched!.keywordValidation!.difficulty).toBe(40);
    expect(fetched!.templateId).toBe('tmpl-123');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. generateBrief — error handling
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateBrief — error handling', () => {
  it('throws when OPENAI_API_KEY is not set', async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    await expect(
      generateBrief(TEST_WS_ID, 'test keyword', {}),
    ).rejects.toThrow('OPENAI_API_KEY not configured');

    process.env.OPENAI_API_KEY = savedKey;
  });

  it('throws when AI call fails', async () => {
    mockOpenAIError('content-brief', 'Rate limit exceeded');

    await expect(
      generateBrief(TEST_WS_ID, 'failing keyword', {}),
    ).rejects.toThrow('Rate limit exceeded');
  });

  it('handles malformed AI JSON response gracefully', async () => {
    // Return invalid JSON text (not via mockOpenAIJsonResponse which auto-stringifies)
    mockOpenAIResponse('content-brief', 'This is not valid JSON {{{');

    await expect(
      generateBrief(TEST_WS_ID, 'bad json keyword', {}),
    ).rejects.toThrow('Failed to parse AI response as JSON');
  });

  it('falls back to defaults when AI returns empty/partial JSON', async () => {
    // Return a minimal JSON — most fields missing
    mockOpenAIJsonResponse('content-brief', {
      suggestedTitle: 'Minimal Title',
    });

    const brief = await generateBrief(TEST_WS_ID, 'partial response keyword', {});

    // Should use the one field provided
    expect(brief.suggestedTitle).toBe('Minimal Title');
    // Should fall back to defaults for missing fields
    expect(brief.secondaryKeywords).toEqual([]);
    expect(brief.outline).toEqual([]);
    expect(brief.wordCountTarget).toBe(1500);
    expect(brief.intent).toBe('informational');
    expect(brief.internalLinkSuggestions).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Brief structure validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('brief structure validation', () => {
  it('outline sections have the expected shape', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    const brief = await generateBrief(TEST_WS_ID, 'outline test', {});

    expect(brief.outline.length).toBeGreaterThan(0);
    for (const section of brief.outline) {
      expect(typeof section.heading).toBe('string');
      expect(section.heading.length).toBeGreaterThan(0);
      expect(typeof section.notes).toBe('string');
      expect(section.notes.length).toBeGreaterThan(0);
      expect(typeof section.wordCount).toBe('number');
      expect(section.wordCount).toBeGreaterThan(0);
    }
  });

  it('EEAT guidance has all four dimensions', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    const brief = await generateBrief(TEST_WS_ID, 'eeat test', {});

    expect(brief.eeatGuidance).toBeDefined();
    const eeat = brief.eeatGuidance!;
    expect(typeof eeat.experience).toBe('string');
    expect(typeof eeat.expertise).toBe('string');
    expect(typeof eeat.authority).toBe('string');
    expect(typeof eeat.trust).toBe('string');
    expect(eeat.experience.length).toBeGreaterThan(0);
    expect(eeat.expertise.length).toBeGreaterThan(0);
    expect(eeat.authority.length).toBeGreaterThan(0);
    expect(eeat.trust.length).toBeGreaterThan(0);
  });

  it('SERP analysis has required sub-fields', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    const brief = await generateBrief(TEST_WS_ID, 'serp analysis test', {});

    expect(brief.serpAnalysis).toBeDefined();
    const serp = brief.serpAnalysis!;
    expect(typeof serp.contentType).toBe('string');
    expect(typeof serp.avgWordCount).toBe('number');
    expect(Array.isArray(serp.commonElements)).toBe(true);
    expect(serp.commonElements.length).toBeGreaterThan(0);
    expect(Array.isArray(serp.gaps)).toBe(true);
    expect(serp.gaps.length).toBeGreaterThan(0);
  });

  it('schema recommendations each have type and notes', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    const brief = await generateBrief(TEST_WS_ID, 'schema test', {});

    expect(brief.schemaRecommendations).toBeDefined();
    expect(brief.schemaRecommendations!.length).toBeGreaterThan(0);
    for (const rec of brief.schemaRecommendations!) {
      expect(typeof rec.type).toBe('string');
      expect(rec.type.length).toBeGreaterThan(0);
      expect(typeof rec.notes).toBe('string');
      expect(rec.notes.length).toBeGreaterThan(0);
    }
  });

  it('page type config for each type has valid values', () => {
    const types = ['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource'];
    for (const pt of types) {
      const cfg = getPageTypeConfig(pt);
      expect(cfg.wordCountTarget).toBeGreaterThan(0);
      expect(cfg.wordCountRange.length).toBeGreaterThan(0);
      expect(cfg.sectionRange.length).toBeGreaterThan(0);
      expect(cfg.avgSectionWords).toBeGreaterThan(0);
      expect(cfg.contentStyle.length).toBeGreaterThan(0);
      expect(cfg.prompt.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. regenerateBrief — refinement with feedback
// ═══════════════════════════════════════════════════════════════════════════════

describe('regenerateBrief — refinement with feedback', () => {
  it('creates a new brief based on an existing one with feedback', async () => {
    // First generate an original brief
    const originalResponse = makeMockBriefResponse();
    mockOpenAIJsonResponse('content-brief', originalResponse);
    const originalBrief = await generateBrief(TEST_WS_ID, 'seo guide', {});

    // Now regenerate with feedback
    const regeneratedResponse = makeMockBriefResponse({
      suggestedTitle: 'Advanced SEO: The Definitive Guide for 2026',
      executiveSummary: 'Updated summary addressing user feedback about more advanced coverage.',
    });
    mockOpenAIJsonResponse('content-brief-regenerate', regeneratedResponse);

    const newBrief = await regenerateBrief(
      TEST_WS_ID,
      originalBrief,
      'Make it more advanced and technical. Focus on enterprise SEO.',
    );

    // New brief gets a different ID
    expect(newBrief.id).not.toBe(originalBrief.id);
    expect(newBrief.id).toMatch(/^brief_/);

    // Uses the updated response
    expect(newBrief.suggestedTitle).toBe('Advanced SEO: The Definitive Guide for 2026');
    expect(newBrief.executiveSummary).toBe('Updated summary addressing user feedback about more advanced coverage.');

    // Preserves the target keyword
    expect(newBrief.targetKeyword).toBe(originalBrief.targetKeyword);
    expect(newBrief.workspaceId).toBe(TEST_WS_ID);

    // Is persisted in the database
    const fetched = getBrief(TEST_WS_ID, newBrief.id);
    expect(fetched).toBeDefined();
    expect(fetched!.suggestedTitle).toBe(newBrief.suggestedTitle);
  });

  it('includes the previous brief and feedback in the prompt', async () => {
    const originalResponse = makeMockBriefResponse();
    mockOpenAIJsonResponse('content-brief', originalResponse);
    const originalBrief = await generateBrief(TEST_WS_ID, 'prompt check', {});
    resetOpenAIMocks();

    mockOpenAIJsonResponse('content-brief-regenerate', makeMockBriefResponse());

    await regenerateBrief(
      TEST_WS_ID,
      originalBrief,
      'Add more technical depth and case studies.',
    );

    const calls = getCapturedOpenAICalls();
    const regenCall = calls.find(c => c.feature === 'content-brief-regenerate');
    expect(regenCall).toBeDefined();
    const promptContent = (regenCall!.messages.find(m => m.role === 'user') ?? regenCall!.messages[0]).content;
    expect(promptContent).toContain('PREVIOUS BRIEF');
    expect(promptContent).toContain('USER FEEDBACK');
    expect(promptContent).toContain('Add more technical depth and case studies.');
    expect(promptContent).toContain(originalBrief.suggestedTitle);
  });

  it('preserves inherited fields from the original brief', async () => {
    const originalResponse = makeMockBriefResponse();
    mockOpenAIJsonResponse('content-brief', originalResponse);
    const originalBrief = await generateBrief(TEST_WS_ID, 'inherit test', {
      pageType: 'service',
      referenceUrls: ['https://reference.com/guide'],
      keywordLocked: true,
      keywordSource: 'matrix',
      templateId: 'tmpl-456',
    });
    resetOpenAIMocks();

    mockOpenAIJsonResponse('content-brief-regenerate', makeMockBriefResponse());

    const newBrief = await regenerateBrief(
      TEST_WS_ID,
      originalBrief,
      'Minor tone adjustments.',
    );

    // These fields should be preserved from the original
    expect(newBrief.pageType).toBe('service');
    expect(newBrief.referenceUrls).toEqual(['https://reference.com/guide']);
    expect(newBrief.keywordLocked).toBe(true);
    expect(newBrief.keywordSource).toBe('matrix');
    expect(newBrief.templateId).toBe('tmpl-456');
  });

  it('throws when AI call fails during regeneration', async () => {
    const originalResponse = makeMockBriefResponse();
    mockOpenAIJsonResponse('content-brief', originalResponse);
    const originalBrief = await generateBrief(TEST_WS_ID, 'regen fail test', {});
    resetOpenAIMocks();

    mockOpenAIError('content-brief-regenerate', 'Service unavailable');

    await expect(
      regenerateBrief(TEST_WS_ID, originalBrief, 'Make it better.'),
    ).rejects.toThrow('Service unavailable');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. regenerateOutline — outline-only regeneration
// ═══════════════════════════════════════════════════════════════════════════════

describe('regenerateOutline — outline-only regeneration', () => {
  let existingBriefId: string;

  beforeAll(async () => {
    resetOpenAIMocks();
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());
    const brief = await generateBrief(TEST_WS_ID, 'outline regen base', {});
    existingBriefId = brief.id;
    resetOpenAIMocks();
  });

  it('regenerates only the outline while preserving other brief fields', async () => {
    const original = getBrief(TEST_WS_ID, existingBriefId);
    expect(original).toBeDefined();

    const newOutline = [
      {
        heading: 'Completely New Section 1',
        subheadings: ['New Sub A', 'New Sub B'],
        notes: 'Fresh approach to the topic.',
        wordCount: 400,
        keywords: ['new keyword'],
      },
      {
        heading: 'Completely New Section 2',
        subheadings: ['Sub C', 'Sub D'],
        notes: 'Different angle on the topic.',
        wordCount: 400,
        keywords: ['another keyword'],
      },
    ];

    mockOpenAIJsonResponse('content-brief-outline-regen', newOutline);

    const updated = await regenerateOutline(TEST_WS_ID, existingBriefId);

    expect(updated).not.toBeNull();
    // Outline should be updated
    expect(updated!.outline.length).toBe(2);
    expect(updated!.outline[0].heading).toBe('Completely New Section 1');
    expect(updated!.outline[1].heading).toBe('Completely New Section 2');

    // Other fields should be preserved
    expect(updated!.suggestedTitle).toBe(original!.suggestedTitle);
    expect(updated!.targetKeyword).toBe(original!.targetKeyword);
    expect(updated!.executiveSummary).toBe(original!.executiveSummary);
    expect(updated!.intent).toBe(original!.intent);
    expect(updated!.id).toBe(existingBriefId); // Same brief, just updated outline
  });

  it('includes feedback in the outline regeneration prompt when provided', async () => {
    const newOutline = [
      { heading: 'Feedback-informed section', subheadings: ['Sub 1'], notes: 'Addressing feedback.', wordCount: 300, keywords: ['test'] },
    ];
    mockOpenAIJsonResponse('content-brief-outline-regen', newOutline);

    await regenerateOutline(TEST_WS_ID, existingBriefId, 'Add more how-to sections.');

    const calls = getCapturedOpenAICalls();
    const outlineCall = calls.find(c => c.feature === 'content-brief-outline-regen');
    expect(outlineCall).toBeDefined();
    const promptContent = (outlineCall!.messages.find(m => m.role === 'user') ?? outlineCall!.messages[0]).content;
    expect(promptContent).toContain('Add more how-to sections.');
    expect(promptContent).toContain('addresses the feedback');
  });

  it('handles { outline: [...] } wrapper from AI response', async () => {
    // Some AI responses wrap the array in an object
    const wrappedResponse = {
      outline: [
        { heading: 'Wrapped Section', subheadings: ['Sub'], notes: 'From wrapper.', wordCount: 250, keywords: ['test'] },
      ],
    };
    mockOpenAIJsonResponse('content-brief-outline-regen', wrappedResponse);

    const updated = await regenerateOutline(TEST_WS_ID, existingBriefId);
    expect(updated).not.toBeNull();
    expect(updated!.outline.length).toBeGreaterThan(0);
    expect(updated!.outline[0].heading).toBe('Wrapped Section');
  });

  it('returns null for a non-existent brief', async () => {
    const result = await regenerateOutline(TEST_WS_ID, 'nonexistent-brief-id');
    expect(result).toBeNull();
  });

  it('throws when AI returns empty outline', async () => {
    mockOpenAIJsonResponse('content-brief-outline-regen', []);

    await expect(
      regenerateOutline(TEST_WS_ID, existingBriefId),
    ).rejects.toThrow('Failed to parse regenerated outline');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Analytics intelligence integration
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateBrief — analytics intelligence integration', () => {
  it('injects analytics intelligence into the prompt when insights exist', async () => {
    const insightsMock = getInsights as ReturnType<typeof vi.fn>;
    insightsMock.mockReturnValueOnce([
      {
        id: 'ins-1',
        workspaceId: TEST_WS_ID,
        insightType: 'cannibalization',
        data: {
          query: 'seo with analytics',
          pages: ['https://test.com/blog/seo', 'https://test.com/services/seo'],
          positions: [5, 12],
        },
        title: 'Cannibalization',
        severity: 'warning',
        status: 'active',
        score: 70,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    await generateBrief(TEST_WS_ID, 'seo with analytics', {});

    const calls = getCapturedOpenAICalls();
    const briefCall = calls.find(c => c.feature === 'content-brief');
    const promptContent = (briefCall!.messages.find(m => m.role === 'user') ?? briefCall!.messages[0]).content;
    expect(promptContent).toContain('CANNIBALIZATION');
    expect(promptContent).toContain('consider updating');
  });

  it('skips intelligence block when no insights are available', async () => {
    const insightsMock = getInsights as ReturnType<typeof vi.fn>;
    insightsMock.mockReturnValueOnce([]);

    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    await generateBrief(TEST_WS_ID, 'no analytics keyword', {});

    const calls = getCapturedOpenAICalls();
    const briefCall = calls.find(c => c.feature === 'content-brief');
    const promptContent = (briefCall!.messages.find(m => m.role === 'user') ?? briefCall!.messages[0]).content;
    expect(promptContent).not.toContain('ANALYTICS INTELLIGENCE');
  });

  it('gracefully handles intelligence layer errors', async () => {
    const insightsMock = getInsights as ReturnType<typeof vi.fn>;
    insightsMock.mockImplementationOnce(() => {
      throw new Error('Intelligence layer not ready');
    });

    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    // Should not throw — the try/catch inside generateBrief handles this
    const brief = await generateBrief(TEST_WS_ID, 'intel error keyword', {});
    expect(brief).toBeDefined();
    expect(brief.suggestedTitle).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Page type configurations in generation
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateBrief — page type-specific generation', () => {
  const pageTypes = ['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource'] as const;

  for (const pageType of pageTypes) {
    it(`injects ${pageType}-specific instructions into the prompt`, async () => {
      const cfg = getPageTypeConfig(pageType);
      const response = makeMockBriefResponse({ wordCountTarget: cfg.wordCountTarget });
      mockOpenAIJsonResponse('content-brief', response);

      const brief = await generateBrief(TEST_WS_ID, `${pageType} test keyword`, {
        pageType,
      });

      expect(brief.pageType).toBe(pageType);

      const calls = getCapturedOpenAICalls();
      const briefCall = calls.find(c => c.feature === 'content-brief');
      const promptContent = (briefCall!.messages.find(m => m.role === 'user') ?? briefCall!.messages[0]).content;
      expect(promptContent).toContain(`PAGE TYPE:`);
      expect(promptContent).toContain('CONTENT STYLE:');

      resetOpenAIMocks();
    });
  }

  it('defaults to blog configuration when no page type is specified', async () => {
    mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());

    const brief = await generateBrief(TEST_WS_ID, 'default type keyword', {});

    // No explicit pageType provided — should not have PAGE TYPE block
    // but config defaults to blog internally
    expect(brief.pageType).toBeUndefined();
  });
});
