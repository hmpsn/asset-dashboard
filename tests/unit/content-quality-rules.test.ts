/**
 * Unit tests for CREATIVE_WRITING_RULES enforcement in AI content generation prompts.
 *
 * Strategy: mock callOpenAI / callAnthropic and isAnthropicConfigured so we can
 * capture the exact prompts passed to each generation function, then assert that
 * quality-rule text is present and that page-type-specific instructions vary as expected.
 *
 * Pure helpers (buildBriefContextBlock, countWords, stripHtml) are tested directly
 * without any mocking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContentBrief } from '../../shared/types/content.ts';
import { CREATIVE_WRITING_RULES, PROSE_QUALITY_RULES } from '../../server/writing-quality.js';

// ── Mocks must be declared before any import that transitively loads these modules ──

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// Anthropic toggled OFF — forces all generation through the capturable callOpenAI mock
vi.mock('../../server/anthropic-helpers.js', () => ({
  callAnthropic: vi.fn(),
  isAnthropicConfigured: vi.fn().mockReturnValue(false),
}));

// Capture every prompt that reaches OpenAI
const capturedMessages: Array<{ role: string; content: string }[]> = [];
vi.mock('../../server/openai-helpers.js', () => ({
  callOpenAI: vi.fn().mockImplementation(
    (opts: { messages: Array<{ role: string; content: string }> }) => {
      capturedMessages.push(opts.messages);
      return Promise.resolve({ text: '<p>Generated content.</p>' });
    },
  ),
}));

// workspace-intelligence not needed for prompt-construction tests
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn().mockResolvedValue({
    seoContext: {
      brandVoiceBlock: '',
      businessContext: '',
      personasBlock: '',
      knowledgeBlock: '',
      keywordBlock: '',
      fullContext: '',
      strategy: undefined,
      pageMap: undefined,
    },
    learnings: [],
  }),
  formatForPrompt: vi.fn().mockReturnValue(''),
  formatPageMapForPrompt: vi.fn().mockReturnValue(''),
}));

import {
  generateIntroduction,
  generateSection,
  generateConclusion,
  buildBriefContextBlock,
  countWords,
  stripHtml,
} from '../../server/content-posts-ai.js';

// ── Shared test fixtures ──

function makeBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    id: 'brief_test',
    workspaceId: 'ws_test',
    targetKeyword: 'dental SEO',
    secondaryKeywords: ['local SEO', 'dentist marketing', 'patient acquisition'],
    suggestedTitle: 'How to Grow Your Dental Practice with SEO',
    suggestedMetaDesc: 'Learn the top SEO strategies for dental practices.',
    outline: [
      { heading: 'Why Dental SEO Matters', notes: 'Cover local search importance', wordCount: 300, keywords: ['local SEO'] },
      { heading: 'On-Page Optimization Tips', notes: 'Title tags, meta, headings', wordCount: 350, keywords: ['dental SEO'] },
    ],
    wordCountTarget: 1800,
    intent: 'informational',
    audience: 'Dental practice owners',
    competitorInsights: 'Top competitors focus on local keywords.',
    internalLinkSuggestions: [],
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Extract the full prompt text from all captured messages for a single call. */
function lastPrompt(): string {
  const last = capturedMessages[capturedMessages.length - 1];
  return last.map(m => m.content).join('\n');
}

// ── CREATIVE_WRITING_RULES presence ──

