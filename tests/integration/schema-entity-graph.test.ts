/**
 * Integration tests: entity graph hub dispatch.
 * Tests generateLeanSchema directly (no HTTP server needed) with a synthetic siteContext.
 * Validates that hub pages emit correct cross-page @id references and pass the validator.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn().mockResolvedValue({
    text: 'A clear description.',
    tokens: { prompt: 100, completion: 20, total: 120 },
  }),
}));

import { generateLeanSchema } from '../../server/schema/generator.js';
import { assembleSiteContext } from '../../server/schema/site-context.js';
import { validateLeanSchema } from '../../server/schema/validator.js';
import { callAI } from '../../server/ai.js';

const BASE = 'https://example.com';

const workspace = {
  id: 'test-workspace',
  name: 'Acme',
  publisherLogoUrl: null,
  businessProfile: null,
  defaultLocale: 'en',
  siteKeywordsForKnowsAbout: [],
  siteHasSearch: false,
};

/** Build a SiteContext from a list of simple path objects */
function buildContext(paths: Array<{ path: string; lastPublished?: string }>) {
  const pages = paths.map(({ path, lastPublished }) => ({
    id: `id:${path}`,
    title: path,
    slug: path.replace(/^\//, '') || 'home',
    publishedPath: path,
    ...(lastPublished ? { lastPublished } : {}),
  }));
  return assembleSiteContext(pages as never, BASE);
}

/** Run generateLeanSchema for a given path with a pre-built siteContext */
async function generate(publishedPath: string, siteContext: ReturnType<typeof buildContext>) {
  return generateLeanSchema({
    pageId: `id:${publishedPath}`,
    pageMeta: {
      title: `Page ${publishedPath}`,
      slug: publishedPath.replace(/^\//, '') || 'home',
      publishedPath,
      seo: { description: 'A test page' },
    },
    html: `<html><body><p>Content for ${publishedPath}</p></body></html>`,
    baseUrl: BASE,
    workspace,
    siteContext,
  });
}

beforeEach(() => {
  vi.mocked(callAI).mockClear();
  vi.mocked(callAI).mockResolvedValue({
    text: 'A clear description.',
    tokens: { prompt: 100, completion: 20, total: 120 },
  });
});

describe('BlogIndex hub dispatch', () => {
  const ctx = buildContext([
    { path: '/blog' },
    { path: '/blog/post-a', lastPublished: '2026-04-01T00:00:00Z' },
    { path: '/blog/post-b', lastPublished: '2026-03-01T00:00:00Z' },
    { path: '/blog/post-c' },
  ]);

  it('emits Blog @type for /blog', async () => {
    const out = await generate('/blog', ctx);
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    expect(graph[0]['@type']).toBe('Blog');
  });

  it('@id ends with #blog', async () => {
    const out = await generate('/blog', ctx);
    const blog = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>)[0];
    expect(blog['@id']).toBe(`${BASE}/blog#blog`);
  });

  it('blogPost[] references all child posts', async () => {
    const out = await generate('/blog', ctx);
    const blog = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>)[0];
    const blogPost = blog['blogPost'] as Array<{ '@id': string }>;
    expect(blogPost).toHaveLength(3);
    const ids = blogPost.map(p => p['@id']);
    expect(ids).toContain(`${BASE}/blog/post-a#article`);
    expect(ids).toContain(`${BASE}/blog/post-b#article`);
    expect(ids).toContain(`${BASE}/blog/post-c#article`);
  });

  it('blogPost[] is sorted newest-first', async () => {
    const out = await generate('/blog', ctx);
    const blog = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>)[0];
    const blogPost = blog['blogPost'] as Array<{ '@id': string }>;
    expect(blogPost[0]['@id']).toBe(`${BASE}/blog/post-a#article`);
    expect(blogPost[1]['@id']).toBe(`${BASE}/blog/post-b#article`);
    expect(blogPost[2]['@id']).toBe(`${BASE}/blog/post-c#article`);
  });

  it('numberOfItems is not emitted (ItemList property, not Blog)', async () => {
    const out = await generate('/blog', ctx);
    const blog = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>)[0];
    expect(blog['numberOfItems']).toBeUndefined();
  });

  it('passes validator with zero error findings', async () => {
    const out = await generate('/blog', ctx);
    const schema = out.suggestedSchemas[0].template;
    const findings = validateLeanSchema(schema, 'Blog');
    expect(findings.filter((f: { severity: string }) => f.severity === 'error')).toEqual([]);
  });

  it('falls back to CollectionPage when siteContext is absent', async () => {
    const out = await generateLeanSchema({
      pageId: 'p-blog',
      pageMeta: { title: 'Blog', slug: 'blog', publishedPath: '/blog', seo: { description: 'Blog' } },
      html: '<html><body>Blog</body></html>',
      baseUrl: BASE,
      workspace,
      // no siteContext
    });
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    expect(graph[0]['@type']).toBe('CollectionPage');
  });

  it('also works for /insights (client variant)', async () => {
    const insightsCtx = buildContext([
      { path: '/insights' },
      { path: '/insights/guide-1' },
    ]);
    const out = await generate('/insights', insightsCtx);
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    expect(graph[0]['@type']).toBe('Blog');
  });
});

