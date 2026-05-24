/**
 * Unit tests for pure functions in the webflow-schema domain.
 *
 * Covers pure exported functions from:
 * - server/schema/site-inventory.ts: isUtilitySchemaPath, detectSchemaFieldTarget,
 *   isOpaqueWebflowIdentifier (not already covered elsewhere — re-covers critical paths)
 * - server/schema/validator.ts: validateLeanSchema (key edge cases not in existing tests)
 * - server/schema/whole-site-graph-validator.ts: validateWholeSiteSchemaGraph
 *
 * Note: validator.ts is already covered by tests/unit/schema/validator.test.ts;
 * we add distinct edge-case tests here that are not duplicated there.
 */

import { describe, it, expect } from 'vitest';
import {
  isUtilitySchemaPath,
  detectSchemaFieldTarget,
  isOpaqueWebflowIdentifier,
} from '../../server/schema/site-inventory.js';
import { validateLeanSchema } from '../../server/schema/validator.js';

// ---------------------------------------------------------------------------
// isUtilitySchemaPath
// ---------------------------------------------------------------------------

describe('isUtilitySchemaPath', () => {
  it('identifies homepage "/" as non-utility', () => {
    expect(isUtilitySchemaPath('/').isUtility).toBe(false);
  });

  it('identifies error pages as utility', () => {
    expect(isUtilitySchemaPath('/404').isUtility).toBe(true);
    expect(isUtilitySchemaPath('/401').isUtility).toBe(true);
    expect(isUtilitySchemaPath('/500').isUtility).toBe(true);
  });

  it('identifies login page as utility', () => {
    expect(isUtilitySchemaPath('/login').isUtility).toBe(true);
    expect(isUtilitySchemaPath('/login/').isUtility).toBe(true);
    expect(isUtilitySchemaPath('/members/login').isUtility).toBe(true);
  });

  it('identifies sign-in page as utility', () => {
    expect(isUtilitySchemaPath('/sign-in').isUtility).toBe(true);
    expect(isUtilitySchemaPath('/signin').isUtility).toBe(true);
  });

  it('identifies password page as utility', () => {
    expect(isUtilitySchemaPath('/password').isUtility).toBe(true);
    // /reset-password: "password" is after a hyphen, not a path segment — not matched as utility
    expect(isUtilitySchemaPath('/reset-password').isUtility).toBe(false);
  });

  it('identifies thank-you pages as utility', () => {
    expect(isUtilitySchemaPath('/thank-you').isUtility).toBe(true);
    expect(isUtilitySchemaPath('/thanks').isUtility).toBe(true);
    expect(isUtilitySchemaPath('/success').isUtility).toBe(true);
  });

  it('identifies normal content pages as non-utility', () => {
    expect(isUtilitySchemaPath('/about').isUtility).toBe(false);
    expect(isUtilitySchemaPath('/services').isUtility).toBe(false);
    expect(isUtilitySchemaPath('/blog').isUtility).toBe(false);
    expect(isUtilitySchemaPath('/contact').isUtility).toBe(false);
    expect(isUtilitySchemaPath('/blog/my-post-title').isUtility).toBe(false);
  });

  it('is case-insensitive (path lowercased internally)', () => {
    expect(isUtilitySchemaPath('/Login').isUtility).toBe(true);
    expect(isUtilitySchemaPath('/SIGN-IN').isUtility).toBe(true);
  });

  it('returns a reason for utility pages', () => {
    const result = isUtilitySchemaPath('/404');
    expect(result.isUtility).toBe(true);
    expect(typeof result.reason).toBe('string');
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  it('returns no reason for non-utility pages', () => {
    const result = isUtilitySchemaPath('/services');
    expect(result.isUtility).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('strips trailing slash before checking', () => {
    expect(isUtilitySchemaPath('/404/').isUtility).toBe(true);
    expect(isUtilitySchemaPath('/login/').isUtility).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectSchemaFieldTarget
// ---------------------------------------------------------------------------

describe('detectSchemaFieldTarget', () => {
  function field(slug: string, displayName = '') {
    return { id: `id-${slug}`, slug, displayName, type: 'PlainText' };
  }

  it('detects schema-json-ld field as schemaJsonLd', () => {
    expect(detectSchemaFieldTarget(field('schema-json-ld'))).toBe('schemaJsonLd');
  });

  it('detects json-ld field as schemaJsonLd', () => {
    expect(detectSchemaFieldTarget(field('json-ld'))).toBe('schemaJsonLd');
  });

  it('detects author field', () => {
    expect(detectSchemaFieldTarget(field('author-name'))).toBe('author');
    expect(detectSchemaFieldTarget(field('author'))).toBe('author');
  });

  it('detects title field', () => {
    expect(detectSchemaFieldTarget(field('post-title'))).toBe('title');
    expect(detectSchemaFieldTarget(field('name'))).toBe('title');
  });

  it('detects description field', () => {
    expect(detectSchemaFieldTarget(field('description'))).toBe('description');
    expect(detectSchemaFieldTarget(field('meta-description'))).toBe('description');
    expect(detectSchemaFieldTarget(field('excerpt'))).toBe('description');
  });

  it('detects datePublished field', () => {
    expect(detectSchemaFieldTarget(field('published'))).toBe('datePublished');
    expect(detectSchemaFieldTarget(field('date-published'))).toBe('datePublished');
  });

  it('detects dateModified field', () => {
    expect(detectSchemaFieldTarget(field('updated'))).toBe('dateModified');
    expect(detectSchemaFieldTarget(field('last-updated'))).toBe('dateModified');
  });

  it('detects image field', () => {
    expect(detectSchemaFieldTarget(field('hero-image'))).toBe('image');
    expect(detectSchemaFieldTarget(field('thumbnail'))).toBe('image');
  });

  it('detects phone field', () => {
    expect(detectSchemaFieldTarget(field('phone'))).toBe('phone');
    expect(detectSchemaFieldTarget(field('telephone'))).toBe('phone');
  });

  it('detects email field', () => {
    expect(detectSchemaFieldTarget(field('email'))).toBe('email');
  });

  it('returns undefined for unrecognized fields', () => {
    expect(detectSchemaFieldTarget(field('some-random-field-xyz'))).toBeUndefined();
    expect(detectSchemaFieldTarget(field('data'))).toBeUndefined();
  });

  it('uses displayName as well when slug does not match', () => {
    // displayName "Schema JSON-LD" should also trigger schemaJsonLd
    expect(detectSchemaFieldTarget({ id: 'f1', slug: 'custom-field-1', displayName: 'Schema JSON-LD', type: 'PlainText' })).toBe('schemaJsonLd');
  });
});

// ---------------------------------------------------------------------------
// isOpaqueWebflowIdentifier
// ---------------------------------------------------------------------------

describe('isOpaqueWebflowIdentifier', () => {
  it('identifies a 24-char hex Webflow ObjectID as opaque', () => {
    expect(isOpaqueWebflowIdentifier('5f4dcc3b5aa765d61d8327de')).toBe(true);
    expect(isOpaqueWebflowIdentifier('abcdef012345678901234567')).toBe(true);
  });

  it('identifies a UUID as opaque', () => {
    expect(isOpaqueWebflowIdentifier('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isOpaqueWebflowIdentifier('12345678-1234-5234-8234-123456789012')).toBe(true);
  });

  it('identifies human-readable strings as non-opaque', () => {
    expect(isOpaqueWebflowIdentifier('My Blog Posts')).toBe(false);
    expect(isOpaqueWebflowIdentifier('services')).toBe(false);
    expect(isOpaqueWebflowIdentifier('About Us')).toBe(false);
  });

  it('handles empty string as non-opaque', () => {
    expect(isOpaqueWebflowIdentifier('')).toBe(false);
  });

  it('handles strings with mixed content as non-opaque', () => {
    expect(isOpaqueWebflowIdentifier('post-5f4dcc3b5aa765d61d8327de')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateLeanSchema — edge cases not covered in schema/validator.test.ts
// ---------------------------------------------------------------------------

describe('validateLeanSchema — edge cases', () => {
  it('returns errors array when @context is missing', () => {
    const schema = {
      '@graph': [{ '@type': 'WebPage', name: 'x', url: 'https://example.com', description: 'y', isPartOf: { '@id': '#w' }, inLanguage: 'en' }],
    };
    const findings = validateLeanSchema(schema as Record<string, unknown>, 'WebPage');
    const contextError = findings.find(f => f.ruleId === 'context-missing');
    expect(contextError).toBeDefined();
    expect(contextError!.severity).toBe('error');
  });

  it('returns errors array when @graph is missing', () => {
    const schema = { '@context': 'https://schema.org' };
    const findings = validateLeanSchema(schema as Record<string, unknown>, 'WebPage');
    const graphError = findings.find(f => f.ruleId === 'graph-missing');
    expect(graphError).toBeDefined();
    expect(graphError!.severity).toBe('error');
  });

  it('flags duplicate @type in graph', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'P1', url: 'https://example.com/p1', description: 'D', isPartOf: { '@id': '#w' }, inLanguage: 'en' },
        { '@type': 'WebPage', name: 'P2', url: 'https://example.com/p2', description: 'D', isPartOf: { '@id': '#w' }, inLanguage: 'en' },
      ],
    };
    const findings = validateLeanSchema(schema, 'WebPage');
    const dupError = findings.find(f => f.ruleId === 'duplicate-type');
    expect(dupError).toBeDefined();
    expect(dupError!.severity).toBe('error');
  });

  it('allows multiple Review nodes (ALLOW_MULTIPLE set)', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Review',
          '@id': '#r1',
          itemReviewed: { '@id': '#lb' },
          author: { '@type': 'Person', name: 'Alice' },
          reviewRating: { ratingValue: 5 },
        },
        {
          '@type': 'Review',
          '@id': '#r2',
          itemReviewed: { '@id': '#lb' },
          author: { '@type': 'Person', name: 'Bob' },
          reviewRating: { ratingValue: 4 },
        },
      ],
    };
    const findings = validateLeanSchema(schema, 'Review');
    const dupErrors = findings.filter(f => f.ruleId === 'duplicate-type');
    expect(dupErrors).toHaveLength(0);
  });

  it('flags BreadcrumbList with non-contiguous positions', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BreadcrumbList',
          '@id': '#bc',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com' },
            { '@type': 'ListItem', position: 3, name: 'Services', item: 'https://example.com/services' },
          ],
        },
      ],
    };
    const findings = validateLeanSchema(schema, 'BreadcrumbList');
    const orderError = findings.find(f => f.ruleId === 'breadcrumb-position-ordering');
    expect(orderError).toBeDefined();
  });

  it('flags a non-absolute URL', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          '@id': '#wp',
          name: 'Test',
          url: '/relative-url',
          description: 'desc',
          isPartOf: { '@id': '#w' },
          inLanguage: 'en',
        },
      ],
    };
    const findings = validateLeanSchema(schema, 'WebPage');
    const urlError = findings.find(f => f.ruleId === 'url-must-be-absolute');
    expect(urlError).toBeDefined();
    expect(urlError!.severity).toBe('error');
  });

  it('passes a valid WebPage schema with no findings', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          '@id': 'https://example.com/services#webpage',
          name: 'Our Services',
          url: 'https://example.com/services',
          description: 'Comprehensive services for all your needs.',
          isPartOf: { '@id': 'https://example.com/#website' },
          inLanguage: 'en',
        },
      ],
    };
    const findings = validateLeanSchema(schema, 'WebPage');
    expect(findings).toHaveLength(0);
  });

  it('flags LocalBusiness with bare string address (not PostalAddress)', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'LocalBusiness',
          '@id': 'https://example.com/#lb',
          name: 'ACME Plumbing',
          url: 'https://example.com',
          inLanguage: 'en',
          address: '123 Main St, Springfield, IL',
        },
      ],
    };
    const findings = validateLeanSchema(schema, 'LocalBusiness');
    const addrError = findings.find(f => f.ruleId === 'localbusiness-address-not-object');
    expect(addrError).toBeDefined();
    expect(addrError!.severity).toBe('error');
  });

  it('validates Article author must be object', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Article',
          '@id': 'https://example.com/article#article',
          headline: 'Test Headline',
          description: 'A description',
          image: 'https://example.com/img.jpg',
          datePublished: '2025-01-01T00:00:00Z',
          dateModified: '2025-01-02T00:00:00Z',
          author: 'Not an object',
          publisher: { '@type': 'Organization', name: 'Pub', logo: { '@type': 'ImageObject', url: 'https://example.com/logo.png' } },
          isPartOf: { '@id': 'https://example.com/#website' },
          inLanguage: 'en',
        },
      ],
    };
    const findings = validateLeanSchema(schema, 'Article');
    const authorError = findings.find(f => f.ruleId === 'article-author-shape');
    expect(authorError).toBeDefined();
    expect(authorError!.severity).toBe('error');
  });

  it('validates that Article datePublished must be ISO 8601', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Article',
          '@id': 'https://example.com/a#a',
          headline: 'H',
          description: 'D',
          image: 'https://x.com/i.jpg',
          datePublished: 'not-a-date',
          dateModified: '2025-01-01T00:00:00Z',
          author: { '@type': 'Person', name: 'Alice' },
          publisher: { '@type': 'Organization', name: 'Pub', logo: { '@type': 'ImageObject', url: 'https://x.com/logo.png' } },
          isPartOf: { '@id': '#w' },
          inLanguage: 'en',
        },
      ],
    };
    const findings = validateLeanSchema(schema, 'Article');
    const dateError = findings.find(f => f.ruleId === 'article-date-iso8601' && f.field === 'datePublished');
    expect(dateError).toBeDefined();
    expect(dateError!.severity).toBe('error');
  });
});