describe('CREATIVE_WRITING_RULES injection — generateIntroduction', () => {
  beforeEach(() => {
    capturedMessages.length = 0;
  });

  it('includes quality rules block in the prompt', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('CREATIVE WRITING RULES');
    expect(prompt).toContain(CREATIVE_WRITING_RULES.trim());
  });

  it('does not duplicate PROSE_QUALITY_RULES from buildSystemPrompt', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).not.toContain(PROSE_QUALITY_RULES.trim());
  });

  it('includes high-signal AI cliche guidance', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('HIGH-SIGNAL AI CLICHES TO AVOID');
  });

  it('includes FACTUAL SAFETY section', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('FACTUAL SAFETY');
  });

  it('includes OUTPUT DISCIPLINE section', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('OUTPUT DISCIPLINE');
  });

  it('explicitly bans "Did you know" opener', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('Did you know');
  });

  it('explicitly bans "In today\'s" opener', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain("In today's");
  });

  it('explicitly bans "Let\'s dive in" filler', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain("Let's dive in");
  });

  it('explicitly bans hollow intensifiers like "incredibly"', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('incredibly');
  });

  it('explicitly bans corporate buzzwords like "leverage"', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('leverage');
  });

  it('explicitly bans fabricating statistics', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('NEVER invent statistics');
  });

  it('includes the target keyword in the prompt', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('dental SEO');
  });
});

describe('CREATIVE_WRITING_RULES injection — generateSection', () => {
  beforeEach(() => {
    capturedMessages.length = 0;
  });

  it('includes quality rules block in the section prompt', async () => {
    const brief = makeBrief();
    await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('CREATIVE WRITING RULES');
  });

  it('does not duplicate PROSE_QUALITY_RULES in the section prompt', async () => {
    const brief = makeBrief();
    await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).not.toContain(PROSE_QUALITY_RULES.trim());
  });

  it('includes FACTUAL SAFETY in the section prompt', async () => {
    const brief = makeBrief();
    await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('FACTUAL SAFETY');
  });

  it('includes provenance-sensitive topic guidance in the section prompt', async () => {
    const brief = makeBrief();
    await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('provenance-sensitive topics');
  });

  it('includes the section heading in the prompt', async () => {
    const brief = makeBrief();
    await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('Why Dental SEO Matters');
  });

  it('includes continuity note when previous sections are provided', async () => {
    const brief = makeBrief();
    await generateSection(
      brief,
      brief.outline[1],
      1,
      ['<p>Prior section content here.</p>'],
      '',
      'ws_test',
    );
    const prompt = lastPrompt();
    expect(prompt).toContain('PREVIOUS SECTIONS WRITTEN');
    expect(prompt).toContain('do NOT repeat these points');
  });

  it('does not include continuity block when no previous sections', async () => {
    const brief = makeBrief();
    await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).not.toContain('PREVIOUS SECTIONS WRITTEN');
  });

  it.each(['landing', 'service', 'location', 'product'] as const)(
    'does not force article-style H3s into a short %s conversion section',
    async pageType => {
      const brief = makeBrief({
        pageType,
        wordCountTarget: 900,
        outline: [{
          heading: 'A focused buyer answer',
          notes: 'Answer one buyer concern directly.',
          wordCount: 160,
          subheadings: [],
          keywords: [],
        }],
      });
      await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
      const prompt = lastPrompt();

      expect(prompt).toContain('SHORT CONVERSION SECTION');
      expect(prompt).toContain('Do not add H3 subheadings unless the supplied brief names a distinct subtopic');
      expect(prompt).not.toContain('Create 2-3 H3 subheadings');
      expect(prompt).not.toContain('ALWAYS use <h3>');
      expect(prompt).not.toContain('include at least 2 <h3>');
    },
  );

  it('keeps H3s optional for a deep blog section unless they improve scanning', async () => {
    const brief = makeBrief({
      pageType: 'blog',
      outline: [{
        heading: 'A deep educational answer',
        notes: 'Teach one concept with enough depth to be useful.',
        wordCount: 350,
        subheadings: [],
        keywords: [],
      }],
    });
    await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();

    expect(prompt).toContain('DEEP EDUCATIONAL SECTION');
    expect(prompt).toContain('H3 subheadings are optional');
    expect(prompt).not.toContain('ALWAYS use <h3>');
  });
});

