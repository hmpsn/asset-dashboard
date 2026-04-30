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
    expect(validateLeanSchema(schema, 'BlogPosting')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'BlogPosting',
        field: 'headline',
        ruleId: 'required-field-missing',
      }),
    );
  });

  it('flags missing @context', () => {
    const schema = { '@graph': [{ '@type': 'WebPage', 'name': 'x', 'url': 'https://x/y' }] };
    expect(validateLeanSchema(schema, 'WebPage')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: '@graph',
        ruleId: 'context-missing',
      }),
    );
  });

  it('flags missing @graph', () => {
    const schema = { '@context': 'https://schema.org' };
    expect(validateLeanSchema(schema, 'WebPage')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: '@graph',
        ruleId: 'graph-missing',
      }),
    );
  });

  it('flags Service missing required name + provider', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Service' }],
    };
    const findings = validateLeanSchema(schema, 'Service');
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Service',
        field: 'name',
        ruleId: 'required-field-missing',
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Service',
        field: 'provider',
        ruleId: 'required-field-missing',
      }),
    );
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
    expect(validateLeanSchema(schema, 'WebPage')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'BreadcrumbList',
        field: 'itemListElement.position',
        ruleId: 'breadcrumb-listitem-position-missing',
      }),
    );
  });

  it('flags duplicate @type nodes (the very bug we are fixing)', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', 'name': 'x', 'url': 'https://x' },
        { '@type': 'WebPage', 'name': 'y', 'url': 'https://y' },
      ],
    };
    expect(validateLeanSchema(schema, 'WebPage')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'WebPage',
        ruleId: 'duplicate-type',
      }),
    );
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
    expect(validateLeanSchema(broken, 'WebPage')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'WebPage',
        field: 'isPartOf',
        ruleId: 'required-field-missing',
      }),
    );
  });

  it('flags WebPage missing breadcrumb back-reference', () => {
    const broken = JSON.parse(JSON.stringify(cleanWebPage));
    delete broken['@graph'][0].breadcrumb;
    expect(validateLeanSchema(broken, 'WebPage')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'WebPage',
        field: 'breadcrumb',
        ruleId: 'required-field-missing',
      }),
    );
  });

  it('flags WebPage missing inLanguage', () => {
    const broken = JSON.parse(JSON.stringify(cleanWebPage));
    delete broken['@graph'][0].inLanguage;
    expect(validateLeanSchema(broken, 'WebPage')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'WebPage',
        field: 'inLanguage',
        ruleId: 'required-field-missing',
      }),
    );
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
    expect(validateLeanSchema(article, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Article',
        field: 'image',
        ruleId: 'required-field-missing',
      }),
    );
  });

  // Workspace-data-dependent fields are GOOGLE-RECOMMENDED but not in the required list
  // (Organization.logo, LocalBusiness.address, LocalBusiness.telephone). Workspaces with
  // partially-populated business profiles would otherwise show permanent validation errors
  // even though the schema is valid. These tests assert the graceful-degradation behavior
  // and will be replaced when schema-yoast-parity-fields adds a "recommended" tier.
  it('does NOT flag Organization missing logo (recommended, not required)', () => {
    const org = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Organization', '@id': 'https://x.com/#organization', 'name': 'X', 'url': 'https://x.com' }],
    };
    const findings = validateLeanSchema(org, 'Organization');
    expect(findings.find(f => f.field?.includes('logo') || f.message.includes('logo'))).toBeUndefined();
  });

  it('does NOT flag LocalBusiness missing address or telephone (recommended, not required)', () => {
    const lb = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'LocalBusiness', '@id': 'https://x.com/#localbusiness', 'name': 'X', 'url': 'https://x.com', 'inLanguage': 'en' }],
    };
    const findings = validateLeanSchema(lb, 'LocalBusiness');
    expect(findings.find(f => f.type === 'LocalBusiness' && f.field === 'address' && f.ruleId === 'required-field-missing')).toBeUndefined();
    expect(findings.find(f => f.type === 'LocalBusiness' && f.field === 'telephone' && f.ruleId === 'required-field-missing')).toBeUndefined();
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
    expect(validateLeanSchema(broken, 'WebPage')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'WebPage',
        field: 'isPartOf',
        ruleId: 'cross-ref-ispartof-shape',
      }),
    );
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
    expect(validateLeanSchema(broken, 'WebPage')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'WebPage',
        field: 'breadcrumb',
        ruleId: 'cross-ref-breadcrumb-dangling',
      }),
    );
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

  it('flags Article.author with bad @type (specific message)', () => {
    const broken = article({ author: { '@type': 'CreativeWork', 'name': 'X' } });
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Article',
        field: 'author.@type',
        ruleId: 'article-author-type-invalid',
      }),
    );
  });

  it('flags Article.author missing name (specific message)', () => {
    const broken = article({ author: { '@type': 'Person' } });
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Article',
        field: 'author.name',
        ruleId: 'article-author-name-missing',
      }),
    );
  });

  it('flags Article.author empty-string name', () => {
    const broken = article({ author: { '@type': 'Person', 'name': '   ' } });
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Article',
        field: 'author.name',
        ruleId: 'article-author-name-missing',
      }),
    );
  });

  it('flags Article.publisher missing logo with specific message', () => {
    const broken = article({ publisher: { '@type': 'Organization', 'name': 'X' } });
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Article',
        field: 'publisher.logo',
        ruleId: 'article-publisher-logo-missing',
      }),
    );
  });

  it('flags Article.publisher.logo missing url with specific message', () => {
    const broken = article({ publisher: { '@type': 'Organization', 'name': 'X', 'logo': { '@type': 'ImageObject' } } });
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Article',
        field: 'publisher.logo.url',
        ruleId: 'article-publisher-logo-url-missing',
      }),
    );
  });

  it('flags Article.publisher missing name with specific message', () => {
    const broken = article({ publisher: { '@type': 'Organization', 'logo': { '@type': 'ImageObject', 'url': 'https://x.com/l.png' } } });
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Article',
        field: 'publisher.name',
        ruleId: 'article-publisher-name-missing',
      }),
    );
  });

  it('flags Article.image array containing ImageObject without url', () => {
    const broken = article({ image: [{ '@type': 'ImageObject' }] });
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Article',
        field: 'image',
        ruleId: 'article-image-array-item-shape',
      }),
    );
  });

  it('flags Article.image as bare ImageObject without url', () => {
    const broken = article({ image: { '@type': 'ImageObject' } });
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Article',
        field: 'image',
        ruleId: 'article-image-imageobject-url-missing',
      }),
    );
  });

  it('flags Article.image as non-string non-array non-ImageObject', () => {
    const broken = article({ image: 123 });
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Article',
        field: 'image',
        ruleId: 'article-image-shape-invalid',
      }),
    );
  });

  it('flags Article.datePublished not in ISO 8601 format', () => {
    const broken = article({ datePublished: 'January 1, 2026' });
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Article',
        field: 'datePublished',
        ruleId: 'article-date-iso8601',
      }),
    );
  });

  it('flags Article.dateModified not in ISO 8601 format', () => {
    const broken = article({ dateModified: '01/02/2026' });
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Article',
        field: 'dateModified',
        ruleId: 'article-date-iso8601',
      }),
    );
  });

  it('flags BreadcrumbList positions not starting at 1', () => {
    const broken = JSON.parse(JSON.stringify(article()));
    broken['@graph'][1].itemListElement[0].position = 0;
    broken['@graph'][1].itemListElement[1].position = 1;
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'BreadcrumbList',
        field: 'itemListElement.position',
        ruleId: 'breadcrumb-position-ordering',
      }),
    );
  });

  it('flags BreadcrumbList positions with gaps', () => {
    const broken = JSON.parse(JSON.stringify(article()));
    broken['@graph'][1].itemListElement[1].position = 3;
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'BreadcrumbList',
        field: 'itemListElement.position',
        ruleId: 'breadcrumb-position-ordering',
      }),
    );
  });

  it('flags primary-node url field that is not absolute', () => {
    const broken = article({ url: '/a' });
    expect(validateLeanSchema(broken, 'Article')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'Article',
        field: 'url',
        ruleId: 'url-must-be-absolute',
      }),
    );
  });

  it('does NOT double-report when ListItem.position is missing (validateBreadcrumb owns that error class)', () => {
    const broken = JSON.parse(JSON.stringify(article()));
    delete broken['@graph'][1].itemListElement[0].position;
    const findings = validateLeanSchema(broken, 'Article');
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'BreadcrumbList',
        field: 'itemListElement.position',
        ruleId: 'breadcrumb-listitem-position-missing',
      }),
    );
    expect(findings.find(f => f.ruleId === 'breadcrumb-position-ordering')).toBeUndefined();
  });
});

