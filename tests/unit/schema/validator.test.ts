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
