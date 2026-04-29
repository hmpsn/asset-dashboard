import { describe, it, expect } from 'vitest';
import { validateLeanSchema } from '../../../server/schema/validator.js';

describe('validateLeanSchema', () => {
  it('passes a fully-populated BlogPosting', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BlogPosting',
          '@id': 'https://x/y#article',
          'headline': 'Title',
          'description': 'Body',
          'image': 'https://x/i.jpg',
          'datePublished': '2025-01-15T00:00:00Z',
          'dateModified': '2025-02-01T00:00:00Z',
          'author': { '@type': 'Organization', 'name': 'Acme' },
          'publisher': { '@type': 'Organization', 'name': 'Acme', 'logo': { '@type': 'ImageObject', 'url': 'https://x/logo.png' } },
          'mainEntityOfPage': { '@type': 'WebPage', '@id': 'https://x/y' },
          'isPartOf': { '@id': 'https://x/#website' },
          'breadcrumb': { '@id': 'https://x/y#breadcrumb' },
          'inLanguage': 'en',
          'articleSection': 'Blog',
        },
        {
          '@type': 'BreadcrumbList',
          '@id': 'https://x/y#breadcrumb',
          'itemListElement': [
            { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://x' },
            { '@type': 'ListItem', 'position': 2, 'name': 'Title', 'item': 'https://x/y' },
          ],
        },
      ],
    };
    expect(validateLeanSchema(schema, 'BlogPosting')).toEqual([]);
  });

  it('flags BlogPosting missing headline', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'BlogPosting', 'datePublished': '2025-01-15T00:00:00Z' }],
    };
    expect(validateLeanSchema(schema, 'BlogPosting')).toContain('BlogPosting missing required field: headline');
  });

  it('flags missing @context', () => {
    const schema = { '@graph': [{ '@type': 'WebPage', 'name': 'x', 'url': 'https://x/y' }] };
    expect(validateLeanSchema(schema, 'WebPage')).toContain('Schema missing @context');
  });

  it('flags missing @graph', () => {
    const schema = { '@context': 'https://schema.org' };
    expect(validateLeanSchema(schema, 'WebPage')).toContain('Schema missing @graph array');
  });

  it('flags Service missing required name + provider', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Service' }],
    };
    const errors = validateLeanSchema(schema, 'Service');
    expect(errors).toContain('Service missing required field: name');
    expect(errors).toContain('Service missing required field: provider');
  });

  it('passes Article + BreadcrumbList combo', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Article',
          '@id': 'https://x/y#article',
          'headline': 'X',
          'description': 'Y',
          'image': 'https://x/i.jpg',
          'datePublished': '2025-01-15T00:00:00Z',
          'dateModified': '2025-02-01T00:00:00Z',
          'author': { '@type': 'Organization', 'name': 'A' },
          'publisher': { '@type': 'Organization', 'name': 'A', 'logo': { '@type': 'ImageObject', 'url': 'https://x/logo.png' } },
          'mainEntityOfPage': { '@type': 'WebPage', '@id': 'https://x/y' },
          'isPartOf': { '@id': 'https://x/#website' },
          'breadcrumb': { '@id': 'https://x/y#breadcrumb' },
          'inLanguage': 'en',
        },
        {
          '@type': 'BreadcrumbList',
          '@id': 'https://x/y#breadcrumb',
          'itemListElement': [
            { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://x' },
            { '@type': 'ListItem', 'position': 2, 'name': 'Page', 'item': 'https://x/y' },
          ],
        },
      ],
    };
    expect(validateLeanSchema(schema, 'Article')).toEqual([]);
  });

  it('flags BreadcrumbList missing position on a ListItem', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', 'name': 'x', 'url': 'https://x' },
        {
          '@type': 'BreadcrumbList',
          'itemListElement': [{ '@type': 'ListItem', 'name': 'Home', 'item': 'https://x' }],
        },
      ],
    };
    expect(validateLeanSchema(schema, 'WebPage')).toContain('BreadcrumbList ListItem missing position');
  });

  it('flags duplicate @type nodes (the very bug we are fixing)', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', 'name': 'x', 'url': 'https://x' },
        { '@type': 'WebPage', 'name': 'y', 'url': 'https://y' },
      ],
    };
    expect(validateLeanSchema(schema, 'WebPage')).toContain('Duplicate @type in @graph: WebPage (lean output must emit exactly one primary node + optional BreadcrumbList)');
  });

  it('passes Homepage (Organization + WebSite)', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': 'https://x/#organization',
          'name': 'X',
          'url': 'https://x',
          'logo': { '@type': 'ImageObject', 'url': 'https://x/logo.png' },
        },
        {
          '@type': 'WebSite',
          '@id': 'https://x/#website',
          'name': 'X',
          'url': 'https://x',
          'publisher': { '@id': 'https://x/#organization' },
          'inLanguage': 'en',
        },
      ],
    };
    expect(validateLeanSchema(schema, 'Organization')).toEqual([]);
  });
});

