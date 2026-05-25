import { describe, expect, it } from 'vitest';
import { buildProductSchema, buildServiceSchema } from '../../server/schema/templates/service.js';

function makePageData() {
  return {
    canonicalUrl: 'https://example.com/services/seo',
    cleanTitle: 'SEO Services',
    title: 'SEO Services | Example',
    description: 'Professional SEO services',
    image: 'https://example.com/hero.jpg',
    publisher: { name: 'Example Studio' },
    breadcrumbs: [],
    inLanguage: 'en-US',
    elements: {
      testimonials: [],
      tables: [],
      images: [],
    },
  };
}

describe('schema/templates/service', () => {
  it('buildServiceSchema filters offers missing required price fields', () => {
    const schema = buildServiceSchema({
      baseUrl: 'https://example.com',
      pageData: makePageData(),
      offers: [
        { name: 'Valid Offer', price: '250', priceCurrency: 'USD' },
        { name: 'Missing Price', price: '', priceCurrency: 'USD' },
        { name: 'Missing Currency', price: '150', priceCurrency: '' },
      ],
    });

    const graph = (schema['@graph'] as Array<Record<string, unknown>>) ?? [];
    const serviceNode = graph.find((node) => node['@type'] === 'Service') ?? {};
    const offers = (serviceNode.offers as Array<Record<string, unknown>>) ?? [];

    expect(offers).toHaveLength(1);
    expect(offers[0].price).toBe('250');
    expect(offers[0].priceCurrency).toBe('USD');
  });

  it('buildProductSchema excludes zero-priced offers', () => {
    const schema = buildProductSchema({
      baseUrl: 'https://example.com',
      pageData: makePageData(),
      offers: [
        { name: 'Free Trial', price: '0', priceCurrency: 'USD' },
        { name: 'Paid Tier', price: '99', priceCurrency: 'USD' },
      ],
    });

    const graph = (schema['@graph'] as Array<Record<string, unknown>>) ?? [];
    const productNode = graph.find((node) => node['@type'] === 'Product') ?? {};
    const offers = (productNode.offers as Array<Record<string, unknown>>) ?? [];

    expect(offers).toHaveLength(1);
    expect(offers[0].price).toBe('99');
  });
});
