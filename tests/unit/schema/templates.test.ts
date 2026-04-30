import { describe, it, expect } from 'vitest';
import { buildArticleSchema } from '../../../server/schema/templates/article.js';
import { buildServiceSchema, buildProductSchema } from '../../../server/schema/templates/service.js';
import { buildLocalBusinessSchema } from '../../../server/schema/templates/local-business.js';
import { buildAboutPageSchema, buildContactPageSchema, buildCollectionPageSchema, buildWebPageSchema } from '../../../server/schema/templates/static.js';
import { buildHomepageSchema } from '../../../server/schema/templates/homepage.js';
import { validateLeanSchema } from '../../../server/schema/validator.js';

const baseInput = {
  baseUrl: 'https://example.com',
  pageData: {
    title: 'My Post',
    cleanTitle: 'My Post',
    description: 'A great post',
    image: 'https://x/i.jpg',
    canonicalUrl: 'https://example.com/blog/my-post',
    publisher: { name: 'Acme', logoUrl: 'https://x/logo.png' },
    datePublished: '2025-01-15T00:00:00Z',
    dateModified: '2026-04-01T00:00:00Z',
    inLanguage: 'en',
    articleSection: 'Blog',
    breadcrumbs: [
      { name: 'Home', url: 'https://example.com' },
      { name: 'Blog', url: 'https://example.com/blog' },
      { name: 'My Post', url: 'https://example.com/blog/my-post' },
    ],
  },
};