describe('validateLeanSchema — Yoast-baseline required fields (Pillar 1)', () => {
  const cleanWebPage = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': 'https://x.com/p#webpage',
        'name': 'P',
        'url': 'https://x.com/p',
        'description': 'D',
        'isPartOf': { '@id': 'https://x.com/#website' },
        'breadcrumb': { '@id': 'https://x.com/p#breadcrumb' },
        'inLanguage': 'en',
      },
      {
        '@type': 'BreadcrumbList',
        '@id': 'https://x.com/p#breadcrumb',
        'itemListElement': [
          { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://x.com' },
          { '@type': 'ListItem', 'position': 2, 'name': 'P', 'item': 'https://x.com/p' },
        ],
      },
    ],
  };

  it('passes a fully-populated WebPage', () => {
    expect(validateLeanSchema(cleanWebPage, 'WebPage')).toEqual([]);
  });

  it('flags WebPage missing isPartOf', () => {
    const broken = JSON.parse(JSON.stringify(cleanWebPage));
    delete broken['@graph'][0].isPartOf;
    expect(validateLeanSchema(broken, 'WebPage')).toContain('WebPage missing required field: isPartOf');
  });

  it('flags WebPage missing breadcrumb back-reference', () => {
    const broken = JSON.parse(JSON.stringify(cleanWebPage));
    delete broken['@graph'][0].breadcrumb;
    expect(validateLeanSchema(broken, 'WebPage')).toContain('WebPage missing required field: breadcrumb');
  });

  it('flags WebPage missing inLanguage', () => {
    const broken = JSON.parse(JSON.stringify(cleanWebPage));
    delete broken['@graph'][0].inLanguage;
    expect(validateLeanSchema(broken, 'WebPage')).toContain('WebPage missing required field: inLanguage');
  });

  it('flags Article missing image', () => {
    const article = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Article',
        '@id': 'https://x.com/a#article',
        'headline': 'H',
        'datePublished': '2026-01-01T00:00:00Z',
        'dateModified': '2026-01-02T00:00:00Z',
        'author': { '@type': 'Organization', 'name': 'X' },
        'publisher': { '@type': 'Organization', 'name': 'X' },
        'mainEntityOfPage': { '@id': 'https://x.com/a' },
        'isPartOf': { '@id': 'https://x.com/#website' },
        'breadcrumb': { '@id': 'https://x.com/a#breadcrumb' },
        'inLanguage': 'en',
      }],
    };
    expect(validateLeanSchema(article, 'Article')).toContain('Article missing required field: image');
  });

  it('flags Organization missing logo', () => {
    const org = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Organization', '@id': 'https://x.com/#organization', 'name': 'X', 'url': 'https://x.com' }],
    };
    expect(validateLeanSchema(org, 'Organization')).toContain('Organization missing required field: logo');
  });

  // Pillar 2.1 dropped the unconditional SearchAction emission, so the WebSite
  // required-set no longer includes potentialAction. When schema-yoast-parity-fields
  // re-introduces SearchAction behind a workspace flag, add a conditional test here.

  it('flags LocalBusiness missing address', () => {
    const lb = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'LocalBusiness', '@id': 'https://x.com/#localbusiness', 'name': 'X', 'url': 'https://x.com', 'telephone': '+1-555-0100' }],
    };
    expect(validateLeanSchema(lb, 'LocalBusiness')).toContain('LocalBusiness missing required field: address');
  });

  it('flags LocalBusiness missing telephone', () => {
    const lb = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'LocalBusiness', '@id': 'https://x.com/#localbusiness', 'name': 'X', 'url': 'https://x.com', 'address': { '@type': 'PostalAddress', 'streetAddress': '1 Main St' } }],
    };
    expect(validateLeanSchema(lb, 'LocalBusiness')).toContain('LocalBusiness missing required field: telephone');
  });
});

