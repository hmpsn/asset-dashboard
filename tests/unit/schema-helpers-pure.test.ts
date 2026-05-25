/**
 * Pure-function unit tests for schema template helpers and site-inventory utilities.
 *
 * All functions under test are deterministic with no I/O side effects — no DB,
 * no network, no file system mocks required.
 */
import { describe, it, expect } from 'vitest';

import {
  dropUndefined,
  filterHttpUrls,
  buildBreadcrumb,
  orgRef,
  localBusinessRef,
  imageNode,
  webSiteRef,
  breadcrumbRef,
  scrubBrandSuffix,
  withBreadcrumb,
} from '../../server/schema/templates/helpers.js';

import {
  isUtilitySchemaPath,
  detectSchemaFieldTarget,
  isOpaqueWebflowIdentifier,
} from '../../server/schema/site-inventory.js';

// ---------------------------------------------------------------------------
// dropUndefined
// ---------------------------------------------------------------------------

describe('dropUndefined', () => {
  it('removes keys with undefined values', () => {
    const obj = { a: 'hello', b: undefined, c: 42, d: undefined };
    expect(dropUndefined(obj)).toEqual({ a: 'hello', c: 42 });
  });

  it('keeps null and false and 0 (only strips undefined)', () => {
    const obj = { a: null, b: false, c: 0, d: '' };
    expect(dropUndefined(obj)).toEqual({ a: null, b: false, c: 0, d: '' });
  });

  it('returns empty object when all values are undefined', () => {
    expect(dropUndefined({ x: undefined, y: undefined })).toEqual({});
  });

  it('returns same shape when no undefined values exist', () => {
    const obj = { name: 'Test', url: 'https://example.com' };
    expect(dropUndefined(obj)).toEqual(obj);
  });
});

// ---------------------------------------------------------------------------
// filterHttpUrls
// ---------------------------------------------------------------------------

