/**
 * Integration test: lean schema generator end-to-end for each page kind.
 * Uses synthetic page meta + HTML; no DB or HTTP server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn().mockResolvedValue({
    text: 'A clean description.',
    tokens: { prompt: 100, completion: 20, total: 120 },
  }),
}));

import { generateLeanSchema } from '../../server/schema/generator.js';
import { callAI } from '../../server/ai.js';

const baseInput = {
  pageId: 'p1',
  pageMeta: { title: 'X', slug: 'x', publishedPath: '/x', seo: { description: 'desc' } },
  html: '<html><body>Body content for the page.</body></html>',
  baseUrl: 'https://example.com',
  workspace: { name: 'Acme', publisherLogoUrl: null, businessProfile: null },
};

describe('generateLeanSchema', () => {
  beforeEach(() => {
    vi.mocked(callAI).mockClear();
    vi.mocked(callAI).mockResolvedValue({
      text: 'A clean description.',
      tokens: { prompt: 100, completion: 20, total: 120 },
    });
  });

  it('produces a SchemaPageSuggestion with one suggestion entry', async () => {
    const out = await generateLeanSchema(baseInput);
    expect(out.pageId).toBe('p1');
    expect(out.suggestedSchemas).toHaveLength(1);
    expect(out.suggestedSchemas[0].priority).toBe('high');
  });

  it('classifies blog posts as BlogPosting', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/blog/my-post' },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
    expect(graph[0]['@type']).toBe('BlogPosting');
  });

  it('classifies case studies as Article (not Service)', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/our-work/expero' },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
    expect(graph[0]['@type']).toBe('Article');
  });

  it('emits Organization + WebSite for the homepage', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { title: 'Home', slug: '', publishedPath: '/', seo: undefined },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
    const types = graph.map(n => n['@type']);
    expect(types).toEqual(['Organization', 'WebSite']);
  });

  it('produces validationErrors=undefined on clean output', async () => {
    const out = await generateLeanSchema(baseInput);
    expect(out.validationErrors).toBeUndefined();
  });

  it('emits exactly 2 nodes (primary + breadcrumb) for non-homepage pages', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/services/design' },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as unknown[]);
    expect(graph.length).toBe(2);
  });

  it('never emits duplicate WebPage nodes (the bug we are fixing)', async () => {
    const paths = ['/services/design', '/our-work/expero', '/blog/my-post', '/about', '/'];
    for (const p of paths) {
      const out = await generateLeanSchema({
        ...baseInput,
        pageMeta: { ...baseInput.pageMeta, publishedPath: p },
      });
      const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
      const webPageCount = graph.filter(n => n['@type'] === 'WebPage').length;
      expect(webPageCount, `${p} should not have multiple WebPage nodes`).toBeLessThanOrEqual(1);
    }
  });

  it('strips trailing slash from baseUrl to prevent //path canonical URLs', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      baseUrl: 'https://example.com/',  // trailing slash
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/about' },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
    const node = graph[0];
    // @id and url must not have double-slash after the domain (i.e., no //path)
    const idStr = String(node['@id'] ?? '');
    expect(idStr.replace(/^https?:\/\//, '')).not.toContain('//');
    expect(out.url).not.toContain('//about');  // single slash only
    expect(out.url).toBe('https://example.com/about');
  });

  it('appends FAQPage when page HTML contains accordion patterns', async () => {
    const htmlWithFaq = `<html><body>
      <details><summary>What is your turnaround time?</summary><p>Two weeks.</p></details>
      <details><summary>Do you offer refunds?</summary><p>Yes, within 30 days.</p></details>
    </body></html>`;
    const out = await generateLeanSchema({
      ...baseInput,
      html: htmlWithFaq,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/services/design' },
    });
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    const faqNode = graph.find(n => n['@type'] === 'FAQPage');
    expect(faqNode).toBeDefined();
    expect((faqNode!.mainEntity as unknown[])).toHaveLength(2);
  });

  it('appends FAQPage on a BlogPosting even when base schema has pre-existing validation errors (FAQ rollback uses error-diff, not absolute count)', async () => {
    // BlogPosting REQUIRES datePublished. This HTML deliberately omits the
    // <time itemprop="datePublished"> microformat AND no CMS dates are passed,
    // so the base BlogPosting schema will have a 'missing datePublished' error.
    // Pre-fix, the FAQ append would see post-validation errors > 0 and roll
    // back the (perfectly valid) FAQPage. Post-fix, the rollback only fires
    // when FAQ-introduced errors appear — base errors don't count.
    const htmlNoDateWithFaq = `<html><body>
      <p>Body content</p>
      <details><summary>What did you do?</summary><p>We launched.</p></details>
      <details><summary>Why?</summary><p>Demand was strong.</p></details>
    </body></html>`;
    const out = await generateLeanSchema({
      ...baseInput,
      html: htmlNoDateWithFaq,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/blog/launch-faq', seo: { description: 'desc' } },
    });
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    const types = graph.map(n => n['@type']);
    expect(types).toContain('BlogPosting');
    expect(types).toContain('FAQPage');  // The bug-fix: FAQPage survives even with base errors
    const faqNode = graph.find(n => n['@type'] === 'FAQPage');
    expect((faqNode!.mainEntity as unknown[])).toHaveLength(2);
    // The surfaced validation errors should still include the base error so admins see it.
    expect(out.validationErrors).toBeDefined();
    expect(out.validationErrors!.some(e => e.includes('datePublished'))).toBe(true);
  });

  it('does NOT append FAQPage when accordion has fewer than 2 pairs', async () => {
    const htmlWithOneFaq = `<html><body>
      <details><summary>Single Q</summary><p>Single A</p></details>
    </body></html>`;
    const out = await generateLeanSchema({
      ...baseInput,
      html: htmlWithOneFaq,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/services/design' },
    });
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find(n => n['@type'] === 'FAQPage')).toBeUndefined();
  });
});

describe('generateLeanSchema: per-kind primary @type', () => {
  beforeEach(() => {
    vi.mocked(callAI).mockClear();
    vi.mocked(callAI).mockResolvedValue({
      text: 'A clean description.',
      tokens: { prompt: 100, completion: 20, total: 120 },
    });
  });

  const cases = [
    { path: '/', expectedFirstType: 'Organization', kind: 'Homepage' },
    { path: '/blog/my-post', expectedFirstType: 'BlogPosting', kind: 'BlogPosting' },
    { path: '/blog', expectedFirstType: 'CollectionPage', kind: 'BlogIndex' },
    { path: '/services/web-design', expectedFirstType: 'Service', kind: 'Service' },
    { path: '/services', expectedFirstType: 'CollectionPage', kind: 'ServiceIndex' },
    { path: '/our-work/expero', expectedFirstType: 'Article', kind: 'CaseStudy' },
    { path: '/our-work', expectedFirstType: 'CollectionPage', kind: 'CaseStudyIndex' },
    { path: '/about', expectedFirstType: 'AboutPage', kind: 'AboutPage' },
    { path: '/contact', expectedFirstType: 'ContactPage', kind: 'ContactPage' },
    { path: '/privacy-policy', expectedFirstType: 'WebPage', kind: 'Legal' },
    { path: '/random/deep/path', expectedFirstType: 'WebPage', kind: 'WebPage (fallback)' },
  ];

  it.each(cases)('emits $expectedFirstType for $kind ($path)', async ({ path, expectedFirstType }) => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: path },
    });
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    expect(graph[0]['@type']).toBe(expectedFirstType);
  });

  it('emits LocalBusiness as second graph node when workspace has business profile address', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/' },
      workspace: {
        name: 'Acme',
        publisherLogoUrl: null,
        businessProfile: {
          phone: '+1-555-0100',
          email: 'hi@acme.com',
          address: { street: '1 Main', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
          socialProfiles: [],
          openingHours: 'Mo-Fr 09:00-17:00',
        },
      },
    });
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    const types = graph.map(n => n['@type']);
    expect(types).toContain('Organization');
    expect(types).toContain('LocalBusiness');
  });
});
