import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../server/webflow-cms.js', () => ({
  listCollections: vi.fn(),
  listCollectionItems: vi.fn(),
}));

import { discoverCmsItemsBySlug } from '../../../server/webflow-pages.js';
import { listCollections, listCollectionItems } from '../../../server/webflow-cms.js';

describe('discoverCmsItemsBySlug', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('joins sitemap URLs to fieldData by slug', async () => {
    vi.mocked(listCollections).mockResolvedValue([{ id: 'col1', displayName: 'Posts', slug: 'posts' }]);
    vi.mocked(listCollectionItems).mockResolvedValue({
      items: [{
        id: 'item1',
        lastPublished: '2026-01-15T00:00:00Z',
        createdOn: '2026-01-10T00:00:00Z',
        fieldData: { slug: 'my-post', 'author-name': 'Jane Doe', 'published-on': '2026-01-15T00:00:00Z' },
      }],
      total: 1,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<?xml version="1.0"?><urlset><url><loc>https://acme.com/blog/my-post</loc></url></urlset>',
    }) as unknown as typeof fetch;

    const out = await discoverCmsItemsBySlug('site1', 'https://acme.com', new Set(['/']), 100);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].itemId).toBe('item1');
    expect(out.items[0].lastPublished).toBe('2026-01-15T00:00:00Z');
    expect(out.items[0].fieldData?.['author-name']).toBe('Jane Doe');
  });

  it('falls back to null fields when slug does not match any item', async () => {
    vi.mocked(listCollections).mockResolvedValue([{ id: 'col1', displayName: 'Posts', slug: 'posts' }]);
    vi.mocked(listCollectionItems).mockResolvedValue({ items: [], total: 0 });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<?xml version="1.0"?><urlset><url><loc>https://acme.com/orphan</loc></url></urlset>',
    }) as unknown as typeof fetch;

    const out = await discoverCmsItemsBySlug('site1', 'https://acme.com', new Set(['/']), 100);
    expect(out.items[0].itemId).toBe('');
    expect(out.items[0].fieldData).toBeNull();
  });
});
