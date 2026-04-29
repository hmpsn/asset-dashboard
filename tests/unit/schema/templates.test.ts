import { describe, it, expect } from 'vitest';
import { buildArticleSchema } from '../../../server/schema/templates/article.js';
import { buildServiceSchema, buildProductSchema } from '../../../server/schema/templates/service.js';
import { validateLeanSchema } from '../../../server/schema/validator.js';

const baseInput = {
  baseUrl: 'https://example.com',
  pageData: {
    title: 'My Post',
    description: 'A great post',
    image: 'https://x/i.jpg',
    canonicalUrl: 'https://example.com/blog/my-post',
    publisher: { name: 'Acme', logoUrl: 'https://x/logo.png' },
    datePublished: '2025-01-15T00:00:00Z',
    dateModified: '2026-04-01T00:00:00Z',
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
});

const serviceInput = {
  baseUrl: 'https://example.com',
  pageData: {
    title: 'Web Design Service',
    description: 'Custom design',
    image: 'https://x/svc.jpg',
    canonicalUrl: 'https://example.com/services/web-design',
    publisher: { name: 'Acme', logoUrl: undefined },
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
