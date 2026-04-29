/**
 * Integration test: lean schema generator end-to-end for each page kind.
 * Uses synthetic page meta + HTML; no DB or HTTP server.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn().mockResolvedValue({
    text: 'A clean description.',
    tokens: { prompt: 100, completion: 20, total: 120 },
  }),
}));

import { generateLeanSchema } from '../../server/schema/generator.js';

const baseInput = {
  pageId: 'p1',
  pageMeta: { title: 'X', slug: 'x', publishedPath: '/x', seo: { description: 'desc' } },
  html: '<html><body>Body content for the page.</body></html>',
  baseUrl: 'https://example.com',
  workspace: { name: 'Acme', publisherLogoUrl: null, businessProfile: null },
};

describe('generateLeanSchema', () => {
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