describe('CREATIVE_WRITING_RULES injection — generateConclusion', () => {
  beforeEach(() => {
    capturedMessages.length = 0;
  });

  it('includes quality rules block in the conclusion prompt', async () => {
    await generateConclusion(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('CREATIVE WRITING RULES');
  });

  it('does not duplicate PROSE_QUALITY_RULES in the conclusion prompt', async () => {
    await generateConclusion(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).not.toContain(PROSE_QUALITY_RULES.trim());
  });

  it('includes FACTUAL SAFETY in the conclusion prompt', async () => {
    await generateConclusion(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('FACTUAL SAFETY');
  });

  it('bans "Conclusion" as a section heading', async () => {
    await generateConclusion(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    // The conclusion instructions specifically ban using "Conclusion" as the heading
    expect(prompt).toContain('do NOT use "Conclusion" as the heading');
  });

  it('bans "Ready to" rhetorical question headings', async () => {
    await generateConclusion(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('Do NOT use "Ready to..."');
  });
});

// ── Page-type-specific writer roles ──

describe('page-type-specific prompt variation', () => {
  beforeEach(() => {
    capturedMessages.length = 0;
  });

  it('uses landing-page-specific writer role for landing page type', async () => {
    await generateIntroduction(makeBrief({ pageType: 'landing' }), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('conversion copywriter');
  });

  it('uses blog-specific writer role for blog page type', async () => {
    await generateIntroduction(makeBrief({ pageType: 'blog' }), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('SEO content writer');
  });

  it('uses service-specific writer role for service page type', async () => {
    await generateIntroduction(makeBrief({ pageType: 'service' }), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('service-industry copywriter');
  });

  it('adds the brand context priority hierarchy to creative prompts', async () => {
    await generateIntroduction(makeBrief({ pageType: 'service' }), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('BRAND CONTEXT PRIORITY');
    expect(prompt).toContain('Page type, conversion goal, and word budget outrank style preferences');
    expect(prompt).toContain('do not expand the page because more brand context is available');
  });

  it('adds the service page density contract to service prompts', async () => {
    await generateSection(makeBrief({ pageType: 'service' }), makeBrief().outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('PAGE-TYPE COPY CONTRACT (service)');
    expect(prompt).toContain('Conversion-dense service page, not a long educational article');
    expect(prompt).toContain('Do not add duplicate booking/discovery sections');
  });

  it('uses product-specific writer role for product page type', async () => {
    await generateIntroduction(makeBrief({ pageType: 'product' }), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('product copywriter');
  });

  it('uses location-specific writer role for location page type', async () => {
    await generateIntroduction(makeBrief({ pageType: 'location' }), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('local SEO copywriter');
  });

  it('adds the location public-copy contract and blocks SEO mechanics', async () => {
    await generateConclusion(makeBrief({ pageType: 'location' }), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('PAGE-TYPE COPY CONTRACT (location)');
    expect(prompt).toContain('do not teach local SEO mechanics to the reader');
    expect(prompt).toContain('Never mention NAP consistency');
  });

  it('uses pillar-specific writer role for pillar page type', async () => {
    await generateIntroduction(makeBrief({ pageType: 'pillar' }), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('authority content strategist');
  });

  it('uses resource-specific writer role for resource page type', async () => {
    await generateIntroduction(makeBrief({ pageType: 'resource' }), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('educational content writer');
  });

  it('writer roles differ across page types', async () => {
    const roles: string[] = [];

    for (const pageType of ['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource'] as const) {
      capturedMessages.length = 0;
      await generateIntroduction(makeBrief({ pageType }), '', 'ws_test');
      roles.push(lastPrompt());
    }

    expect(roles.length).toBeGreaterThan(0);
    // Each page type should produce a distinct prompt (no two are identical)
    const uniqueRoles = new Set(roles);
    expect(uniqueRoles.size).toBe(roles.length);
  });

  it('blog intro instructs not to end with "Let\'s"', async () => {
    await generateIntroduction(makeBrief({ pageType: 'blog' }), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain("Let's");
  });

  it('landing intro focuses on value proposition and pain point', async () => {
    await generateIntroduction(makeBrief({ pageType: 'landing' }), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('value proposition');
    expect(prompt).toContain('pain point');
  });

  it('location intro requires local reference in first 50 words', async () => {
    await generateIntroduction(makeBrief({ pageType: 'location' }), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('50 words');
  });

  it('section instructions differ across page types', async () => {
    const sectionPrompts: string[] = [];

    for (const pageType of ['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource'] as const) {
      capturedMessages.length = 0;
      const brief = makeBrief({ pageType });
      await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
      sectionPrompts.push(lastPrompt());
    }

    expect(sectionPrompts.length).toBeGreaterThan(0);
    const unique = new Set(sectionPrompts);
    expect(unique.size).toBe(sectionPrompts.length);
  });

  it.each(['blog', 'landing', 'service', 'location', 'product'] as const)(
    'conditions factual specifics on supplied authoritative evidence for %s copy',
    async pageType => {
      const brief = makeBrief({ pageType });
      await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
      const prompt = lastPrompt();

      expect(prompt).toContain('FACTUAL SPECIFICS AUTHORITY');
      expect(prompt).toContain('human-approved business, brand, or evidence context');
      expect(prompt).toContain('explicitly labeled verified provider, analytics, or source evidence');
      expect(prompt).toContain('raw SERP or competitor copy');
      expect(prompt).not.toContain('provided in the brief, knowledge base, source pack, or live SERP context');
    },
  );

  it('removes unconditional proof and local-detail requests from service and location openings', async () => {
    await generateIntroduction(makeBrief({ pageType: 'service' }), '', 'ws_test');
    const servicePrompt = lastPrompt();
    expect(servicePrompt).not.toContain('years of experience, clients served, results');

    capturedMessages.length = 0;
    await generateIntroduction(makeBrief({ pageType: 'location' }), '', 'ws_test');
    const locationPrompt = lastPrompt();
    expect(locationPrompt).not.toContain('Open with a local reference (neighborhood, city landmark, or regional context)');
    expect(locationPrompt).toContain('Use a local reference only when supported by authoritative evidence');
  });

  it('does not request an unsupported product guarantee in the conclusion', async () => {
    await generateConclusion(makeBrief({ pageType: 'product' }), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).not.toContain('Add a reassurance (guarantee, support, returns)');
    expect(prompt).toContain('Mention guarantees, support, or returns only when supplied by approved context');
  });

  it('allows verified source evidence for product specifications and comparisons', async () => {
    const brief = makeBrief({ pageType: 'product' });
    await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();

    expect(prompt).toContain('comparison language only when authoritative evidence supports');
    expect(prompt).toContain('specs, measurements, or performance data only when supported by authoritative evidence');
  });
});

// ── buildBriefContextBlock — pure function, no mocks needed ──

describe('buildBriefContextBlock', () => {
  it('returns empty string when brief has no optional context fields', () => {
    // competitorInsights must be empty string so the function has nothing to add
    const result = buildBriefContextBlock(makeBrief({ competitorInsights: '' }));
    expect(result).toBe('');
  });

  it('includes executive summary when present', () => {
    const result = buildBriefContextBlock(
      makeBrief({ executiveSummary: 'Focus on local intent and conversion.' }),
    );
    expect(result).toContain('CONTENT STRATEGY CONTEXT');
    expect(result).toContain('Focus on local intent and conversion.');
  });

  it('includes people-also-ask questions when present', () => {
    const result = buildBriefContextBlock(
      makeBrief({ peopleAlsoAsk: ['How long does dental SEO take?', 'Is local SEO worth it?'] }),
    );
    expect(result).toContain('QUESTIONS TO ANSWER');
    expect(result).toContain('How long does dental SEO take?');
    expect(result).toContain('Is local SEO worth it?');
  });

  it('numbers each PAA question sequentially', () => {
    const result = buildBriefContextBlock(
      makeBrief({ peopleAlsoAsk: ['Q1?', 'Q2?', 'Q3?'] }),
    );
    expect(result).toContain('1. Q1?');
    expect(result).toContain('2. Q2?');
    expect(result).toContain('3. Q3?');
  });

  it('includes observed SERP evidence from stored real PAA and top results', () => {
    const result = buildBriefContextBlock(
      makeBrief({
        realPeopleAlsoAsk: ['Which CRM is best for a small team?'],
        realTopResults: [{ position: 1, title: 'Best CRM 2026', url: 'https://example.com/crm' }],
      }),
    );
    expect(result).toContain('OBSERVED PEOPLE ALSO ASK QUESTIONS');
    expect(result).toContain('Which CRM is best for a small team?');
    expect(result).toContain('OBSERVED TOP SEARCH RESULTS');
    expect(result).toContain('1. Best CRM 2026 — https://example.com/crm');
  });

  it('includes topical entities when present', () => {
    const result = buildBriefContextBlock(
      makeBrief({ topicalEntities: ['Google Business Profile', 'local citations', 'NAP consistency'] }),
    );
    expect(result).toContain('TOPICAL ENTITIES TO MENTION');
    expect(result).toContain('Google Business Profile');
    expect(result).toContain('NAP consistency');
  });

  it('includes SERP analysis with content type and word count', () => {
    const result = buildBriefContextBlock(
      makeBrief({
        serpAnalysis: {
          contentType: 'listicle',
          avgWordCount: 1500,
          commonElements: ['how-to steps', 'FAQ'],
          gaps: ['pricing comparison', 'timeline expectations'],
        },
      }),
    );
    expect(result).toContain('SERP COMPETITIVE LANDSCAPE');
    expect(result).toContain('listicle');
    expect(result).toContain('1500');
    expect(result).toContain('how-to steps');
    expect(result).toContain('GAPS TO EXPLOIT');
    expect(result).toContain('pricing comparison');
  });

  it('includes SERP analysis even when gaps array is empty', () => {
    const result = buildBriefContextBlock(
      makeBrief({
        serpAnalysis: { contentType: 'guide', avgWordCount: 2000, commonElements: [], gaps: [] },
      }),
    );
    expect(result).toContain('SERP COMPETITIVE LANDSCAPE');
    expect(result).toContain('guide');
    expect(result).not.toContain('GAPS TO EXPLOIT');
  });

  it('includes competitor insights when present', () => {
    const result = buildBriefContextBlock(
      makeBrief({ competitorInsights: 'Competitors lack case studies and pricing.' }),
    );
    expect(result).toContain('COMPETITOR INSIGHTS');
    expect(result).toContain('Competitors lack case studies and pricing.');
  });

  it('formats internal link suggestions without domain', () => {
    const result = buildBriefContextBlock(
      makeBrief({ internalLinkSuggestions: ['/services/dental-seo', '/blog/local-seo'] }),
    );
    expect(result).toContain('INTERNAL LINKS TO INCLUDE');
    expect(result).toContain('/services/dental-seo');
    expect(result).toContain('/blog/local-seo');
  });

  it('prepends domain to internal link suggestions when siteDomain provided', () => {
    const result = buildBriefContextBlock(
      makeBrief({ internalLinkSuggestions: ['/services/dental-seo'] }),
      'example.com',
    );
    expect(result).toContain('https://example.com/services/dental-seo');
    expect(result).toContain('All internal links MUST use the domain https://example.com');
  });

  it('does not double-prefix a protocol already stored on the site domain', () => {
    const result = buildBriefContextBlock(
      makeBrief({ internalLinkSuggestions: ['/services/dental-seo'] }),
      'https://example.com/',
    );
    expect(result).toContain('https://example.com/services/dental-seo');
    expect(result).not.toContain('https://https://');
  });

  it('adds leading slash to internal link suggestions that lack one', () => {
    const result = buildBriefContextBlock(
      makeBrief({ internalLinkSuggestions: ['services/dental-seo'] }),
    );
    expect(result).toContain('/services/dental-seo');
  });

  it('includes E-E-A-T guidance when present', () => {
    const result = buildBriefContextBlock(
      makeBrief({
        eeatGuidance: {
          experience: '10+ years treating patients',
          expertise: 'Board-certified dental professionals',
          authority: 'Featured in Dental Today',
          trust: 'HIPAA-compliant processes',
        },
      }),
    );
    expect(result).toContain('E-E-A-T SIGNALS');
    expect(result).toContain('10+ years treating patients');
    expect(result).toContain('Board-certified dental professionals');
    expect(result).toContain('Featured in Dental Today');
    expect(result).toContain('HIPAA-compliant processes');
  });

  it('returns non-empty when multiple optional fields are provided', () => {
    const result = buildBriefContextBlock(
      makeBrief({
        executiveSummary: 'Focus on conversions.',
        peopleAlsoAsk: ['How much does dental SEO cost?'],
        topicalEntities: ['Google Business Profile'],
      }),
    );
    expect(result.trim().length).toBeGreaterThan(0);
  });
});

// ── Quality rule categories in prompts ──

describe('quality rule categories are individually addressable in prompts', () => {
  beforeEach(() => {
    capturedMessages.length = 0;
  });

  it('readability guidance (vary rhythm naturally) is present', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('Vary rhythm naturally');
  });

  it('specificity guidance is present', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('concrete examples');
  });

  it('brand voice guidance (knowledgeable colleague) is present', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('knowledgeable colleague');
  });

  it('formatting guidance (paragraph/list variation) is present', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('vary paragraph/list structure');
  });

  it('depth-over-breadth guidance is present', async () => {
    await generateSection(makeBrief(), makeBrief().outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('one strong idea developed well');
  });

  it('thin-evidence fallback instruction is present', async () => {
    await generateSection(makeBrief(), makeBrief().outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('If source evidence is thin');
  });

  it('anchor text accuracy rule is present', async () => {
    await generateSection(makeBrief(), makeBrief().outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('ANCHOR TEXT ACCURACY');
  });

  it('output format discipline is present', async () => {
    await generateConclusion(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('Follow the requested output format exactly');
  });

  it('repetition control remains present', async () => {
    await generateSection(makeBrief(), makeBrief().outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('Do not repeat the same example');
  });
});

// ── Pure utility helpers ──

describe('countWords', () => {
  it('counts words in plain text', () => {
    expect(countWords('hello world foo')).toBe(3);
  });

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   ')).toBe(0);
  });

  it('handles multiple spaces between words', () => {
    expect(countWords('one  two   three')).toBe(3);
  });

  it('counts words in HTML-tagged text', () => {
    // Tags are counted as tokens since countWords is called after stripHtml in practice
    const raw = '<p>Hello world</p>';
    const count = countWords(raw);
    // The function splits on whitespace; <p>Hello counts as one token
    expect(count).toBeGreaterThan(0);
  });
});

describe('stripHtml', () => {
  it('removes simple HTML tags', () => {
    expect(stripHtml('<p>Hello world</p>')).toBe('Hello world');
  });

  it('removes nested tags', () => {
    expect(stripHtml('<h2><strong>Title</strong></h2>')).toBe('Title');
  });

  it('collapses multiple spaces after tag removal', () => {
    const result = stripHtml('<p>Foo</p>  <p>Bar</p>');
    expect(result).toBe('Foo Bar');
  });

  it('returns empty string for tag-only input', () => {
    expect(stripHtml('<br /><hr />')).toBe('');
  });

  it('handles attributes in tags', () => {
    expect(stripHtml('<a href="https://example.com" class="link">Click here</a>')).toBe('Click here');
  });

  it('preserves plain text unchanged', () => {
    expect(stripHtml('No tags here')).toBe('No tags here');
  });

  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });
});
