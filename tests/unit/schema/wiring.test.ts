/**
 * Unit tests for wiring fixes introduced in the schema-suggester overhaul:
 *   1. pageKindOverride bypasses classifyPage() and forces a specific template
 *   2. industrySubtype escalates @type (e.g. "medical" → "MedicalOrganization")
 *   3. Per-location @id uses the page path so multi-location sites don't collide
 *   4. All templates emit a WebPage node (even homepage)
 *
 * These are pure unit tests — no server, no createTestContext.
 * All DB and AI calls are mocked so the tests run offline.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../server/anthropic-helpers.js', () => ({
  callAnthropicWithTools: vi.fn().mockResolvedValue({ toolInput: {}, promptTokens: 0, completionTokens: 0 }),
  isAnthropicConfigured: vi.fn(() => false),
}));

vi.mock('../../../server/schema/extractors/faq.js', () => ({
  extractFaq: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../server/schema/extractors/description.js', () => ({
  extractDescription: vi.fn().mockResolvedValue('Test description.'),
}));

vi.mock('../../../server/page-elements-store.js', () => ({
  getPageElements: vi.fn().mockReturnValue(null),
  upsertPageElements: vi.fn(),
}));

vi.mock('../../../server/schema/schema-org-validator.js', () => ({
  validateWithSchemaOrg: vi.fn().mockResolvedValue({ status: 'schema_org_validated', issues: [] }),
}));

vi.mock('../../../server/ai.js', () => ({
  callAI: vi.fn().mockResolvedValue({
    text: 'Test description.',
    tokens: { prompt: 50, completion: 10, total: 60 },
  }),
}));

import { generateLeanSchema } from '../../../server/schema/generator.js';

const BASE_URL = 'https://example.com';

const minimalWorkspace = {
  id: 'ws-test',
  name: 'Test Co',
  publisherLogoUrl: null,
  businessProfile: null,
  defaultLocale: 'en' as const,
  siteKeywordsForKnowsAbout: [],
  siteHasSearch: false,
};

const minimalHtml = `<html><head><title>Test</title></head><body><p>Content</p></body></html>`;

function makeInput(publishedPath: string, overrides: Record<string, unknown> = {}) {
  return {
    pageId: 'page-test',
    pageMeta: {
      slug: publishedPath.replace(/^\//, '') || 'home',
      title: 'Test Page',
      publishedPath,
      sourcePublishedAt: null,
    },
    html: minimalHtml,
    baseUrl: BASE_URL,
    workspace: minimalWorkspace,
    ...overrides,
  };
}

function getGraph(output: Awaited<ReturnType<typeof generateLeanSchema>>): Array<Record<string, unknown>> {
  return output.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Group 1: pageKindOverride
// ---------------------------------------------------------------------------
describe('pageKindOverride', () => {
  it('maps plan roles that should suppress URL auto-detection to WebPage', async () => {
    const { SCHEMA_ROLE_TO_PAGE_KIND } = await import('../../../server/schema-suggester.js');
    expect(SCHEMA_ROLE_TO_PAGE_KIND.pillar).toBe('WebPage');
    expect(SCHEMA_ROLE_TO_PAGE_KIND.audience).toBe('WebPage');
    expect(SCHEMA_ROLE_TO_PAGE_KIND['lead-gen']).toBe('WebPage');
    expect(SCHEMA_ROLE_TO_PAGE_KIND.partnership).toBe('WebPage');
    expect(SCHEMA_ROLE_TO_PAGE_KIND.comparison).toBe('WebPage');
  });

  it('forces Location template when pageKindOverride is Location', async () => {
    const output = await generateLeanSchema(makeInput('/location/downtown', { pageKindOverride: 'Location' }));
    const graph = getGraph(output);
    const hasLocalBusiness = graph.some(n => n['@type'] === 'LocalBusiness');
    expect(hasLocalBusiness).toBe(true);
  });

  it('auto-detects BlogPosting when no override', async () => {
    const output = await generateLeanSchema(makeInput('/blog/my-post'));
    const graph = getGraph(output);
    const hasBlogPosting = graph.some(n => n['@type'] === 'BlogPosting');
    expect(hasBlogPosting).toBe(true);
  });

  it('override wins over URL pattern — Location on /blog/ path', async () => {
    const output = await generateLeanSchema(makeInput('/blog/not-a-post', { pageKindOverride: 'Location' }));
    const graph = getGraph(output);
    const hasLocalBusiness = graph.some(n => n['@type'] === 'LocalBusiness');
    const hasBlogPosting = graph.some(n => n['@type'] === 'BlogPosting');
    expect(hasLocalBusiness).toBe(true);
    expect(hasBlogPosting).toBe(false);
  });

  it('generic override wins over URL pattern and forces WebPage on /blog/ path', async () => {
    const output = await generateLeanSchema(makeInput('/blog/thank-you', { pageKindOverride: 'WebPage' }));
    const graph = getGraph(output);
    const hasWebPage = graph.some(n => n['@type'] === 'WebPage');
    const hasBlogPosting = graph.some(n => n['@type'] === 'BlogPosting');
    expect(hasWebPage).toBe(true);
    expect(hasBlogPosting).toBe(false);
  });

  it('homepage override preserves LocalBusiness primary type for local businesses', async () => {
    const output = await generateLeanSchema(
      makeInput('/', {
        pageKindOverride: 'Homepage',
        workspace: {
          ...minimalWorkspace,
          businessProfile: {
            address: { street: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
          },
        },
      }),
    );
    const graph = getGraph(output);
    const hasLocalBusiness = graph.some(n => n['@type'] === 'LocalBusiness');
    const hasOrganization = graph.some(n => n['@type'] === 'Organization');
    expect(hasLocalBusiness).toBe(true);
    expect(hasOrganization).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 2: industry subtype
// ---------------------------------------------------------------------------
describe('industry subtype', () => {
  it('emits @type MedicalOrganization when industrySubtype is medical', async () => {
    const output = await generateLeanSchema(
      makeInput('/location/downtown', {
        pageKindOverride: 'Location',
        workspace: { ...minimalWorkspace, industrySubtype: 'medical' },
      }),
    );
    const graph = getGraph(output);
    const hasMedicalOrganization = graph.some(n => n['@type'] === 'MedicalOrganization');
    expect(hasMedicalOrganization).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 3: per-location @id uniqueness
// ---------------------------------------------------------------------------
describe('per-location @id uniqueness', () => {
  it('location page @id includes page path and does not use root /#localbusiness', async () => {
    const output = await generateLeanSchema(makeInput('/location/downtown', { pageKindOverride: 'Location' }));
    const graph = getGraph(output);
    const lbNode = graph.find(n => n['@type'] === 'LocalBusiness') as Record<string, unknown> | undefined;
    expect(lbNode).toBeDefined();
    expect(lbNode!['@id']).toBe('https://example.com/location/downtown#localbusiness');
    expect(lbNode!['@id']).not.toBe('https://example.com/#localbusiness');
  });
});

// ---------------------------------------------------------------------------
// Group 4: WebPage node on homepage
// ---------------------------------------------------------------------------
describe('WebPage node on homepage', () => {
  it('homepage graph includes a WebPage node', async () => {
    const output = await generateLeanSchema(makeInput('/'));
    const graph = getGraph(output);
    const hasWebPage = graph.some(n => n['@type'] === 'WebPage');
    expect(hasWebPage).toBe(true);
  });
});
