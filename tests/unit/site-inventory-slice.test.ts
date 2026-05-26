import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildSiteInventory: vi.fn(),
  getWorkspaceAllPages: vi.fn(),
  getWorkspace: vi.fn(),
  discoverSitemapUrls: vi.fn(),
  resolveStaticPagePathsFromSitemap: vi.fn(),
}));

vi.mock('../../server/schema/site-inventory.js', () => ({
  buildSiteInventory: mocks.buildSiteInventory,
}));

vi.mock('../../server/workspace-data.js', () => ({
  getWorkspaceAllPages: mocks.getWorkspaceAllPages,
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
}));

vi.mock('../../server/webflow.js', () => ({
  discoverSitemapUrls: mocks.discoverSitemapUrls,
  resolveStaticPagePathsFromSitemap: mocks.resolveStaticPagePathsFromSitemap,
}));

const { assembleSiteInventory } = await import('../../server/intelligence/site-inventory-slice.js');

describe('assembleSiteInventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspaceAllPages.mockResolvedValue([
      { id: 'page-home', slug: '', title: 'Home' },
      { id: 'page-cms-template', slug: 'posts/{slug}', title: 'Post Template', collectionId: 'collection-posts' },
    ]);
    mocks.discoverSitemapUrls.mockResolvedValue(['https://example.com/blog/post-one']);
    mocks.resolveStaticPagePathsFromSitemap.mockReturnValue([
      { id: 'page-home', slug: '', title: 'Home', publishedPath: '/' },
      { id: 'page-cms-template', slug: 'posts/{slug}', title: 'Post Template', collectionId: 'collection-posts' },
    ]);
    mocks.getWorkspace.mockReturnValue({
      id: 'ws-schema',
      businessProfile: { phone: '+1-555-0100' },
    });
    mocks.buildSiteInventory.mockResolvedValue({ pages: [], collections: [], cmsItems: [] });
  });

  it('uses all live pages so CMS template pages remain available for inventory assembly', async () => {
    await assembleSiteInventory('ws-schema', 'site-schema', 'https://example.com', 'token-123');

    expect(mocks.getWorkspaceAllPages).toHaveBeenCalledWith('ws-schema', 'site-schema');
    expect(mocks.resolveStaticPagePathsFromSitemap).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ collectionId: 'collection-posts' }),
      ]),
      ['https://example.com/blog/post-one'],
      'https://example.com',
    );
    expect(mocks.buildSiteInventory).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 'site-schema',
      baseUrl: 'https://example.com',
      tokenOverride: 'token-123',
      businessProfile: { phone: '+1-555-0100' },
      pages: expect.arrayContaining([
        expect.objectContaining({ collectionId: 'collection-posts' }),
      ]),
    }));
  });
});
