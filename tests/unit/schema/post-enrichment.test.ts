/**
 * Unit tests for applyPostEnrichment — verifies that FAQPage nodes are appended
 * from semantics.faq when no Cheerio-extracted FAQ is present, and that we don't
 * double-append when extractFaq already added one.
 *
 * The test exercises applyPostEnrichment indirectly through generateLeanSchema,
 * which is the public entry point. All AI calls and DB I/O are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../server/anthropic-helpers.js', () => ({
  callAnthropicWithTools: vi.fn(),
}));

vi.mock('../../../server/schema/extractors/faq.js', () => ({
  extractFaq: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../server/schema/extractors/description.js', () => ({
  extractDescription: vi.fn().mockResolvedValue('Test page description'),
}));

vi.mock('../../../server/page-elements-store.js', () => ({
  getPageElements: vi.fn().mockReturnValue(null),
  upsertPageElements: vi.fn(),
}));

// Also mock the schema-org validator (fire-and-forget in generateLeanSchema)
vi.mock('../../../server/schema/schema-org-validator.js', () => ({
  validateWithSchemaOrg: vi.fn().mockResolvedValue({ status: 'schema_org_validated', issues: [] }),
}));

// Mock callAI used by extractDescription (already mocked above, but description is mocked entirely)
vi.mock('../../../server/ai.js', () => ({
  callAI: vi.fn().mockResolvedValue({
    text: 'Test page description.',
    tokens: { prompt: 100, completion: 20, total: 120 },
  }),
}));

import { callAnthropicWithTools } from '../../../server/anthropic-helpers.js';
import { extractFaq } from '../../../server/schema/extractors/faq.js';
import { generateLeanSchema } from '../../../server/schema/generator.js';

const SEMANTIC_TOOL_RESPONSE = {
  toolInput: {
    faq: [
      { question: 'What is your price?', answer: 'From $99.' },
      { question: 'Do you accept insurance?', answer: 'Yes, most major plans.' },
    ],
    aggregateRating: { ratingValue: 4.8, reviewCount: 500 },
    sameAs: ['https://facebook.com/example'],
  },
  promptTokens: 200,
  completionTokens: 100,
};

const BASE_INPUT = {
  pageId: 'page-test',
  pageMeta: {
    slug: 'test-page',
    title: 'Test Page',
    publishedPath: '/test-page',
    sourcePublishedAt: null,
  },
  html: '<html><body><main><h1>Test Page</h1><p>Content here</p></main></body></html>',
  baseUrl: 'https://example.com',
  workspace: {
    id: 'ws-1',
    name: 'Example Business',
    businessProfile: null,
    publisherLogoUrl: null,
    defaultLocale: 'en',
    siteHasSearch: false,
  },
};

describe('applyPostEnrichment — FAQPage from semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: Haiku returns semantics with 2 FAQ pairs
    vi.mocked(callAnthropicWithTools).mockResolvedValue(SEMANTIC_TOOL_RESPONSE);
    // Default: no Cheerio-accordion FAQ
    vi.mocked(extractFaq).mockResolvedValue([]);
  });

  it('appends FAQPage node from semantics.faq when no Cheerio FAQ present', async () => {
    const output = await generateLeanSchema(BASE_INPUT);
    const graph = output.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    const faqNodes = graph.filter(n => n['@type'] === 'FAQPage');
    expect(faqNodes).toHaveLength(1);
    const mainEntity = faqNodes[0].mainEntity as unknown[];
    expect(mainEntity).toHaveLength(2);
  });

  it('does NOT double-append FAQPage when extractFaq already added one', async () => {
    // Override: Cheerio finds 2 FAQ pairs from accordion markup
    vi.mocked(extractFaq).mockResolvedValue([
      { question: 'Q1 from cheerio', answer: 'A1' },
      { question: 'Q2 from cheerio', answer: 'A2' },
    ]);

    const output = await generateLeanSchema(BASE_INPUT);
    const graph = output.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    const faqNodes = graph.filter(n => n['@type'] === 'FAQPage');
    // Only one FAQPage — the one from extractFaq; semantics path is guarded by hasFaqPage check
    expect(faqNodes).toHaveLength(1);
  });
});
