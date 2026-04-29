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
});