describe('ServiceIndex hub dispatch', () => {
  const ctx = buildContext([
    { path: '/services' },
    { path: '/services/design' },
    { path: '/services/development' },
    { path: '/services/strategy' },
  ]);

  it('emits Service @type for /services', async () => {
    const out = await generate('/services', ctx);
    const service = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>)[0];
    expect(service['@type']).toBe('Service');
  });

  it('emits hasOfferCatalog with itemListElement refs for all children', async () => {
    const out = await generate('/services', ctx);
    const service = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>)[0];
    const catalog = service['hasOfferCatalog'] as Record<string, unknown>;
    expect(catalog['@type']).toBe('OfferCatalog');
    const items = catalog['itemListElement'] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ '@type': 'ListItem', 'position': 1 });
    const ids = items.map(p => (p['item'] as { '@id': string })['@id']);
    expect(ids).toContain(`${BASE}/services/design#service`);
    expect(ids).toContain(`${BASE}/services/development#service`);
    expect(ids).toContain(`${BASE}/services/strategy#service`);
  });

  it('passes validator with zero errors', async () => {
    const out = await generate('/services', ctx);
    const schema = out.suggestedSchemas[0].template;
    const findings = validateLeanSchema(schema, 'Service');
    expect(findings.filter((f: { severity: string }) => f.severity === 'error')).toEqual([]);
  });
});

describe('CaseStudyIndex hub dispatch', () => {
  const ctx = buildContext([
    { path: '/our-work' },
    { path: '/our-work/expero' },
    { path: '/our-work/swish-dental' },
    { path: '/our-work/thumbtack' },
  ]);

  it('emits CollectionPage @type for /our-work', async () => {
    const out = await generate('/our-work', ctx);
    const page = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>)[0];
    expect(page['@type']).toBe('CollectionPage');
  });

  it('mainEntity is ItemList with ListItem entries', async () => {
    const out = await generate('/our-work', ctx);
    const page = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>)[0];
    const mainEntity = page['mainEntity'] as Record<string, unknown>;
    expect(mainEntity['@type']).toBe('ItemList');
    expect(mainEntity['numberOfItems']).toBe(3);
    const items = mainEntity['itemListElement'] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ '@type': 'ListItem', 'position': 1 });
    expect(items[0]['item']).toMatchObject({ '@id': `${BASE}/our-work/expero#article` });
  });

  it('passes validator with zero errors', async () => {
    const out = await generate('/our-work', ctx);
    const schema = out.suggestedSchemas[0].template;
    const findings = validateLeanSchema(schema, 'CollectionPage');
    expect(findings.filter((f: { severity: string }) => f.severity === 'error')).toEqual([]);
  });

  it('also works for /case-studies (client variant)', async () => {
    const caseCtx = buildContext([
      { path: '/case-studies' },
      { path: '/case-studies/project-x' },
    ]);
    const out = await generate('/case-studies', caseCtx);
    const page = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>)[0];
    expect(page['@type']).toBe('CollectionPage');
    expect((page['mainEntity'] as Record<string, unknown>)?.['@type']).toBe('ItemList');
  });
});

describe('Non-hub pages unchanged', () => {
  const ctx = buildContext([
    { path: '/blog' },
    { path: '/blog/post-a' },
    { path: '/about' },
    { path: '/services/design' },
  ]);

  it('BlogPosting still emits BlogPosting', async () => {
    const out = await generate('/blog/post-a', ctx);
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    expect(graph[0]['@type']).toBe('BlogPosting');
  });

  it('AboutPage still emits AboutPage', async () => {
    const out = await generate('/about', ctx);
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    expect(graph[0]['@type']).toBe('AboutPage');
  });

  it('Service (individual) still emits Service', async () => {
    const out = await generate('/services/design', ctx);
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    expect(graph[0]['@type']).toBe('Service');
  });
});