describe('validateLeanSchema — LocalBusiness value-shape (Pillar 1)', () => {
  const localBusiness = (overrides: Record<string, unknown> = {}) => ({
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'LocalBusiness',
      '@id': 'https://x.com/#localbusiness',
      'name': 'Acme Dental',
      'url': 'https://x.com',
      'inLanguage': 'en',
      ...overrides,
    }],
  });

  it('passes a fully-populated LocalBusiness with PostalAddress', () => {
    const valid = localBusiness({
      address: { '@type': 'PostalAddress', 'streetAddress': '1 Main St', 'addressLocality': 'Austin' },
      telephone: '+1-555-0100',
    });
    expect(validateLeanSchema(valid, 'LocalBusiness')).toEqual([]);
  });

  it('flags LocalBusiness.address as a bare string', () => {
    const broken = localBusiness({ address: '1 Main St, Austin, TX' });
    expect(validateLeanSchema(broken, 'LocalBusiness')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'LocalBusiness',
        field: 'address',
        ruleId: 'localbusiness-address-not-object',
      }),
    );
  });

  it('flags LocalBusiness.address with wrong @type', () => {
    const broken = localBusiness({ address: { '@type': 'Place', 'name': 'Office' } });
    expect(validateLeanSchema(broken, 'LocalBusiness')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'LocalBusiness',
        field: 'address.@type',
        ruleId: 'localbusiness-address-type-invalid',
      }),
    );
  });

  it('flags LocalBusiness.address PostalAddress with no locator fields', () => {
    const broken = localBusiness({ address: { '@type': 'PostalAddress', 'addressCountry': 'US' } });
    expect(validateLeanSchema(broken, 'LocalBusiness')).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        type: 'LocalBusiness',
        field: 'address',
        ruleId: 'localbusiness-address-no-locator',
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // VideoObject + HowTo REQUIRED_BY_TYPE coverage (PR1 page-element catalog).
  // VideoObject thumbnailUrl is intentionally `recommended` not `required` —
  // Vimeo + native videos cannot supply a thumbnail without an API call, and
  // promoting that to required would emit validator errors on every Vimeo page.
  // ---------------------------------------------------------------------------
  describe('VideoObject required fields', () => {
    const fullVideoObject = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'VideoObject',
          '@id': 'https://x/y#video-0',
          'name': 'Demo video',
          'description': 'A walkthrough',
          'uploadDate': '2025-01-15',
          'embedUrl': 'https://www.youtube.com/embed/abc',
          'thumbnailUrl': 'https://img.youtube.com/vi/abc/maxresdefault.jpg',
        },
      ],
    };

    it('passes a VideoObject with all required fields', () => {
      const findings = validateLeanSchema(fullVideoObject, 'BlogPosting').filter(f => f.type === 'VideoObject');
      // No required-field errors (recommended thumbnailUrl IS present here, so no warning either).
      expect(findings.filter(f => f.severity === 'error')).toEqual([]);
    });

    it('flags missing VideoObject.uploadDate as error', () => {
      const broken = JSON.parse(JSON.stringify(fullVideoObject));
      delete broken['@graph'][0].uploadDate;
      const findings = validateLeanSchema(broken, 'BlogPosting');
      expect(findings).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          type: 'VideoObject',
          field: 'uploadDate',
        }),
      );
    });

    it('flags missing VideoObject.name as error', () => {
      const broken = JSON.parse(JSON.stringify(fullVideoObject));
      delete broken['@graph'][0].name;
      const findings = validateLeanSchema(broken, 'BlogPosting');
      expect(findings).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          type: 'VideoObject',
          field: 'name',
        }),
      );
    });

    it('flags missing VideoObject.description as error', () => {
      const broken = JSON.parse(JSON.stringify(fullVideoObject));
      delete broken['@graph'][0].description;
      const findings = validateLeanSchema(broken, 'BlogPosting');
      expect(findings).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          type: 'VideoObject',
          field: 'description',
        }),
      );
    });

    it('does NOT flag missing VideoObject.thumbnailUrl as error (Vimeo + native fallback)', () => {
      const noThumb = JSON.parse(JSON.stringify(fullVideoObject));
      delete noThumb['@graph'][0].thumbnailUrl;
      const findings = validateLeanSchema(noThumb, 'BlogPosting');
      const errors = findings.filter(f => f.type === 'VideoObject' && f.severity === 'error' && f.field === 'thumbnailUrl');
      expect(errors).toEqual([]);
    });
  });

  describe('HowTo required fields', () => {
    const fullHowTo = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'HowTo',
          '@id': 'https://x/y#howto',
          'name': 'How to deploy',
          'step': [
            { '@type': 'HowToStep', 'position': 1, 'name': 'Connect domain', 'text': 'Connect domain' },
            { '@type': 'HowToStep', 'position': 2, 'name': 'Configure DNS', 'text': 'Configure DNS' },
            { '@type': 'HowToStep', 'position': 3, 'name': 'Publish', 'text': 'Publish' },
          ],
        },
      ],
    };

    it('passes a HowTo with name + step', () => {
      const findings = validateLeanSchema(fullHowTo, 'BlogPosting').filter(f => f.type === 'HowTo');
      expect(findings.filter(f => f.severity === 'error')).toEqual([]);
    });

    it('flags missing HowTo.name as error', () => {
      const broken = JSON.parse(JSON.stringify(fullHowTo));
      delete broken['@graph'][0].name;
      const findings = validateLeanSchema(broken, 'BlogPosting');
      expect(findings).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          type: 'HowTo',
          field: 'name',
        }),
      );
    });

    it('flags missing HowTo.step as error', () => {
      const broken = JSON.parse(JSON.stringify(fullHowTo));
      delete broken['@graph'][0].step;
      const findings = validateLeanSchema(broken, 'BlogPosting');
      expect(findings).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          type: 'HowTo',
          field: 'step',
        }),
      );
    });
  });

  describe('Review required fields', () => {
    const fullReview = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Service',
        '@id': 'https://x/y#service',
        'name': 'Web Design',
        'description': 'Premium Webflow.',
        'provider': { '@type': 'Organization', 'name': 'Acme' },
        'isPartOf': { '@id': 'https://x/#website' },
        'breadcrumb': { '@id': 'https://x/y#breadcrumb' },
        'inLanguage': 'en',
      }, {
        '@type': 'Review',
        '@id': 'https://x/y#review-0',
        'itemReviewed': { '@id': 'https://x/y#service' },
        'reviewRating': { '@type': 'Rating', 'ratingValue': 5, 'bestRating': 5 },
        'author': { '@type': 'Person', 'name': 'Jane' },
        'reviewBody': 'Excellent service.',
      }, {
        '@type': 'BreadcrumbList',
        '@id': 'https://x/y#breadcrumb',
        'itemListElement': [
          { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://x' },
          { '@type': 'ListItem', 'position': 2, 'name': 'Web Design', 'item': 'https://x/y' },
        ],
      }],
    };

    it('passes a fully-populated Review', () => {
      const findings = validateLeanSchema(fullReview, 'Service').filter(f => f.type === 'Review');
      expect(findings.filter(f => f.severity === 'error')).toEqual([]);
    });

    it('flags missing Review.itemReviewed as error', () => {
      const broken = JSON.parse(JSON.stringify(fullReview));
      delete broken['@graph'][1].itemReviewed;
      const findings = validateLeanSchema(broken, 'Service');
      expect(findings).toContainEqual(
        expect.objectContaining({ severity: 'error', type: 'Review', field: 'itemReviewed' }),
      );
    });

    it('flags missing Review.reviewRating as error', () => {
      const broken = JSON.parse(JSON.stringify(fullReview));
      delete broken['@graph'][1].reviewRating;
      const findings = validateLeanSchema(broken, 'Service');
      expect(findings).toContainEqual(
        expect.objectContaining({ severity: 'error', type: 'Review', field: 'reviewRating' }),
      );
    });

    it('flags missing Review.author as error', () => {
      const broken = JSON.parse(JSON.stringify(fullReview));
      delete broken['@graph'][1].author;
      const findings = validateLeanSchema(broken, 'Service');
      expect(findings).toContainEqual(
        expect.objectContaining({ severity: 'error', type: 'Review', field: 'author' }),
      );
    });
  });

  describe('AggregateRating required fields', () => {
    const fullAR = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Service',
        '@id': 'https://x/y#service',
        'name': 'Web Design',
        'description': 'Premium Webflow.',
        'provider': { '@type': 'Organization', 'name': 'Acme' },
        'isPartOf': { '@id': 'https://x/#website' },
        'breadcrumb': { '@id': 'https://x/y#breadcrumb' },
        'inLanguage': 'en',
        'aggregateRating': {
          '@type': 'AggregateRating',
          'ratingValue': 4.8,
          'reviewCount': 12,
          'bestRating': 5,
        },
      }, {
        '@type': 'BreadcrumbList',
        '@id': 'https://x/y#breadcrumb',
        'itemListElement': [
          { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://x' },
          { '@type': 'ListItem', 'position': 2, 'name': 'Web Design', 'item': 'https://x/y' },
        ],
      }],
    };

    it('passes a fully-populated AggregateRating', () => {
      const findings = validateLeanSchema(fullAR, 'Service').filter(f => f.type === 'AggregateRating');
      expect(findings.filter(f => f.severity === 'error')).toEqual([]);
    });

    it('flags missing AggregateRating.ratingValue as error', () => {
      const broken = JSON.parse(JSON.stringify(fullAR));
      delete broken['@graph'][0].aggregateRating.ratingValue;
      const findings = validateLeanSchema(broken, 'Service');
      expect(findings).toContainEqual(
        expect.objectContaining({ severity: 'error', type: 'AggregateRating', field: 'ratingValue' }),
      );
    });

    it('flags missing AggregateRating.reviewCount as error', () => {
      const broken = JSON.parse(JSON.stringify(fullAR));
      delete broken['@graph'][0].aggregateRating.reviewCount;
      const findings = validateLeanSchema(broken, 'Service');
      expect(findings).toContainEqual(
        expect.objectContaining({ severity: 'error', type: 'AggregateRating', field: 'reviewCount' }),
      );
    });
  });

  describe('Table required fields', () => {
    const fullTable = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Service',
        '@id': 'https://x/y#service',
        'name': 'Web Design',
        'description': 'Premium Webflow.',
        'provider': { '@type': 'Organization', 'name': 'Acme' },
        'isPartOf': { '@id': 'https://x/#website' },
        'breadcrumb': { '@id': 'https://x/y#breadcrumb' },
        'inLanguage': 'en',
        'mainEntity': {
          '@type': 'Table',
          '@id': 'https://x/y#table-0',
          'about': 'Pricing tiers',
        },
      }, {
        '@type': 'BreadcrumbList',
        '@id': 'https://x/y#breadcrumb',
        'itemListElement': [
          { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://x' },
          { '@type': 'ListItem', 'position': 2, 'name': 'Web Design', 'item': 'https://x/y' },
        ],
      }],
    };

    it('passes a Table with about populated', () => {
      const findings = validateLeanSchema(fullTable, 'Service').filter(f => f.type === 'Table');
      expect(findings.filter(f => f.severity === 'error')).toEqual([]);
    });

    it('flags missing Table.about as error', () => {
      const broken = JSON.parse(JSON.stringify(fullTable));
      delete broken['@graph'][0].mainEntity.about;
      const findings = validateLeanSchema(broken, 'Service');
      expect(findings).toContainEqual(
        expect.objectContaining({ severity: 'error', type: 'Table', field: 'about' }),
      );
    });
  });

  describe('ImageGallery required fields', () => {
    const fullGallery = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Service',
        '@id': 'https://x/y#service',
        'name': 'Web Design',
        'description': 'Premium Webflow.',
        'provider': { '@type': 'Organization', 'name': 'Acme' },
        'isPartOf': { '@id': 'https://x/#website' },
        'breadcrumb': { '@id': 'https://x/y#breadcrumb' },
        'inLanguage': 'en',
      }, {
        '@type': 'ImageGallery',
        '@id': 'https://x/y#gallery',
        'name': 'Project gallery',
        'image': ['https://x/img1.jpg', 'https://x/img2.jpg'],
      }, {
        '@type': 'BreadcrumbList',
        '@id': 'https://x/y#breadcrumb',
        'itemListElement': [
          { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://x' },
          { '@type': 'ListItem', 'position': 2, 'name': 'Web Design', 'item': 'https://x/y' },
        ],
      }],
    };

    it('passes a fully-populated ImageGallery', () => {
      const findings = validateLeanSchema(fullGallery, 'Service').filter(f => f.type === 'ImageGallery');
      expect(findings.filter(f => f.severity === 'error')).toEqual([]);
    });

    it('flags missing ImageGallery.name as error', () => {
      const broken = JSON.parse(JSON.stringify(fullGallery));
      delete broken['@graph'][1].name;
      const findings = validateLeanSchema(broken, 'Service');
      expect(findings).toContainEqual(
        expect.objectContaining({ severity: 'error', type: 'ImageGallery', field: 'name' }),
      );
    });

    it('flags missing ImageGallery.image as error', () => {
      const broken = JSON.parse(JSON.stringify(fullGallery));
      delete broken['@graph'][1].image;
      const findings = validateLeanSchema(broken, 'Service');
      expect(findings).toContainEqual(
        expect.objectContaining({ severity: 'error', type: 'ImageGallery', field: 'image' }),
      );
    });
  });
});
