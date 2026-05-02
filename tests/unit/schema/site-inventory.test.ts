import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../server/webflow-pages.js', () => ({
  toCmsPageId: (path: string) => `cms-${path.replace(/^\//, '').replace(/\//g, '-')}`,
  discoverCmsItemsBySlug: vi.fn(),
}));

vi.mock('../../../server/webflow-cms.js', () => ({
  listCollections: vi.fn(),
  getCollectionSchema: vi.fn(),
}));

vi.mock('../../../server/schema-store.js', () => ({
  getSchemaCmsFieldMappings: vi.fn(),
}));

import { buildSiteInventory, isUtilitySchemaPath } from '../../../server/schema/site-inventory.js';
import { discoverCmsItemsBySlug } from '../../../server/webflow-pages.js';
import { getCollectionSchema, listCollections } from '../../../server/webflow-cms.js';
import { getSchemaCmsFieldMappings } from '../../../server/schema-store.js';

describe('schema site inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSchemaCmsFieldMappings).mockReturnValue([]);
  });

  it('infers blog collection role and detects schema-json-ld field', async () => {
    vi.mocked(listCollections).mockResolvedValue([{ id: 'col-blog', displayName: 'Blog Posts', slug: 'blog' }]);
    vi.mocked(getCollectionSchema).mockResolvedValue({
      fields: [
        { id: 'f-name', slug: 'name', displayName: 'Name', type: 'PlainText' },
        { id: 'f-author', slug: 'author-name', displayName: 'Author Name', type: 'PlainText' },
        { id: 'f-schema', slug: 'schema-json-ld', displayName: 'Schema JSON-LD', type: 'PlainText' },
      ],
    });
    vi.mocked(discoverCmsItemsBySlug).mockResolvedValue({
      totalFound: 1,
      items: [{
        url: 'https://example.com/blog/hello',
        path: '/blog/hello',
        pageName: 'Hello',
        collectionId: 'col-blog',
        itemId: 'item-1',
        lastPublished: '2026-01-01T00:00:00Z',
        createdOn: '2025-12-31T00:00:00Z',
        fieldData: { slug: 'hello', 'author-name': 'Jane' },
      }],
    });

    const inventory = await buildSiteInventory({
      siteId: 'site-1',
      baseUrl: 'https://example.com',
      pages: [{ id: 'home', title: 'Home', slug: '', publishedPath: '/' }],
    });

    expect(inventory.collections[0]).toMatchObject({
      collectionId: 'col-blog',
      inferredRole: 'blog',
      schemaFieldSlug: 'schema-json-ld',
      schemaFieldAvailable: true,
    });
    expect(inventory.cmsItems[0]).toMatchObject({
      pageId: 'cms-blog-hello',
      effectiveRole: 'blog',
      roleSource: 'inferred',
      schemaFieldSlug: 'schema-json-ld',
    });
    expect(inventory.cmsItems[0].fieldTargets.author).toBe('author-name');
  });

  it('lets mapped collection role override inference', async () => {
    vi.mocked(getSchemaCmsFieldMappings).mockReturnValue([{
      siteId: 'site-1',
      collectionId: 'col-people',
      collectionName: 'People',
      collectionSlug: 'people',
      schemaFieldSlug: 'schema-json-ld',
      collectionRole: 'author',
      updatedAt: '2026-01-01T00:00:00Z',
    }]);
    vi.mocked(listCollections).mockResolvedValue([{ id: 'col-people', displayName: 'People', slug: 'people' }]);
    vi.mocked(getCollectionSchema).mockResolvedValue({
      fields: [{ id: 'f-schema', slug: 'schema-json-ld', displayName: 'Schema JSON-LD', type: 'PlainText' }],
    });
    vi.mocked(discoverCmsItemsBySlug).mockResolvedValue({
      totalFound: 1,
      items: [{
        url: 'https://example.com/people/jane',
        path: '/people/jane',
        pageName: 'Jane',
        collectionId: 'col-people',
        itemId: 'item-1',
        lastPublished: null,
        createdOn: null,
        fieldData: { slug: 'jane' },
      }],
    });

    const inventory = await buildSiteInventory({
      siteId: 'site-1',
      baseUrl: 'https://example.com',
      pages: [],
    });

    expect(inventory.collections[0].mappedRole).toBe('author');
    expect(inventory.cmsItems[0].effectiveRole).toBe('author');
    expect(inventory.cmsItems[0].roleSource).toBe('mapped');
  });

  it('marks utility paths for bulk exclusion', () => {
    expect(isUtilitySchemaPath('/404')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/blog/thank-you')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/blog/how-to-floss')).toMatchObject({ isUtility: false });
  });
});