describe('validateLeanSchema — cross-reference shape (Pillar 1)', () => {
  it('flags isPartOf that is not an @id reference', () => {
    const broken = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'WebPage', '@id': 'https://x.com/p#webpage', 'name': 'P', 'url': 'https://x.com/p',
        'description': 'D', 'inLanguage': 'en',
        'isPartOf': 'https://x.com',
        'breadcrumb': { '@id': 'https://x.com/p#breadcrumb' },
      }],
    };
    expect(validateLeanSchema(broken, 'WebPage')).toContain('WebPage.isPartOf must be an @id reference (e.g. {"@id": "...#website"})');
  });

  it('flags breadcrumb that points to a missing BreadcrumbList', () => {
    const broken = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'WebPage', '@id': 'https://x.com/p#webpage', 'name': 'P', 'url': 'https://x.com/p',
        'description': 'D', 'inLanguage': 'en',
        'isPartOf': { '@id': 'https://x.com/#website' },
        'breadcrumb': { '@id': 'https://x.com/p#breadcrumb' },
      }],
    };
    expect(validateLeanSchema(broken, 'WebPage')).toContain('WebPage.breadcrumb references @id "https://x.com/p#breadcrumb" but no BreadcrumbList with that @id is in the @graph');
  });
});

describe('validateLeanSchema — value-shape validators (Pillar 1)', () => {
  const article = (overrides: Record<string, unknown> = {}) => ({
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'Article', '@id': 'https://x.com/a#article', 'headline': 'H',
      'description': 'D', 'image': ['https://x.com/i.jpg'], 'url': 'https://x.com/a',
      'datePublished': '2026-01-01T00:00:00Z', 'dateModified': '2026-01-02T00:00:00Z',
      'mainEntityOfPage': { '@id': 'https://x.com/a' },
      'author': { '@type': 'Person', 'name': 'Jane Doe' },
      'publisher': { '@type': 'Organization', 'name': 'X', 'logo': { '@type': 'ImageObject', 'url': 'https://x.com/logo.png' } },
      'isPartOf': { '@id': 'https://x.com/#website' },
      'breadcrumb': { '@id': 'https://x.com/a#breadcrumb' },
      'inLanguage': 'en',
      ...overrides,
    }, {
      '@type': 'BreadcrumbList', '@id': 'https://x.com/a#breadcrumb',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://x.com' },
        { '@type': 'ListItem', 'position': 2, 'name': 'A', 'item': 'https://x.com/a' },
      ],
    }],
  });

  it('passes a fully shape-correct Article', () => {
    expect(validateLeanSchema(article(), 'Article')).toEqual([]);
  });

  it('flags Article.author missing @type', () => {
    const broken = article({ author: { name: 'Jane Doe' } });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.author must have @type ∈ {Person, Organization} and non-empty name');
  });

  it('flags Article.author missing name', () => {
    const broken = article({ author: { '@type': 'Person' } });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.author must have @type ∈ {Person, Organization} and non-empty name');
  });

  it('flags Article.author with bad @type', () => {
    const broken = article({ author: { '@type': 'CreativeWork', 'name': 'X' } });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.author must have @type ∈ {Person, Organization} and non-empty name');
  });

  it('flags Article.publisher missing logo (Google Rich Results requires it)', () => {
    const broken = article({ publisher: { '@type': 'Organization', 'name': 'X' } });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.publisher must have @type, name, and logo (ImageObject with url) — Google Article rich result requires the publisher logo');
  });

  it('flags Article.publisher.logo missing url', () => {
    const broken = article({ publisher: { '@type': 'Organization', 'name': 'X', 'logo': { '@type': 'ImageObject' } } });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.publisher must have @type, name, and logo (ImageObject with url) — Google Article rich result requires the publisher logo');
  });

  it('flags Article.image as non-string non-array non-ImageObject', () => {
    const broken = article({ image: 123 });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.image must be a string URL, an array of strings/ImageObjects, or an ImageObject');
  });

  it('flags Article.datePublished not in ISO 8601 format', () => {
    const broken = article({ datePublished: 'January 1, 2026' });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.datePublished must be ISO 8601 (e.g. "2026-01-15T00:00:00Z")');
  });

  it('flags Article.dateModified not in ISO 8601 format', () => {
    const broken = article({ dateModified: '01/02/2026' });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.dateModified must be ISO 8601 (e.g. "2026-01-15T00:00:00Z")');
  });

  it('flags BreadcrumbList positions not starting at 1', () => {
    const broken = JSON.parse(JSON.stringify(article()));
    broken['@graph'][1].itemListElement[0].position = 0;
    broken['@graph'][1].itemListElement[1].position = 1;
    expect(validateLeanSchema(broken, 'Article')).toContain('BreadcrumbList itemListElement positions must start at 1 and be contiguous-ascending');
  });

  it('flags BreadcrumbList positions with gaps', () => {
    const broken = JSON.parse(JSON.stringify(article()));
    broken['@graph'][1].itemListElement[1].position = 3;
    expect(validateLeanSchema(broken, 'Article')).toContain('BreadcrumbList itemListElement positions must start at 1 and be contiguous-ascending');
  });

  it('flags primary-node url field that is not absolute', () => {
    const broken = article({ url: '/a' });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.url must be an absolute URL (start with http:// or https://)');
  });
});