describe('filterHttpUrls', () => {
  it('passes http and https URLs through', () => {
    const urls = ['https://example.com/image.jpg', 'http://cdn.example.com/logo.png'];
    expect(filterHttpUrls(urls)).toEqual(urls);
  });

  it('strips javascript: URLs', () => {
    expect(filterHttpUrls(['javascript:void(0)', 'https://example.com/ok.jpg'])).toEqual([
      'https://example.com/ok.jpg',
    ]);
  });

  it('strips data: URLs', () => {
    const dataUrl = 'data:image/png;base64,abc123';
    expect(filterHttpUrls([dataUrl, 'https://ok.com/img.png'])).toEqual(['https://ok.com/img.png']);
  });

  it('strips file: URLs', () => {
    expect(filterHttpUrls(['file:///etc/passwd'])).toEqual([]);
  });

  it('strips malformed / relative URLs', () => {
    expect(filterHttpUrls(['/relative/path', '//scheme-less.com/img.jpg'])).toEqual([]);
  });

  it('returns empty array from empty input', () => {
    expect(filterHttpUrls([])).toEqual([]);
  });

  it('skips empty strings', () => {
    expect(filterHttpUrls(['', 'https://example.com/valid.jpg'])).toEqual([
      'https://example.com/valid.jpg',
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildBreadcrumb
// ---------------------------------------------------------------------------

describe('buildBreadcrumb', () => {
  const BASE = 'https://example.com';

  it('returns undefined for single-item breadcrumb (only home)', () => {
    const items = [{ name: 'Home', url: `${BASE}` }];
    expect(buildBreadcrumb(items, `${BASE}/about`)).toBeUndefined();
  });

  it('returns undefined for empty breadcrumbs', () => {
    expect(buildBreadcrumb([], `${BASE}/about`)).toBeUndefined();
  });

  it('builds a BreadcrumbList for two-item breadcrumbs', () => {
    const items = [
      { name: 'Home', url: BASE },
      { name: 'About', url: `${BASE}/about` },
    ];
    const result = buildBreadcrumb(items, `${BASE}/about`);
    expect(result).toBeDefined();
    expect(result?.['@type']).toBe('BreadcrumbList');
    expect(result?.['@id']).toBe(`${BASE}/about#breadcrumb`);
    const elements = result?.itemListElement as Array<Record<string, unknown>>;
    expect(elements).toHaveLength(2);
    expect(elements[0].position).toBe(1);
    expect(elements[0].name).toBe('Home');
    expect(elements[1].position).toBe(2);
    expect(elements[1].name).toBe('About');
  });

  it('builds a BreadcrumbList for three-item breadcrumbs', () => {
    const items = [
      { name: 'Home', url: BASE },
      { name: 'Blog', url: `${BASE}/blog` },
      { name: 'Post Title', url: `${BASE}/blog/post` },
    ];
    const result = buildBreadcrumb(items, `${BASE}/blog/post`);
    expect(result?.['@type']).toBe('BreadcrumbList');
    const elements = result?.itemListElement as Array<Record<string, unknown>>;
    expect(elements).toHaveLength(3);
  });

  it('omits single-segment utility-like paths from breadcrumb', () => {
    // "book-a-call" is in the STANDALONE_BREADCRUMB_OMIT_SEGMENTS set
    const items = [
      { name: 'Home', url: BASE },
      { name: 'Book a Call', url: `${BASE}/book-a-call` },
    ];
    const result = buildBreadcrumb(items, `${BASE}/book-a-call`);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// orgRef / localBusinessRef / webSiteRef
// ---------------------------------------------------------------------------

describe('orgRef', () => {
  it('returns an @id reference to the organization node', () => {
    expect(orgRef('https://example.com')).toEqual({ '@id': 'https://example.com/#organization' });
  });
});

describe('localBusinessRef', () => {
  it('returns an @id reference to the local business node', () => {
    expect(localBusinessRef('https://example.com')).toEqual({
      '@id': 'https://example.com/#localbusiness',
    });
  });
});

describe('webSiteRef', () => {
  it('returns an @id reference to the website node', () => {
    expect(webSiteRef('https://example.com')).toEqual({ '@id': 'https://example.com/#website' });
  });
});

// ---------------------------------------------------------------------------
// imageNode
// ---------------------------------------------------------------------------

describe('imageNode', () => {
  it('wraps a URL in an ImageObject shape', () => {
    expect(imageNode('https://example.com/logo.png')).toEqual({
      '@type': 'ImageObject',
      url: 'https://example.com/logo.png',
    });
  });

  it('returns undefined for empty string', () => {
    expect(imageNode('')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(imageNode(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// breadcrumbRef
// ---------------------------------------------------------------------------

describe('breadcrumbRef', () => {
  const BASE = 'https://example.com';

  it('returns an @id reference when a breadcrumb should be emitted', () => {
    const items = [
      { name: 'Home', url: BASE },
      { name: 'Services', url: `${BASE}/services` },
      { name: 'SEO', url: `${BASE}/services/seo` },
    ];
    const ref = breadcrumbRef(`${BASE}/services/seo`, items);
    expect(ref).toEqual({ '@id': `${BASE}/services/seo#breadcrumb` });
  });

  it('returns undefined when breadcrumb should not be emitted (single item)', () => {
    const items = [{ name: 'Home', url: BASE }];
    expect(breadcrumbRef(`${BASE}/about`, items)).toBeUndefined();
  });

  it('returns undefined for empty breadcrumbs', () => {
    expect(breadcrumbRef(`${BASE}/about`, [])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// withBreadcrumb
// ---------------------------------------------------------------------------

describe('withBreadcrumb', () => {
  const BASE = 'https://example.com';
  const pageData = {
    title: 'About Us',
    cleanTitle: 'About Us',
    description: 'About page',
    canonicalUrl: `${BASE}/about`,
    publisher: { name: 'Acme' },
    inLanguage: 'en',
    breadcrumbs: [
      { name: 'Home', url: BASE },
      { name: 'About', url: `${BASE}/about` },
    ],
  } as Parameters<typeof withBreadcrumb>[1];

  it('wraps a single primary node in @context + @graph', () => {
    const primary = { '@type': 'AboutPage', '@id': `${BASE}/about#aboutpage`, name: 'About Us' };
    const schema = withBreadcrumb(primary, pageData);
    expect(schema['@context']).toBe('https://schema.org');
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph[0]['@type']).toBe('AboutPage');
  });

  it('appends BreadcrumbList when breadcrumbs have 2+ items', () => {
    const primary = { '@type': 'AboutPage', '@id': `${BASE}/about#aboutpage`, name: 'About' };
    const schema = withBreadcrumb(primary, pageData);
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const breadcrumbNode = graph.find(n => n['@type'] === 'BreadcrumbList');
    expect(breadcrumbNode).toBeDefined();
  });

  it('does NOT append BreadcrumbList when breadcrumbs have fewer than 2 items', () => {
    const pd = { ...pageData, breadcrumbs: [{ name: 'Home', url: BASE }] } as typeof pageData;
    const primary = { '@type': 'WebPage', '@id': `${BASE}/#webpage`, name: 'Home' };
    const schema = withBreadcrumb(primary, pd);
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph.every(n => n['@type'] !== 'BreadcrumbList')).toBe(true); // every-ok: graph always has primary node
  });

  it('accepts an array of primary nodes', () => {
    const primary = [
      { '@type': 'AboutPage', '@id': `${BASE}/about#aboutpage`, name: 'About' },
      { '@type': 'Person', '@id': `${BASE}/about#person-0`, name: 'Jane' },
    ];
    const schema = withBreadcrumb(primary, pageData);
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph.some(n => n['@type'] === 'AboutPage')).toBe(true);
    expect(graph.some(n => n['@type'] === 'Person')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scrubBrandSuffix
// ---------------------------------------------------------------------------

describe('scrubBrandSuffix', () => {
  it('strips " | Brand" suffix (pipe separator)', () => {
    expect(scrubBrandSuffix('Privacy Policy | Acme Studio', 'Acme Studio')).toBe('Privacy Policy');
  });

  it('strips " - Brand" suffix (hyphen separator)', () => {
    expect(scrubBrandSuffix('Our Services - Acme Studio', 'Acme Studio')).toBe('Our Services');
  });

  it('strips " — Brand" suffix (em-dash separator)', () => {
    expect(scrubBrandSuffix('Contact — Acme Studio', 'Acme Studio')).toBe('Contact');
  });

  it('strips " · Brand" suffix (middle dot separator)', () => {
    expect(scrubBrandSuffix('Blog · Acme Studio', 'Acme Studio')).toBe('Blog');
  });

  it('does NOT strip when suffix does not match the brand', () => {
    expect(scrubBrandSuffix('Acme | Other Co', 'Acme Studio')).toBe('Acme | Other Co');
  });

  it('leaves title unchanged when no separator is present', () => {
    expect(scrubBrandSuffix('Privacy Policy', 'Acme Studio')).toBe('Privacy Policy');
  });

  it('is case-insensitive on the brand name', () => {
    expect(scrubBrandSuffix('About | acme studio', 'Acme Studio')).toBe('About');
  });

  it('handles empty brand gracefully', () => {
    expect(scrubBrandSuffix('Privacy Policy | Acme', '')).toBe('Privacy Policy | Acme');
  });

  it('handles brand name containing regex special characters', () => {
    expect(scrubBrandSuffix('Page | Acme (Studio)', 'Acme (Studio)')).toBe('Page');
  });
});

// ---------------------------------------------------------------------------
// isUtilitySchemaPath
// ---------------------------------------------------------------------------

describe('isUtilitySchemaPath', () => {
  it('identifies error pages as utility', () => {
    expect(isUtilitySchemaPath('/404')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/500')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/401')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/403')).toMatchObject({ isUtility: true });
  });

  it('identifies auth/system pages as utility', () => {
    expect(isUtilitySchemaPath('/login')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/signin')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/members/login')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/search')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/password')).toMatchObject({ isUtility: true });
  });

  it('identifies post-conversion pages as utility', () => {
    expect(isUtilitySchemaPath('/thank-you')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/thanks')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/success')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/confirmation')).toMatchObject({ isUtility: true });
    expect(isUtilitySchemaPath('/confirmed')).toMatchObject({ isUtility: true });
  });

  it('identifies nested utility paths', () => {
    expect(isUtilitySchemaPath('/blog/thank-you')).toMatchObject({ isUtility: true });
  });

  it('marks content pages as NOT utility', () => {
    expect(isUtilitySchemaPath('/blog/how-to-floss')).toMatchObject({ isUtility: false });
    expect(isUtilitySchemaPath('/services/seo')).toMatchObject({ isUtility: false });
    expect(isUtilitySchemaPath('/about')).toMatchObject({ isUtility: false });
  });

  it('returns reason string for utility pages', () => {
    const result = isUtilitySchemaPath('/404');
    expect(result.isUtility).toBe(true);
    expect(typeof result.reason).toBe('string');
    expect(result.reason!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// detectSchemaFieldTarget
// ---------------------------------------------------------------------------

describe('detectSchemaFieldTarget', () => {
  function field(slug: string, displayName = slug, type = 'PlainText') {
    return { id: slug, slug, displayName, type };
  }

  it('detects schema JSON-LD fields', () => {
    expect(detectSchemaFieldTarget(field('schema-json-ld'))).toBe('schemaJsonLd');
    expect(detectSchemaFieldTarget(field('jsonld', 'JSON-LD'))).toBe('schemaJsonLd');
  });

  it('detects author fields', () => {
    expect(detectSchemaFieldTarget(field('author'))).toBe('author');
    expect(detectSchemaFieldTarget(field('written-by', 'Written By'))).toBe('author');
  });

  it('detects image fields', () => {
    expect(detectSchemaFieldTarget(field('hero-image', 'Hero Image'))).toBe('image');
    expect(detectSchemaFieldTarget(field('thumbnail'))).toBe('image');
    expect(detectSchemaFieldTarget(field('cover-photo', 'Cover Photo'))).toBe('image');
  });

  it('detects date fields', () => {
    expect(detectSchemaFieldTarget(field('published', 'Published Date'))).toBe('datePublished');
    expect(detectSchemaFieldTarget(field('publish-date'))).toBe('datePublished');
    expect(detectSchemaFieldTarget(field('updated', 'Last Updated'))).toBe('dateModified');
    expect(detectSchemaFieldTarget(field('last-updated'))).toBe('dateModified');
  });

  it('detects address fields', () => {
    expect(detectSchemaFieldTarget(field('street-address'))).toBe('streetAddress');
    expect(detectSchemaFieldTarget(field('city'))).toBe('addressLocality');
    expect(detectSchemaFieldTarget(field('state'))).toBe('addressRegion');
    expect(detectSchemaFieldTarget(field('zip', 'Zip Code'))).toBe('postalCode');
    expect(detectSchemaFieldTarget(field('country'))).toBe('addressCountry');
  });

  it('detects contact fields', () => {
    expect(detectSchemaFieldTarget(field('phone', 'Phone Number'))).toBe('phone');
    expect(detectSchemaFieldTarget(field('email'))).toBe('email');
  });

  it('detects hours fields', () => {
    expect(detectSchemaFieldTarget(field('business-hours'))).toBe('openingHours');
    expect(detectSchemaFieldTarget(field('opening-hours', 'Opening Hours'))).toBe('openingHours');
  });

  it('detects price and currency fields', () => {
    expect(detectSchemaFieldTarget(field('price'))).toBe('price');
    expect(detectSchemaFieldTarget(field('currency'))).toBe('priceCurrency');
  });

  it('returns undefined for unrecognized fields', () => {
    expect(detectSchemaFieldTarget(field('random-field', 'Random Field'))).toBeUndefined();
    expect(detectSchemaFieldTarget(field('custom-color'))).toBeUndefined();
  });

  it('detects video fields', () => {
    expect(detectSchemaFieldTarget(field('youtube-url', 'YouTube URL'))).toBe('videoUrl');
    expect(detectSchemaFieldTarget(field('video-embed', 'Video'))).toBe('videoUrl');
  });
});

// ---------------------------------------------------------------------------
// isOpaqueWebflowIdentifier
// ---------------------------------------------------------------------------

describe('isOpaqueWebflowIdentifier', () => {
  it('identifies 24-character hex Webflow object IDs', () => {
    expect(isOpaqueWebflowIdentifier('65d25be3772349200f0af0ab')).toBe(true);
    expect(isOpaqueWebflowIdentifier('aabbccddeeff001122334455')).toBe(true);
  });

  it('identifies UUID-style Webflow identifiers', () => {
    expect(isOpaqueWebflowIdentifier('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isOpaqueWebflowIdentifier('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('returns false for human-readable strings', () => {
    expect(isOpaqueWebflowIdentifier('Jane Smith')).toBe(false);
    expect(isOpaqueWebflowIdentifier('hello-world')).toBe(false);
    expect(isOpaqueWebflowIdentifier('SEO Consulting')).toBe(false);
  });

  it('returns false for partial hex strings (wrong length)', () => {
    expect(isOpaqueWebflowIdentifier('65d25be377')).toBe(false);
    expect(isOpaqueWebflowIdentifier('65d25be3772349200f0af0ab1234')).toBe(false);
  });

  it('handles leading/trailing whitespace', () => {
    // The implementation trims before checking
    expect(isOpaqueWebflowIdentifier('  65d25be3772349200f0af0ab  ')).toBe(true);
  });
});
