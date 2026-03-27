/**
 * Unit tests for Phase 1A — Schema validation store + enhanced Google-compliant validator.
 *
 * Tests:
 * 1. CRUD for schema_validations table
 * 2. validateForGoogleRichResults() — comprehensive per-type validation
 * 3. validateEntityConsistency() — cross-page entity checks
 */
import { describe, it, expect, beforeAll } from 'vitest';

// ── 1. Validation Store ──────────────────────────────────────────

describe('schema validation store', () => {
  let store: {
    upsertValidation: (opts: {
      workspaceId: string;
      pageId: string;
      status: 'valid' | 'warnings' | 'errors';
      richResults: string[];
      errors: Array<{ type: string; message: string }>;
      warnings: Array<{ type: string; message: string }>;
    }) => { id: string };
    getValidation: (workspaceId: string, pageId: string) => {
      id: string;
      status: string;
      richResults: string[];
      errors: Array<{ type: string; message: string }>;
      warnings: Array<{ type: string; message: string }>;
      validatedAt: string;
    } | null;
    getValidations: (workspaceId: string) => Array<{
      id: string;
      pageId: string;
      status: string;
      richResults: string[];
      errors: Array<{ type: string; message: string }>;
      warnings: Array<{ type: string; message: string }>;
      validatedAt: string;
    }>;
    deleteValidation: (workspaceId: string, pageId: string) => boolean;
  };

  beforeAll(async () => {
    const mod = await import('../../server/schema-validator.js');
    store = mod;
  });

  it('upsertValidation stores and returns id', () => {
    const result = store.upsertValidation({
      workspaceId: 'ws-test',
      pageId: 'https://example.com/services',
      status: 'valid',
      richResults: ['Service', 'BreadcrumbList'],
      errors: [],
      warnings: [],
    });
    expect(result.id).toBeTruthy();
  });

  it('getValidation retrieves stored validation', () => {
    const v = store.getValidation('ws-test', 'https://example.com/services');
    expect(v).not.toBeNull();
    expect(v!.status).toBe('valid');
    expect(v!.richResults).toContain('Service');
  });

  it('upsertValidation replaces existing record', () => {
    store.upsertValidation({
      workspaceId: 'ws-test',
      pageId: 'https://example.com/services',
      status: 'errors',
      richResults: [],
      errors: [{ type: 'Service', message: 'Missing name property' }],
      warnings: [],
    });
    const v = store.getValidation('ws-test', 'https://example.com/services');
    expect(v!.status).toBe('errors');
    expect(v!.errors).toHaveLength(1);
  });

  it('getValidations returns all for workspace', () => {
    store.upsertValidation({
      workspaceId: 'ws-test',
      pageId: 'https://example.com/about',
      status: 'warnings',
      richResults: ['WebPage'],
      errors: [],
      warnings: [{ type: 'WebPage', message: 'Missing dateModified' }],
    });
    const all = store.getValidations('ws-test');
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('deleteValidation removes the record', () => {
    const deleted = store.deleteValidation('ws-test', 'https://example.com/about');
    expect(deleted).toBe(true);
    expect(store.getValidation('ws-test', 'https://example.com/about')).toBeNull();
  });
});

// ── 2. Google-Compliant Rich Results Validator ───────────────────

describe('validateForGoogleRichResults', () => {
  let validateForGoogleRichResults: (schema: Record<string, unknown>) => {
    status: 'valid' | 'warnings' | 'errors';
    richResults: string[];
    errors: Array<{ type: string; field: string; message: string }>;
    warnings: Array<{ type: string; field: string; message: string }>;
  };

  beforeAll(async () => {
    const mod = await import('../../server/schema-validator.js');
    validateForGoogleRichResults = mod.validateForGoogleRichResults;
  });

  it('validates a correct Article schema as valid', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Article',
        '@id': 'https://example.com/blog/test/#article',
        headline: 'Test Article',
        datePublished: '2026-03-01',
        author: { '@type': 'Person', name: 'John Doe' },
        image: 'https://example.com/image.jpg',
        publisher: { '@id': 'https://example.com/#organization' },
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).not.toBe('errors');
    expect(result.richResults).toContain('Article');
  });

  it('flags missing required fields on Article', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Article',
        '@id': 'https://example.com/blog/test/#article',
        headline: 'Test Article',
        // Missing: datePublished, author, image
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('errors');
    expect(result.errors.some(e => e.field === 'datePublished')).toBe(true);
    expect(result.errors.some(e => e.field === 'author')).toBe(true);
  });

  it('validates FAQPage with mainEntity', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'FAQPage',
        '@id': 'https://example.com/faq/#faqpage',
        mainEntity: [
          { '@type': 'Question', name: 'What is SEO?', acceptedAnswer: { '@type': 'Answer', text: 'SEO is...' } },
        ],
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('FAQPage');
    expect(result.errors).toHaveLength(0);
  });

  it('flags FAQPage without mainEntity', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'FAQPage',
        '@id': 'https://example.com/faq/#faqpage',
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('errors');
    expect(result.errors.some(e => e.field === 'mainEntity')).toBe(true);
  });

  it('validates LocalBusiness with required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'LocalBusiness',
        '@id': 'https://example.com/#business',
        name: 'Acme Corp',
        address: { '@type': 'PostalAddress', streetAddress: '123 Main', addressLocality: 'Springfield' },
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('LocalBusiness');
  });

  it('validates Product with required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Product',
        '@id': 'https://example.com/product/#product',
        name: 'Widget Pro',
        offers: { '@type': 'Offer', price: '29.99', priceCurrency: 'USD' },
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('Product');
  });

  it('validates JobPosting with required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'JobPosting',
        '@id': 'https://example.com/careers/dev/#jobposting',
        title: 'Software Engineer',
        datePosted: '2026-03-01',
        description: 'We are hiring...',
        hiringOrganization: { '@type': 'Organization', name: 'Acme Corp' },
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('JobPosting');
  });

  it('validates Event with required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Event',
        '@id': 'https://example.com/events/conf/#event',
        name: 'Tech Conference 2026',
        startDate: '2026-06-15',
        location: { '@type': 'Place', name: 'Convention Center', address: '456 Oak Ave' },
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('Event');
  });

  it('validates Recipe with required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Recipe',
        '@id': 'https://example.com/recipes/cake/#recipe',
        name: 'Chocolate Cake',
        image: 'https://example.com/cake.jpg',
        recipeIngredient: ['2 cups flour', '1 cup sugar'],
        recipeInstructions: [{ '@type': 'HowToStep', text: 'Mix ingredients' }],
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('Recipe');
  });

  it('warns on recommended but non-required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Article',
        '@id': 'https://example.com/blog/test/#article',
        headline: 'Test Article',
        datePublished: '2026-03-01',
        author: { '@type': 'Person', name: 'John' },
        image: 'https://example.com/img.jpg',
        // Missing recommended: dateModified, publisher
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('warnings');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('validates Course with required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Course',
        '@id': 'https://example.com/courses/seo-101/#course',
        name: 'SEO 101',
        description: 'Learn the fundamentals of SEO',
        provider: { '@type': 'Organization', name: 'Acme Academy' },
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('Course');
    expect(result.errors).toHaveLength(0);
  });

  it('flags Course missing required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Course',
        '@id': 'https://example.com/courses/seo-101/#course',
        name: 'SEO 101',
        // Missing: description, provider
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('errors');
    expect(result.errors.some(e => e.field === 'description')).toBe(true);
    expect(result.errors.some(e => e.field === 'provider')).toBe(true);
  });

  it('validates Review with required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Review',
        '@id': 'https://example.com/reviews/widget/#review',
        itemReviewed: { '@type': 'Product', name: 'Widget Pro' },
        reviewRating: { '@type': 'Rating', ratingValue: '4.5' },
        author: { '@type': 'Person', name: 'Jane Doe' },
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('Review');
    expect(result.errors).toHaveLength(0);
  });

  it('validates ProfilePage for author pages', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'ProfilePage',
        '@id': 'https://example.com/team/jane/#profilepage',
        mainEntity: { '@type': 'Person', name: 'Jane Doe', jobTitle: 'CEO' },
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('ProfilePage');
    expect(result.errors).toHaveLength(0);
  });

  it('validates MedicalOrganization (medical industry subtype)', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'MedicalOrganization',
        '@id': 'https://example.com/#medical',
        name: 'Springfield Medical Center',
        address: { '@type': 'PostalAddress', streetAddress: '123 Health Ave' },
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('MedicalOrganization');
    expect(result.errors).toHaveLength(0);
  });

  it('validates FinancialService (financial industry subtype)', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'FinancialService',
        '@id': 'https://example.com/#financial',
        name: 'Acme Financial Advisors',
        address: { '@type': 'PostalAddress', streetAddress: '456 Wall St' },
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('FinancialService');
    expect(result.errors).toHaveLength(0);
  });

  it('validates Dataset with required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Dataset',
        '@id': 'https://example.com/reports/aie-report/#dataset',
        name: 'AI Efficiency Report 2026',
        description: 'A comprehensive dataset of AI efficiency benchmarks across industries.',
        creator: { '@type': 'Organization', name: 'hmpsn.studio' },
        dateModified: '2026-03-01',
        keywords: ['AI', 'efficiency', 'benchmarks'],
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.richResults).toContain('Dataset');
    expect(result.errors).toHaveLength(0);
  });

  it('flags Dataset missing required fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Dataset',
        '@id': 'https://example.com/reports/aie-report/#dataset',
        name: 'AI Efficiency Report 2026',
        // Missing: description
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('errors');
    expect(result.errors.some(e => e.field === 'description')).toBe(true);
    expect(result.richResults).not.toContain('Dataset');
  });

  it('warns on Dataset missing recommended fields', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Dataset',
        '@id': 'https://example.com/reports/aie-report/#dataset',
        name: 'AI Efficiency Report 2026',
        description: 'Benchmark data across industries.',
        // Missing recommended: creator, dateModified, keywords, etc.
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('warnings');
    expect(result.richResults).toContain('Dataset');
    expect(result.warnings.some(w => w.field === 'creator')).toBe(true);
    expect(result.warnings.some(w => w.field === 'dateModified')).toBe(true);
  });

  it('handles empty @graph', () => {
    const schema = { '@context': 'https://schema.org', '@graph': [] };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('valid');
    expect(result.richResults).toHaveLength(0);
  });

  it('validates all types in multi-type @type arrays', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': ['WebPage', 'ProfilePage'],
        '@id': 'https://example.com/team/jane/#profilepage',
        mainEntity: { '@type': 'Person', name: 'Jane Doe' },
        name: 'Jane Doe Profile',
        description: 'Team member page',
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.errors).toHaveLength(0);
    expect(result.richResults).toContain('ProfilePage');
  });

  it('flags missing required fields from secondary type in multi-type arrays', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': ['WebPage', 'ProfilePage'],
        '@id': 'https://example.com/team/jane/#profilepage',
        // Missing: mainEntity (required by ProfilePage)
        name: 'Jane Doe Profile',
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('errors');
    expect(result.errors.some(e => e.field === 'mainEntity' && e.type === 'ProfilePage')).toBe(true);
    expect(result.richResults).not.toContain('ProfilePage');
  });

  it('does not duplicate errors for shared fields across multi-type arrays', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': ['Article', 'BlogPosting'],
        '@id': 'https://example.com/blog/test/#article',
        // Missing: headline, datePublished, author, image (required by both)
      }],
    };
    const result = validateForGoogleRichResults(schema);
    expect(result.status).toBe('errors');
    // Each field should only appear once despite being required by both types
    const headlineErrors = result.errors.filter(e => e.field === 'headline');
    expect(headlineErrors).toHaveLength(1);
    const authorErrors = result.errors.filter(e => e.field === 'author');
    expect(authorErrors).toHaveLength(1);
  });
});

