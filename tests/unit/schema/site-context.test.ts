import { describe, it, expect } from 'vitest';
import { assembleSiteContext } from '../../../server/schema/site-context.js';

const BASE = 'https://example.com';

/** Minimal page fixture — satisfies WebflowPage's required fields plus optional lastPublished */
function page(
  publishedPath: string,
  opts: { lastPublished?: string; slug?: string } = {},
) {
  const slug = opts.slug ?? publishedPath.replace(/^\//, '');
  return {
    id: `id:${publishedPath}`,
    title: publishedPath,
    slug,
    publishedPath,
    ...(opts.lastPublished !== undefined ? { lastPublished: opts.lastPublished } : {}),
  };
}

describe('assembleSiteContext', () => {
  it('returns empty pages array for empty input', () => {
    const ctx = assembleSiteContext([], BASE);
    expect(ctx.pages).toEqual([]);
    expect(ctx.canonicalEntities).toEqual([]);
  });

  it('passes canonicalEntities through unchanged', () => {
    const entities = [{ type: 'Service', name: 'Design', canonicalUrl: `${BASE}/services`, id: `${BASE}/services#service`, description: 'desc' }];
    const ctx = assembleSiteContext([], BASE, entities);
    expect(ctx.canonicalEntities).toBe(entities);
  });

  it('produces correct SiteContextPage for a blog post', () => {
    const ctx = assembleSiteContext([page('/blog/my-post')], BASE);
    const p = ctx.pages.find(p => p.path === '/blog/my-post');
    expect(p).toBeDefined();
    expect(p!.kind).toBe('BlogPosting');
    expect(p!.primaryType).toBe('BlogPosting');
    expect(p!.id).toBe(`${BASE}/blog/my-post#article`);
    expect(p!.parentPath).toBeNull(); // no hub in this page list
    expect(p!.childPaths).toEqual([]);
  });

  it('produces correct @id suffix for each kind', () => {
    const pages = [
      page('/'),
      page('/blog'),
      page('/blog/post'),
      page('/services'),
      page('/services/design'),
      page('/our-work'),
      page('/our-work/project-a'),
      page('/about'),
    ];
    const ctx = assembleSiteContext(pages, BASE);
    const byPath = new Map(ctx.pages.map(p => [p.path, p]));
    expect(byPath.get('/')!.id).toBe(`${BASE}/#webpage`);
    expect(byPath.get('/blog')!.id).toBe(`${BASE}/blog#blog`);
    expect(byPath.get('/blog/post')!.id).toBe(`${BASE}/blog/post#article`);
    expect(byPath.get('/services')!.id).toBe(`${BASE}/services#service`);
    expect(byPath.get('/services/design')!.id).toBe(`${BASE}/services/design#service`);
    expect(byPath.get('/our-work')!.id).toBe(`${BASE}/our-work#webpage`);
    expect(byPath.get('/our-work/project-a')!.id).toBe(`${BASE}/our-work/project-a#article`);
    expect(byPath.get('/about')!.id).toBe(`${BASE}/about#webpage`);
  });

  it('detects blog index hub and its posts as children', () => {
    const pages = [
      page('/blog'),
      page('/blog/post-a', { lastPublished: '2026-03-01T00:00:00Z' }),
      page('/blog/post-b', { lastPublished: '2026-04-01T00:00:00Z' }),
      page('/blog/post-c'),
    ];
    const ctx = assembleSiteContext(pages, BASE);
    const hub = ctx.pages.find(p => p.path === '/blog')!;
    expect(hub.childPaths).toHaveLength(3);
    // All posts should point back to /blog as parent
    for (const childPath of hub.childPaths) {
      const child = ctx.pages.find(p => p.path === childPath)!;
      expect(child.parentPath).toBe('/blog');
    }
  });

  it('sorts blog children by lastPublished desc — null dates last then alpha', () => {
    const pages = [
      page('/insights'),
      page('/insights/old',   { lastPublished: '2025-01-01T00:00:00Z' }),
      page('/insights/newer', { lastPublished: '2026-03-15T00:00:00Z' }),
      page('/insights/no-date-b'),
      page('/insights/no-date-a'),
    ];
    const ctx = assembleSiteContext(pages, BASE);
    const hub = ctx.pages.find(p => p.path === '/insights')!;
    expect(hub.childPaths).toHaveLength(4);
    expect(hub.childPaths[0]).toBe('/insights/newer');  // newest first
    expect(hub.childPaths[1]).toBe('/insights/old');    // older second
    // null-date pages are last, sorted alpha
    expect(hub.childPaths[2]).toBe('/insights/no-date-a');
    expect(hub.childPaths[3]).toBe('/insights/no-date-b');
  });

  it('detects service index hub and service children', () => {
    const pages = [
      page('/services'),
      page('/services/design'),
      page('/services/dev'),
    ];
    const ctx = assembleSiteContext(pages, BASE);
    const hub = ctx.pages.find(p => p.path === '/services')!;
    expect(hub.childPaths).toHaveLength(2);
    expect(hub.childPaths).toContain('/services/design');
    expect(hub.childPaths).toContain('/services/dev');
  });

  it('detects case study index hub and article children', () => {
    const pages = [
      page('/our-work'),
      page('/our-work/project-a'),
      page('/our-work/project-b'),
    ];
    const ctx = assembleSiteContext(pages, BASE);
    const hub = ctx.pages.find(p => p.path === '/our-work')!;
    expect(hub.childPaths).toHaveLength(2);
  });

  it('handles pages with null publishedPath using slug fallback', () => {
    const pagesWithNullPath = [
      { id: 'p1', title: 'Blog', slug: 'blog', publishedPath: null },
      { id: 'p2', title: 'Post', slug: 'post', publishedPath: '/blog/post' },
    ];
    const ctx = assembleSiteContext(pagesWithNullPath as never, BASE);
    const hub = ctx.pages.find(p => p.path === '/blog');
    expect(hub).toBeDefined();
    expect(hub!.childPaths).toContain('/blog/post');
  });

  it('does NOT create parent-child when child kind is WebPage', () => {
    // /a has kind WebPage (doesn't match any pattern) — /a/b/c also WebPage
    // No CHILD_KINDS match, so no relationship forms
    const pages = [
      page('/a'),
      page('/a/b/c'),
    ];
    const ctx = assembleSiteContext(pages, BASE);
    const hub = ctx.pages.find(p => p.path === '/a')!;
    expect(hub.childPaths).toHaveLength(0);
  });
});
