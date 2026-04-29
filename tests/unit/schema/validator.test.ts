import { describe, it, expect } from 'vitest';
import { validateLeanSchema } from '../../../server/schema/validator.js';

describe('validateLeanSchema', () => {
  it('passes a minimal valid BlogPosting', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BlogPosting',
          'headline': 'Title',
          'description': 'Body',
          'datePublished': '2025-01-15T00:00:00Z',
          'author': { '@type': 'Organization', 'name': 'Acme' },
          'publisher': { '@type': 'Organization', 'name': 'Acme', 'logo': { '@type': 'ImageObject', 'url': 'https://x/y.png' } },
          'mainEntityOfPage': { '@type': 'WebPage', '@id': 'https://x/y' },
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
          'headline': 'X',
          'description': 'Y',
          'datePublished': '2025-01-15T00:00:00Z',
          'author': { '@type': 'Organization', 'name': 'A' },
          'publisher': { '@type': 'Organization', 'name': 'A' },
          'mainEntityOfPage': { '@type': 'WebPage', '@id': 'https://x/y' },
        },
        {
          '@type': 'BreadcrumbList',
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
        { '@type': 'Organization', '@id': 'https://x/#organization', 'name': 'X', 'url': 'https://x' },
        { '@type': 'WebSite', '@id': 'https://x/#website', 'name': 'X', 'url': 'https://x', 'publisher': { '@id': 'https://x/#organization' } },
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