describe('buildArticleSchema (BlogPosting)', () => {
  it('emits exactly two nodes: BlogPosting + BreadcrumbList', () => {
    const schema = buildArticleSchema(baseInput, 'BlogPosting');
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph).toHaveLength(2);
    expect(graph[0]['@type']).toBe('BlogPosting');
    expect(graph[1]['@type']).toBe('BreadcrumbList');
  });

  it('passes the validator', () => {
    expect(validateLeanSchema(buildArticleSchema(baseInput, 'BlogPosting'), 'BlogPosting')).toEqual([]);
  });

  it('omits image when not provided', () => {
    const input = { ...baseInput, pageData: { ...baseInput.pageData, image: undefined } };
    const schema = buildArticleSchema(input, 'BlogPosting');
    const node = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.image).toBeUndefined();
  });

  it('falls back to datePublished when dateModified missing', () => {
    const input = { ...baseInput, pageData: { ...baseInput.pageData, dateModified: undefined } };
    const schema = buildArticleSchema(input, 'BlogPosting');
    const node = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.dateModified).toBe('2025-01-15T00:00:00Z');
  });

  it('emits Article variant with about="Case study" when kind=Article', () => {
    const schema = buildArticleSchema(baseInput, 'Article');
    const node = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node['@type']).toBe('Article');
    expect(node.about).toBe('Case study');
  });

  it('emits @id for the primary node based on canonicalUrl', () => {
    const schema = buildArticleSchema(baseInput, 'BlogPosting');
    const node = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node['@id']).toBe('https://example.com/blog/my-post#article');
  });

  it('omits BreadcrumbList when only one item exists', () => {
    const input = {
      ...baseInput,
      pageData: { ...baseInput.pageData, breadcrumbs: [{ name: 'Home', url: 'https://example.com' }] },
    };
    const schema = buildArticleSchema(input, 'BlogPosting');
    expect((schema['@graph'] as unknown[]).length).toBe(1);
  });

  it('uses cleanTitle for headline, not raw title', () => {
    const dirty = { ...baseInput, pageData: { ...baseInput.pageData, title: 'My Post | Acme', cleanTitle: 'My Post' } };
    const node = (buildArticleSchema(dirty, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.headline).toBe('My Post');
  });
  it('emits isPartOf, breadcrumb, inLanguage, articleSection', () => {
    const withSection = { ...baseInput, pageData: { ...baseInput.pageData, articleSection: 'Blog' } };
    const node = (buildArticleSchema(withSection, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.isPartOf).toEqual({ '@id': 'https://example.com/#website' });
    expect(node.breadcrumb).toEqual({ '@id': 'https://example.com/blog/my-post#breadcrumb' });
    expect(node.inLanguage).toBe('en');
    expect(node.articleSection).toBe('Blog');
  });
  it('uses CMS-derived author when pageData.author is set', () => {
    const withAuthor = { ...baseInput, pageData: { ...baseInput.pageData, author: 'Jane Doe' } };
    const node = (buildArticleSchema(withAuthor, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.author).toEqual({ '@type': 'Person', 'name': 'Jane Doe' });
  });
  it('falls back to Organization author when pageData.author is undefined', () => {
    const node = (buildArticleSchema(baseInput, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.author).toEqual({ '@type': 'Organization', 'name': 'Acme' });
  });

  it('emits keywords as comma-joined string from pageData.keywords', () => {
    const withKeywords = {
      ...baseInput,
      pageData: { ...baseInput.pageData, keywords: 'webflow development, brand strategy, web design' },
    };
    const node = (buildArticleSchema(withKeywords, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.keywords).toBe('webflow development, brand strategy, web design');
  });

  it('omits keywords when pageData.keywords is undefined', () => {
    const noKeywords = {
      ...baseInput,
      pageData: { ...baseInput.pageData, keywords: undefined },
    };
    const node = (buildArticleSchema(noKeywords, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.keywords).toBeUndefined();
  });
});

const serviceInput = {
  baseUrl: 'https://example.com',
  pageData: {
    title: 'Web Design Service',
    cleanTitle: 'Web Design Service',
    description: 'Custom design',
    image: 'https://x/svc.jpg',
    canonicalUrl: 'https://example.com/services/web-design',
    publisher: { name: 'Acme', logoUrl: undefined },
    inLanguage: 'en',
    breadcrumbs: [
      { name: 'Home', url: 'https://example.com' },
      { name: 'Services', url: 'https://example.com/services' },
      { name: 'Web Design Service', url: 'https://example.com/services/web-design' },
    ],
  },
};

describe('buildServiceSchema', () => {
  it('emits Service + BreadcrumbList', () => {
    const schema = buildServiceSchema(serviceInput);
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph).toHaveLength(2);
    expect(graph[0]['@type']).toBe('Service');
    expect(graph[1]['@type']).toBe('BreadcrumbList');
  });

  it('passes validator', () => {
    expect(validateLeanSchema(buildServiceSchema(serviceInput), 'Service')).toEqual([]);
  });

  it('uses Organization @id reference for provider', () => {
    const node = (buildServiceSchema(serviceInput)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.provider).toEqual({ '@type': 'Organization', '@id': 'https://example.com/#organization', 'name': 'Acme' });
  });

  it('omits image when missing', () => {
    const input = { ...serviceInput, pageData: { ...serviceInput.pageData, image: undefined } };
    const node = (buildServiceSchema(input)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.image).toBeUndefined();
  });

  it('Service primary node has isPartOf, breadcrumb, inLanguage', () => {
    const node = (buildServiceSchema(serviceInput)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.isPartOf).toEqual({ '@id': 'https://example.com/#website' });
    expect(node.breadcrumb).toEqual({ '@id': 'https://example.com/services/web-design#breadcrumb' });
    expect(node.inLanguage).toBe('en');
  });

  it('Service emits areaServed as Place when populated', () => {
    const withArea = {
      ...serviceInput,
      pageData: { ...serviceInput.pageData, areaServed: 'Austin, TX' },
    };
    const node = (buildServiceSchema(withArea)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.areaServed).toEqual({ '@type': 'Place', name: 'Austin, TX' });
  });

  it('Service omits areaServed when undefined', () => {
    const node = (buildServiceSchema(serviceInput)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.areaServed).toBeUndefined();
  });

  it('Service emits serviceType from URL-derived slug', () => {
    const withType = {
      ...serviceInput,
      pageData: { ...serviceInput.pageData, serviceType: 'Web Design' },
    };
    const node = (buildServiceSchema(withType)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.serviceType).toBe('Web Design');
  });
});

describe('buildProductSchema', () => {
  it('emits Product + BreadcrumbList', () => {
    const input = {
      ...serviceInput,
      pageData: { ...serviceInput.pageData, canonicalUrl: 'https://example.com/products/x' },
    };
    const schema = buildProductSchema(input);
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph).toHaveLength(2);
    expect(graph[0]['@type']).toBe('Product');
  });

  it('does NOT emit offers when no price provided (no spammy zero-price offers)', () => {
    const node = (buildProductSchema(serviceInput)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.offers).toBeUndefined();
  });
});

describe('buildLocalBusinessSchema', () => {
  const localInput = {
    baseUrl: 'https://acme.dental',
    pageData: {
      title: 'Home | Acme Dental',
      cleanTitle: 'Home',
      description: 'Family dentistry',
      image: 'https://x/clinic.jpg',
      canonicalUrl: 'https://acme.dental',
      publisher: { name: 'Acme Dental', logoUrl: 'https://x/logo.png' },
      inLanguage: 'en',
      breadcrumbs: [{ name: 'Home', url: 'https://acme.dental' }],
    },
    businessProfile: {
      phone: '+1-512-555-0100',
      email: 'hi@acme.dental',
      address: { street: '100 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
      socialProfiles: ['https://twitter.com/acme'],
      openingHours: 'Mo-Fr 09:00-17:00',
    },
  };

  it('emits LocalBusiness with PostalAddress when business profile has address', () => {
    const schema = buildLocalBusinessSchema(localInput);
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const localBusinessNode = graph.find(n => n['@type'] === 'LocalBusiness') as Record<string, unknown>;
    expect(localBusinessNode['@type']).toBe('LocalBusiness');
    expect((localBusinessNode.address as Record<string, unknown>)['@type']).toBe('PostalAddress');
    expect((localBusinessNode.address as Record<string, unknown>).streetAddress).toBe('100 Main St');
  });

  it('emits sibling Organization node so orgRef resolves on other pages', () => {
    const schema = buildLocalBusinessSchema(localInput);
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const orgNode = graph.find(n => n['@type'] === 'Organization') as Record<string, unknown>;
    expect(orgNode).toBeDefined();
    expect(orgNode['@id']).toBe('https://acme.dental/#organization');
  });

  it('emits telephone, email, openingHours, sameAs when present', () => {
    const graph = buildLocalBusinessSchema(localInput)['@graph'] as Array<Record<string, unknown>>;
    const node = graph.find(n => n['@type'] === 'LocalBusiness') as Record<string, unknown>;
    expect(node.telephone).toBe('+1-512-555-0100');
    expect(node.email).toBe('hi@acme.dental');
    expect(node.openingHours).toBe('Mo-Fr 09:00-17:00');
    expect(node.sameAs).toEqual(['https://twitter.com/acme']);
  });

  it('omits all contact fields when business profile is null (no fabrication)', () => {
    const input = { ...localInput, businessProfile: null };
    const graph = buildLocalBusinessSchema(input)['@graph'] as Array<Record<string, unknown>>;
    const localBusinessNode = graph.find(n => n['@type'] === 'LocalBusiness') as Record<string, unknown>;
    expect(localBusinessNode.telephone).toBeUndefined();
    expect(localBusinessNode.address).toBeUndefined();
    expect(localBusinessNode.email).toBeUndefined();
    expect(localBusinessNode.openingHours).toBeUndefined();
    expect(localBusinessNode.sameAs).toBeUndefined();
  });

  it('passes validator with full profile', () => {
    expect(validateLeanSchema(buildLocalBusinessSchema(localInput), 'LocalBusiness')).toEqual([]);
  });

  it('emits sibling WebSite node — local-business homepages still need site-name + publisher reference', () => {
    const graph = buildLocalBusinessSchema(localInput)['@graph'] as Array<Record<string, unknown>>;
    const websiteNode = graph.find(n => n['@type'] === 'WebSite') as Record<string, unknown>;
    expect(websiteNode).toBeDefined();
    expect(websiteNode['@id']).toBe('https://acme.dental/#website');
    expect(websiteNode.publisher).toEqual({ '@id': 'https://acme.dental/#organization' });
  });

  it('uses publisher.name for LocalBusiness name, not cleanTitle (avoids stripped homepage titles)', () => {
    const graph = buildLocalBusinessSchema(localInput)['@graph'] as Array<Record<string, unknown>>;
    const node = graph.find(n => n['@type'] === 'LocalBusiness') as Record<string, unknown>;
    expect(node.name).toBe('Acme Dental');
  });

  it('LocalBusiness sibling Organization emits knowsAbout when populated', () => {
    const withKeywords = {
      ...localInput,
      pageData: { ...localInput.pageData, knowsAbout: ['dental care', 'cosmetic dentistry'] },
    };
    const schema = buildLocalBusinessSchema(withKeywords);
    const org = (schema['@graph'] as Array<Record<string, unknown>>).find(n => n['@type'] === 'Organization');
    expect(org?.knowsAbout).toEqual(['dental care', 'cosmetic dentistry']);
  });

  it('LocalBusiness emits areaServed as Place when populated', () => {
    const withArea = {
      ...localInput,
      pageData: { ...localInput.pageData, areaServed: 'Austin, TX' },
    };
    const lb = (buildLocalBusinessSchema(withArea)['@graph'] as Array<Record<string, unknown>>).find(n => n['@type'] === 'LocalBusiness');
    expect(lb?.areaServed).toEqual({ '@type': 'Place', name: 'Austin, TX' });
  });
});

const staticInput = {
  baseUrl: 'https://example.com',
  pageData: {
    title: 'About Us',
    cleanTitle: 'About Us',
    description: 'Who we are',
    canonicalUrl: 'https://example.com/about',
    publisher: { name: 'Acme', logoUrl: undefined },
    inLanguage: 'en',
    breadcrumbs: [
      { name: 'Home', url: 'https://example.com' },
      { name: 'About Us', url: 'https://example.com/about' },
    ],
  },
};

describe('static page templates', () => {
  it('AboutPage emits 2 nodes, references Organization', () => {
    const schema = buildAboutPageSchema(staticInput);
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph).toHaveLength(2);
    expect(graph[0]['@type']).toBe('AboutPage');
    expect(graph[0].mainEntity).toEqual({ '@id': 'https://example.com/#organization' });
  });
  it('ContactPage emits 2 nodes', () => {
    const schema = buildContactPageSchema(staticInput);
    expect((schema['@graph'] as unknown[]).length).toBe(2);
    expect(((schema['@graph'] as Array<Record<string, unknown>>)[0])['@type']).toBe('ContactPage');
  });
  it('CollectionPage emits 2 nodes for index pages', () => {
    const schema = buildCollectionPageSchema(staticInput);
    expect(((schema['@graph'] as Array<Record<string, unknown>>)[0])['@type']).toBe('CollectionPage');
  });
  it('WebPage fallback emits 2 nodes', () => {
    const schema = buildWebPageSchema(staticInput);
    expect(((schema['@graph'] as Array<Record<string, unknown>>)[0])['@type']).toBe('WebPage');
  });
  it('AboutPage primary node has isPartOf, breadcrumb, inLanguage', () => {
    const schema = buildAboutPageSchema(staticInput);
    const node = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.isPartOf).toEqual({ '@id': 'https://example.com/#website' });
    expect(node.breadcrumb).toEqual({ '@id': 'https://example.com/about#breadcrumb' });
    expect(node.inLanguage).toBe('en');
  });
  it('WebPage primary node has isPartOf, breadcrumb, inLanguage', () => {
    const schema = buildWebPageSchema(staticInput);
    const node = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.isPartOf).toEqual({ '@id': 'https://example.com/#website' });
    expect(node.breadcrumb).toEqual({ '@id': 'https://example.com/about#breadcrumb' });
    expect(node.inLanguage).toBe('en');
  });
  it('uses cleanTitle, not raw title, for name', () => {
    const dirty = { ...staticInput, pageData: { ...staticInput.pageData, title: 'About Us | Acme', cleanTitle: 'About Us' } };
    const node = (buildWebPageSchema(dirty)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.name).toBe('About Us');
  });
});

