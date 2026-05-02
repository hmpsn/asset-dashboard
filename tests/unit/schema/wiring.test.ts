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
import { getPageElements } from '../../../server/page-elements-store.js';

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

  it('does not force BlogPosting for a blog index path with a blog plan role', async () => {
    const { pageKindForRole } = await import('../../../server/schema-suggester.js');
    expect(pageKindForRole('blog', '/blog')).toBeUndefined();
    const output = await generateLeanSchema(makeInput('/blog', {
      schemaRoleOverride: { role: 'blog', source: 'site-plan' },
    }));
    const graph = getGraph(output);
    expect(graph.some(n => n['@type'] === 'BlogPosting')).toBe(false);
    expect(graph.some(n => n['@type'] === 'CollectionPage')).toBe(true);
  });

  it('lets CMS collection roles override weak plan roles but not strong plan roles', async () => {
    const { shouldCollectionRoleOverridePlan } = await import('../../../server/schema-suggester.js');
    expect(shouldCollectionRoleOverridePlan({
      isCmsItem: true,
      planRole: 'lead-gen',
      collectionRole: 'location',
      collectionRoleSource: 'inferred',
    })).toBe(true);
    expect(shouldCollectionRoleOverridePlan({
      isCmsItem: true,
      planRole: 'service',
      collectionRole: 'location',
      collectionRoleSource: 'inferred',
    })).toBe(false);
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

  it('homepage override stays Organization when no primary address is verified', async () => {
    const output = await generateLeanSchema(
      makeInput('/', {
        pageKindOverride: 'Homepage',
      }),
    );
    const graph = getGraph(output);
    expect(graph.some(n => n['@type'] === 'LocalBusiness')).toBe(false);
    expect(graph.some(n => n['@type'] === 'Organization')).toBe(true);
    expect(output.generationDiagnostics?.skippedSchemaTypes).toContainEqual(expect.objectContaining({
      type: 'LocalBusiness',
      reason: 'Homepage LocalBusiness skipped: no verified primary business address.',
    }));
  });

  it('homepage override uses rendered semantic NAP to preserve LocalBusiness output', async () => {
    vi.mocked(getPageElements).mockReturnValueOnce({
      workspaceId: 'ws-test',
      pagePath: '/',
      sourcePublishedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      catalog: {
        extractedAt: '2026-01-01T00:00:00.000Z',
        sourcePublishedAt: null,
        headings: [],
        tables: [],
        images: [],
        videos: [],
        lists: [],
        testimonials: [],
        codeBlocks: [],
        citations: [],
        diagnostics: {
          aiClassificationCalls: 0,
          hitAiBudgetCap: false,
          rawCounts: {},
        },
        semantics: {
          phone: '512-555-1212',
          address: {
            street: '1 Main St',
            city: 'Austin',
            state: 'TX',
            postalCode: '78701',
            country: 'US',
          },
        },
      },
    });
    const output = await generateLeanSchema(
      makeInput('/', {
        pageKindOverride: 'Homepage',
      }),
    );
    const graph = getGraph(output);
    const lbNode = graph.find(n => n['@type'] === 'LocalBusiness') as Record<string, unknown> | undefined;
    expect(lbNode).toBeDefined();
    expect(lbNode?.telephone).toBe('512-555-1212');
  });

  it('does not emit opaque CMS IDs in public LocalBusiness address or areaServed fields', async () => {
    const output = await generateLeanSchema(
      makeInput('/location/kyle', {
        pageKindOverride: 'Location',
        workspace: {
          ...minimalWorkspace,
          businessProfile: {
            phone: '512-555-1212',
            address: {
              city: 'Kyle',
              state: '65d25be3772349200f0af0ab',
            },
          },
        },
      }),
    );
    const graph = getGraph(output);
    const lbNode = graph.find(n => n['@type'] === 'LocalBusiness') as Record<string, unknown>;
    const address = lbNode.address as Record<string, unknown>;
    expect(address.addressLocality).toBe('Kyle');
    expect(address.addressRegion).toBeUndefined();
    expect(lbNode.areaServed).toEqual({ '@type': 'Place', name: 'Kyle' });
    expect(JSON.stringify(output.suggestedSchemas[0].template)).not.toContain('65d25be3772349200f0af0ab');
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

// ---------------------------------------------------------------------------
// Group 5: static page path resolution
// ---------------------------------------------------------------------------
describe('static sitemap path resolution', () => {
  it('recovers a nested static page path from sitemap when Webflow only exposes the leaf slug', async () => {
    const {
      buildStaticSitemapPathIndex,
      resolveStaticPagePathFromSitemap,
    } = await import('../../../server/webflow-pages.js');
    const index = buildStaticSitemapPathIndex([
      'https://example.com/',
      'https://example.com/services',
      'https://example.com/services/veneers',
    ], BASE_URL);

    expect(resolveStaticPagePathFromSitemap({ slug: 'veneers', publishedPath: '/veneers' }, index))
      .toBe('/services/veneers');
  });

  it('accepts sitemap URLs from the equivalent www host', async () => {
    const {
      buildStaticSitemapPathIndex,
      resolveStaticPagePathFromSitemap,
    } = await import('../../../server/webflow-pages.js');
    const index = buildStaticSitemapPathIndex([
      'https://www.example.com/services/veneers',
    ], 'https://example.com');

    expect(resolveStaticPagePathFromSitemap({ slug: 'veneers', publishedPath: '/veneers' }, index))
      .toBe('/services/veneers');
  });

  it('normalizes sitemap path casing consistently before returning an enriched path', async () => {
    const {
      buildStaticSitemapPathIndex,
      resolveStaticPagePathFromSitemap,
    } = await import('../../../server/webflow-pages.js');
    const index = buildStaticSitemapPathIndex([
      'https://example.com/Services/Veneers',
      'https://example.com/services/veneers',
    ], BASE_URL);

    expect(resolveStaticPagePathFromSitemap({ slug: 'veneers', publishedPath: '/veneers' }, index))
      .toBe('/services/veneers');
  });

  it('keeps a static page path unchanged when it already matches the sitemap', async () => {
    const {
      buildStaticSitemapPathIndex,
      resolveStaticPagePathFromSitemap,
    } = await import('../../../server/webflow-pages.js');
    const index = buildStaticSitemapPathIndex([
      'https://example.com/services/veneers',
    ], BASE_URL);

    expect(resolveStaticPagePathFromSitemap({ slug: 'veneers', publishedPath: '/services/veneers' }, index))
      .toBe('/services/veneers');
  });

  it('does not override static paths when sitemap leaf matches are ambiguous', async () => {
    const {
      buildStaticSitemapPathIndex,
      resolveStaticPagePathFromSitemap,
    } = await import('../../../server/webflow-pages.js');
    const index = buildStaticSitemapPathIndex([
      'https://example.com/services/veneers',
      'https://example.com/cosmetic/veneers',
    ], BASE_URL);

    expect(resolveStaticPagePathFromSitemap({ slug: 'veneers', publishedPath: '/veneers' }, index))
      .toBe('/veneers');
  });

  it('enriches page objects before site context and schema generation consume them', async () => {
    const { resolveStaticPagePathsFromSitemap } = await import('../../../server/webflow-pages.js');
    const pages = resolveStaticPagePathsFromSitemap([
      { id: 'page-veneers', slug: 'veneers', publishedPath: '/veneers' },
    ], [
      'https://example.com/services/veneers',
    ], BASE_URL);

    expect(pages[0].publishedPath).toBe('/services/veneers');
  });
});