// ── 3. Entity Consistency ────────────────────────────────────────

describe('validateEntityConsistency', () => {
  let validateEntityConsistency: (schemas: Array<{ pageId: string; schema: Record<string, unknown> }>) => {
    consistent: boolean;
    mismatches: Array<{ field: string; expected: string; found: string; pageId: string }>;
  };

  beforeAll(async () => {
    const mod = await import('../../server/schema-validator.js');
    validateEntityConsistency = mod.validateEntityConsistency;
  });

  it('returns consistent when all Organization nodes match', () => {
    const schemas = [
      { pageId: '/', schema: { '@graph': [{ '@type': 'Organization', '@id': '/#org', name: 'Acme', url: 'https://acme.com' }] } },
      { pageId: '/about', schema: { '@graph': [{ '@type': 'Organization', '@id': '/#org', name: 'Acme', url: 'https://acme.com' }] } },
    ];
    const result = validateEntityConsistency(schemas);
    expect(result.consistent).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('detects mismatched Organization name', () => {
    const schemas = [
      { pageId: '/', schema: { '@graph': [{ '@type': 'Organization', '@id': '/#org', name: 'Acme Corp', url: 'https://acme.com' }] } },
      { pageId: '/about', schema: { '@graph': [{ '@type': 'Organization', '@id': '/#org', name: 'Acme Inc', url: 'https://acme.com' }] } },
    ];
    const result = validateEntityConsistency(schemas);
    expect(result.consistent).toBe(false);
    expect(result.mismatches.some(m => m.field === 'name')).toBe(true);
  });

  it('detects mismatched phone numbers', () => {
    const schemas = [
      { pageId: '/', schema: { '@graph': [{ '@type': 'Organization', '@id': '/#org', name: 'Acme', telephone: '+1-555-0100' }] } },
      { pageId: '/contact', schema: { '@graph': [{ '@type': 'Organization', '@id': '/#org', name: 'Acme', telephone: '+1-555-0200' }] } },
    ];
    const result = validateEntityConsistency(schemas);
    expect(result.consistent).toBe(false);
    expect(result.mismatches.some(m => m.field === 'telephone')).toBe(true);
  });

  it('handles schemas without Organization nodes', () => {
    const schemas = [
      { pageId: '/blog/post', schema: { '@graph': [{ '@type': 'Article', headline: 'Test' }] } },
    ];
    const result = validateEntityConsistency(schemas);
    expect(result.consistent).toBe(true);
  });

  it('returns empty mismatches for single page', () => {
    const schemas = [
      { pageId: '/', schema: { '@graph': [{ '@type': 'Organization', '@id': '/#org', name: 'Acme' }] } },
    ];
    const result = validateEntityConsistency(schemas);
    expect(result.consistent).toBe(true);
  });
});
