/**
 * Unit tests for WRITING_QUALITY_RULES enforcement in AI content generation prompts.
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

// ── WRITING_QUALITY_RULES presence ──

describe('WRITING_QUALITY_RULES injection — generateIntroduction', () => {
  beforeEach(() => {
    capturedMessages.length = 0;
  });

  it('includes quality rules block in the prompt', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('WRITING QUALITY RULES');
  });

  it('includes FORBIDDEN PHRASES section', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('FORBIDDEN PHRASES');
  });

  it('includes STRUCTURAL ANTI-PATTERNS section', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('STRUCTURAL ANTI-PATTERNS');
  });

  it('includes FABRICATION RULES section', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('FABRICATION RULES');
  });

  it('includes AEO citation-worthy writing section', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('AEO');
    expect(prompt).toContain('CITATION-WORTHY WRITING');
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

describe('WRITING_QUALITY_RULES injection — generateSection', () => {
  beforeEach(() => {
    capturedMessages.length = 0;
  });

  it('includes quality rules block in the section prompt', async () => {
    const brief = makeBrief();
    await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('WRITING QUALITY RULES');
  });

  it('includes FORBIDDEN PHRASES in the section prompt', async () => {
    const brief = makeBrief();
    await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('FORBIDDEN PHRASES');
  });

  it('includes FABRICATION RULES in the section prompt', async () => {
    const brief = makeBrief();
    await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('FABRICATION RULES');
  });

  it('includes AEO section in the section prompt', async () => {
    const brief = makeBrief();
    await generateSection(brief, brief.outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('AEO');
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
});

describe('WRITING_QUALITY_RULES injection — generateConclusion', () => {
  beforeEach(() => {
    capturedMessages.length = 0;
  });

  it('includes quality rules block in the conclusion prompt', async () => {
    await generateConclusion(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('WRITING QUALITY RULES');
  });

  it('includes FORBIDDEN PHRASES in the conclusion prompt', async () => {
    await generateConclusion(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('FORBIDDEN PHRASES');
  });

  it('includes FABRICATION RULES in the conclusion prompt', async () => {
    await generateConclusion(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('FABRICATION RULES');
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

  it('readability guidance (vary sentence length) is present', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('Vary sentence length');
  });

  it('SEO guidance (active voice) is present', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('active voice');
  });

  it('brand voice guidance (knowledgeable colleague) is present', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('knowledgeable colleague');
  });

  it('formatting guidance (paragraph variation) is present', async () => {
    await generateIntroduction(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('Vary paragraph structure');
  });

  it('depth-over-breadth instruction is present', async () => {
    await generateSection(makeBrief(), makeBrief().outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('DEPTH OVER BREADTH');
  });

  it('AEO definition-block pattern instruction is present', async () => {
    await generateSection(makeBrief(), makeBrief().outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('DEFINITION BLOCKS');
  });

  it('anchor text accuracy rule is present', async () => {
    await generateSection(makeBrief(), makeBrief().outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('ANCHOR TEXT ACCURACY');
  });

  it('conclusion CTA link-count limit is present', async () => {
    await generateConclusion(makeBrief(), '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('at most ONE linked call-to-action');
  });

  it('brand mention frequency limit is present', async () => {
    await generateSection(makeBrief(), makeBrief().outline[0], 0, [], '', 'ws_test');
    const prompt = lastPrompt();
    expect(prompt).toContain('Do NOT mention the business/brand name in every section');
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