describe('Article + BlogPosting — VideoObject enrichment (PR1)', () => {
  const videoElementCatalog = {
    extractedAt: '2026-04-29T00:00:00.000Z',
    sourcePublishedAt: null,
    headings: [],
    tables: [],
    images: [],
    videos: [{
      provider: 'youtube' as const,
      embedUrl: 'https://www.youtube.com/embed/abc12345678',
      thumbnailUrl: 'https://img.youtube.com/vi/abc12345678/maxresdefault.jpg',
      title: 'Web Vitals 101',
    }],
    lists: [],
    testimonials: [],
    codeBlocks: [],
    citations: [],
    diagnostics: { aiClassificationCalls: 0, hitAiBudgetCap: false, rawCounts: {} },
  };

  it('emits VideoObject graph node when pageData.elements.videos has 1+ entries', () => {
    const input = {
      ...baseInput,
      pageData: { ...baseInput.pageData, elements: videoElementCatalog },
    };
    const graph = buildArticleSchema(input, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>;
    const video = graph.find(n => n['@type'] === 'VideoObject');
    expect(video).toBeDefined();
    expect(video!.name).toBe('Web Vitals 101');
    expect(video!.embedUrl).toBe('https://www.youtube.com/embed/abc12345678');
    expect(video!.thumbnailUrl).toBe('https://img.youtube.com/vi/abc12345678/maxresdefault.jpg');
    expect(video!.uploadDate).toBeDefined(); // falls back to article.datePublished
    expect(video!.description).toBeDefined();
  });

  it('does NOT emit VideoObject when pageData.elements.videos is empty or missing', () => {
    const emptyElements = { ...videoElementCatalog, videos: [] };
    const inputEmpty = {
      ...baseInput,
      pageData: { ...baseInput.pageData, elements: emptyElements },
    };
    const graphEmpty = buildArticleSchema(inputEmpty, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>;
    expect(graphEmpty.find(n => n['@type'] === 'VideoObject')).toBeUndefined();

    const inputMissing = { ...baseInput };
    const graphMissing = buildArticleSchema(inputMissing, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>;
    expect(graphMissing.find(n => n['@type'] === 'VideoObject')).toBeUndefined();
  });

  it('does NOT emit VideoObject when pageData.datePublished is undefined (pre-emission gate prevents invalid uploadDate)', () => {
    // VideoObject.uploadDate is required by Google. If pageData.datePublished
    // is undefined (static page without date metadata), emitting the node
    // would produce invalid schema. The template pre-emission gate skips it
    // entirely instead of emitting a node missing a required field.
    const noDateInput = {
      ...baseInput,
      pageData: { ...baseInput.pageData, datePublished: undefined, elements: videoElementCatalog },
    };
    const graph = buildArticleSchema(noDateInput, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find(n => n['@type'] === 'VideoObject')).toBeUndefined();
  });
});

describe('Article + BlogPosting — HowTo enrichment (PR1)', () => {
  const baseElementCatalog = {
    extractedAt: '2026-04-29T00:00:00.000Z',
    sourcePublishedAt: null,
    headings: [],
    tables: [],
    images: [],
    videos: [],
    testimonials: [],
    codeBlocks: [],
    citations: [],
    diagnostics: { aiClassificationCalls: 0, hitAiBudgetCap: false, rawCounts: {} },
  };

  it('emits HowTo graph node when pageData.elements.lists has an isHowToLike entry', () => {
    const input = {
      ...baseInput,
      pageData: {
        ...baseInput.pageData,
        elements: {
          ...baseElementCatalog,
          lists: [{
            kind: 'ordered' as const,
            itemCount: 3,
            isHowToLike: true,
            steps: [
              { name: 'Mix flour, water, salt.', text: 'Mix flour, water, salt.', position: 1 },
              { name: 'Knead for 10 minutes.', text: 'Knead for 10 minutes.', position: 2 },
              { name: 'Bake at 450°F.', text: 'Bake at 450°F.', position: 3 },
            ],
          }],
        },
      },
    };
    const graph = buildArticleSchema(input as never, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>;
    const howTo = graph.find(n => n['@type'] === 'HowTo');
    expect(howTo).toBeDefined();
    expect(howTo!.name).toBeDefined();
    expect(Array.isArray(howTo!.step)).toBe(true);
    expect((howTo!.step as Array<Record<string, unknown>>)).toHaveLength(3);
    expect((howTo!.step as Array<Record<string, unknown>>)[0]['@type']).toBe('HowToStep');
    expect((howTo!.step as Array<Record<string, unknown>>)[0].position).toBe(1);
    expect((howTo!.step as Array<Record<string, unknown>>)[0].text).toBe('Mix flour, water, salt.');
  });

  it('does NOT emit HowTo when no list has isHowToLike: true', () => {
    const input = {
      ...baseInput,
      pageData: {
        ...baseInput.pageData,
        elements: {
          ...baseElementCatalog,
          lists: [{ kind: 'ordered' as const, itemCount: 3, isHowToLike: false }],
        },
      },
    };
    const graph = buildArticleSchema(input as never, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find(n => n['@type'] === 'HowTo')).toBeUndefined();
  });

  it('does NOT emit HowTo when isHowToLike list has no steps', () => {
    const input = {
      ...baseInput,
      pageData: {
        ...baseInput.pageData,
        elements: {
          ...baseElementCatalog,
          lists: [{ kind: 'ordered' as const, itemCount: 3, isHowToLike: true }],
        },
      },
    };
    const graph = buildArticleSchema(input as never, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find(n => n['@type'] === 'HowTo')).toBeUndefined();
  });
});

describe('Article + BlogPosting — citation[] enrichment (PR1)', () => {
  const baseElementCatalogForCitations = {
    extractedAt: '2026-04-29T00:00:00.000Z',
    sourcePublishedAt: null,
    headings: [],
    tables: [],
    images: [],
    videos: [],
    lists: [],
    testimonials: [],
    codeBlocks: [],
    diagnostics: { aiClassificationCalls: 0, hitAiBudgetCap: false, rawCounts: {} },
  };

  it('adds citation[] field to primary node when pageData.elements.citations has entries', () => {
    const input = {
      ...baseInput,
      pageData: {
        ...baseInput.pageData,
        elements: {
          ...baseElementCatalogForCitations,
          citations: [
            { url: 'https://web.dev/vitals', text: 'Google Web Vitals docs', isExternal: true },
            { url: 'https://developer.mozilla.org/web/api', text: 'MDN guide', isExternal: true },
          ],
        },
      },
    };
    const graph = buildArticleSchema(input as never, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>;
    const primary = graph[0];
    const citations = primary.citation as Array<Record<string, unknown>>;
    expect(citations).toHaveLength(2);
    expect(citations[0]['@type']).toBe('WebPage');
    expect(citations[0].url).toBe('https://web.dev/vitals');
    expect(citations[0].name).toBe('Google Web Vitals docs');
  });

  it('does NOT add citation[] when no citations present', () => {
    const input = {
      ...baseInput,
      pageData: {
        ...baseInput.pageData,
        elements: {
          ...baseElementCatalogForCitations,
          citations: [],
        },
      },
    };
    const graph = buildArticleSchema(input as never, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>;
    expect(graph[0].citation).toBeUndefined();
  });
});

describe('buildHomepageSchema', () => {
  const homepageInput = {
    baseUrl: 'https://example.com',
    pageData: {
      title: 'Acme — Homepage',
      cleanTitle: 'Acme — Homepage',
      description: 'Acme is a studio',
      image: 'https://x/hero.jpg',
      canonicalUrl: 'https://example.com',
      publisher: { name: 'Acme', logoUrl: 'https://x/logo.png' },
      inLanguage: 'en',
      breadcrumbs: [{ name: 'Home', url: 'https://example.com' }],
    },
  };

  it('emits Organization + WebSite', () => {
    const schema = buildHomepageSchema(homepageInput);
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph).toHaveLength(2);
    expect(graph[0]['@type']).toBe('Organization');
    expect(graph[1]['@type']).toBe('WebSite');
  });

  it('WebSite publisher references Organization @id', () => {
    const schema = buildHomepageSchema(homepageInput);
    const website = (schema['@graph'] as Array<Record<string, unknown>>)[1];
    expect(website.publisher).toEqual({ '@id': 'https://example.com/#organization' });
  });

  it('passes validator', () => {
    expect(validateLeanSchema(buildHomepageSchema(homepageInput), 'Organization')).toEqual([]);
  });

  it('Organization includes sameAs from businessProfile.socialProfiles', () => {
    const schema = buildHomepageSchema({
      ...homepageInput,
      businessProfile: { socialProfiles: ['https://twitter.com/acme'], foundedDate: '2020-01-01' },
    });
    const org = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(org.sameAs).toEqual(['https://twitter.com/acme']);
    expect(org.foundedDate).toBe('2020-01-01');
  });

  it('WebSite emits inLanguage but NOT potentialAction (no site-search guarantee)', () => {
    // Pillar 2.1: SearchAction misrepresents capability when the site has no
    // search endpoint. Re-add when a workspace flag (siteHasSearch) confirms.
    const schema = buildHomepageSchema(homepageInput);
    const website = (schema['@graph'] as Array<Record<string, unknown>>)[1];
    expect(website.inLanguage).toBe('en');
    expect(website.potentialAction).toBeUndefined();
  });

  it('Organization emits knowsAbout when knowsAbout is populated (top 5, lowercased)', () => {
    const withKeywords = {
      ...homepageInput,
      pageData: { ...homepageInput.pageData, knowsAbout: ['web design', 'webflow', 'brand strategy'] },
    };
    const schema = buildHomepageSchema(withKeywords);
    const org = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(org.knowsAbout).toEqual(['web design', 'webflow', 'brand strategy']);
  });

  it('Organization omits knowsAbout when knowsAbout is undefined or empty', () => {
    const noKeywords = {
      ...homepageInput,
      pageData: { ...homepageInput.pageData, knowsAbout: undefined },
    };
    const org = (buildHomepageSchema(noKeywords)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(org.knowsAbout).toBeUndefined();
  });

  it('WebSite emits potentialAction when siteHasSearch is true', () => {
    const withSearch = {
      ...homepageInput,
      siteHasSearch: true,
    };
    const schema = buildHomepageSchema(withSearch);
    const website = (schema['@graph'] as Array<Record<string, unknown>>).find(n => n['@type'] === 'WebSite');
    expect((website?.potentialAction as Record<string, unknown>)?.['@type']).toBe('SearchAction');
  });

  it('WebSite omits potentialAction when siteHasSearch is false or undefined', () => {
    const noSearch = { ...homepageInput, siteHasSearch: false };
    const website = (buildHomepageSchema(noSearch)['@graph'] as Array<Record<string, unknown>>).find(n => n['@type'] === 'WebSite');
    expect(website?.potentialAction).toBeUndefined();
  });
});
