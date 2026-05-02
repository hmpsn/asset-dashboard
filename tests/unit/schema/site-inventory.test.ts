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

import { buildSiteInventory, isOpaqueWebflowIdentifier, isUtilitySchemaPath } from '../../../server/schema/site-inventory.js';
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
    expect(isUtilitySchemaPath('/members/login')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/blog/thank-you')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/blog/how-to-floss')).toMatchObject({ isUtility: false });
  });

  it('rejects opaque Webflow reference IDs from location business profile fields', async () => {
    vi.mocked(listCollections).mockResolvedValue([{ id: 'col-locations', displayName: 'Locations', slug: 'location' }]);
    vi.mocked(getCollectionSchema).mockResolvedValue({
      fields: [
        { id: 'f-city', slug: 'city', displayName: 'City', type: 'PlainText' },
        { id: 'f-state', slug: 'state', displayName: 'State', type: 'Reference' },
        { id: 'f-phone', slug: 'phone', displayName: 'Phone', type: 'Phone' },
      ],
    });
    vi.mocked(discoverCmsItemsBySlug).mockResolvedValue({
      totalFound: 1,
      items: [{
        url: 'https://example.com/location/kyle',
        path: '/location/kyle',
        pageName: 'Kyle',
        collectionId: 'col-locations',
        itemId: 'item-1',
        lastPublished: null,
        createdOn: null,
        fieldData: {
          city: 'Kyle',
          state: '65d25be3772349200f0af0ab',
          phone: '512-555-1212',
        },
      }],
    });

    const inventory = await buildSiteInventory({
      siteId: 'site-1',
      baseUrl: 'https://example.com',
      pages: [],
    });

    expect(isOpaqueWebflowIdentifier('65d25be3772349200f0af0ab')).toBe(true);
    expect(inventory.cmsItems[0].itemBusinessProfile?.address).toMatchObject({ city: 'Kyle' });
    expect(inventory.cmsItems[0].itemBusinessProfile?.address?.state).toBeUndefined();
    expect(inventory.cmsItems[0].itemBusinessProfile?.phone).toBe('512-555-1212');
    expect(inventory.cmsItems[0].fieldEvidence?.some(e => (
      e.field === 'addressRegion' && e.status === 'skipped-unresolved-reference'
    ))).toBe(true);
  });

  it('uses mapped location fields and resolved reference display values for NAP', async () => {
    vi.mocked(getSchemaCmsFieldMappings).mockReturnValue([{
      siteId: 'site-1',
      collectionId: 'col-locations',
      collectionName: 'Locations',
      collectionSlug: 'location',
      collectionRole: 'location',
      fieldMappings: {
        streetAddress: 'addr-line',
        addressLocality: 'city-ref',
        addressRegion: 'region-ref',
        postalCode: 'postal',
        phone: 'tel-number',
        email: 'contact-email',
      },
      updatedAt: '2026-01-01T00:00:00Z',
    }]);
    vi.mocked(listCollections).mockResolvedValue([{ id: 'col-locations', displayName: 'Locations', slug: 'location' }]);
    vi.mocked(getCollectionSchema).mockResolvedValue({
      fields: [
        { id: 'f-street', slug: 'addr-line', displayName: 'Address Line', type: 'PlainText' },
        { id: 'f-city', slug: 'city-ref', displayName: 'City Reference', type: 'Reference' },
        { id: 'f-state', slug: 'region-ref', displayName: 'State Reference', type: 'Reference' },
        { id: 'f-zip', slug: 'postal', displayName: 'Postal', type: 'PlainText' },
        { id: 'f-phone', slug: 'tel-number', displayName: 'Phone Number', type: 'Phone' },
        { id: 'f-email', slug: 'contact-email', displayName: 'Email', type: 'Email' },
      ],
    });
    vi.mocked(discoverCmsItemsBySlug).mockResolvedValue({
      totalFound: 1,
      items: [{
        url: 'https://example.com/location/kyle',
        path: '/location/kyle',
        pageName: 'Kyle',
        collectionId: 'col-locations',
        itemId: 'item-1',
        lastPublished: null,
        createdOn: null,
        fieldData: {
          'addr-line': '123 Main St',
          'city-ref': { name: 'Kyle' },
          'region-ref': { displayName: 'TX' },
          postal: '78640',
          'tel-number': '512-555-1212',
          'contact-email': 'kyle@example.com',
        },
      }],
    });

    const inventory = await buildSiteInventory({
      siteId: 'site-1',
      baseUrl: 'https://example.com',
      pages: [],
    });

    expect(inventory.cmsItems[0].fieldTargets.addressLocality).toBe('city-ref');
    expect(inventory.cmsItems[0].itemBusinessProfile?.address).toMatchObject({
      street: '123 Main St',
      city: 'Kyle',
      state: 'TX',
      zip: '78640',
    });
    expect(inventory.cmsItems[0].itemBusinessProfile?.email).toBe('kyle@example.com');
  });

  it('derives mapped service profile fields and complete offers', async () => {
    vi.mocked(getSchemaCmsFieldMappings).mockReturnValue([{
      siteId: 'site-1',
      collectionId: 'col-services',
      collectionName: 'Services',
      collectionSlug: 'services',
      collectionRole: 'service',
      fieldMappings: {
        serviceName: 'service-title',
        serviceType: 'category',
        areaServed: 'market',
        price: 'starting-price',
        priceCurrency: 'currency',
      },
      updatedAt: '2026-01-01T00:00:00Z',
    }]);
    vi.mocked(listCollections).mockResolvedValue([{ id: 'col-services', displayName: 'Services', slug: 'services' }]);
    vi.mocked(getCollectionSchema).mockResolvedValue({
      fields: [
        { id: 'f-name', slug: 'service-title', displayName: 'Service Title', type: 'PlainText' },
        { id: 'f-category', slug: 'category', displayName: 'Service Category', type: 'PlainText' },
        { id: 'f-market', slug: 'market', displayName: 'Area Served', type: 'PlainText' },
        { id: 'f-price', slug: 'starting-price', displayName: 'Starting Price', type: 'Number' },
        { id: 'f-currency', slug: 'currency', displayName: 'Currency', type: 'PlainText' },
      ],
    });
    vi.mocked(discoverCmsItemsBySlug).mockResolvedValue({
      totalFound: 1,
      items: [{
        url: 'https://example.com/services/whitening',
        path: '/services/whitening',
        pageName: 'Whitening',
        collectionId: 'col-services',
        itemId: 'item-1',
        lastPublished: null,
        createdOn: null,
        fieldData: {
          'service-title': 'Teeth Whitening',
          category: 'Cosmetic Dentistry',
          market: 'Austin, TX',
          'starting-price': 199,
          currency: 'USD',
        },
      }],
    });

    const inventory = await buildSiteInventory({
      siteId: 'site-1',
      baseUrl: 'https://example.com',
      pages: [],
    });

    expect(inventory.cmsItems[0].itemServiceProfile).toMatchObject({
      serviceName: 'Teeth Whitening',
      serviceType: 'Cosmetic Dentistry',
      areaServed: 'Austin, TX',
      offers: [{ price: '199', priceCurrency: 'USD' }],
    });
  });
});
