import { describe, it, expect } from 'vitest';
import { buildAboutPageSchema, buildContactPageSchema } from '../../../server/schema/templates/static.js';
import { buildServiceSchema } from '../../../server/schema/templates/service.js';

const baseUrl = 'https://example.com';

const pageData = {
  title: 'Test Page',
  cleanTitle: 'Test Page',
  description: 'A test page',
  image: undefined,
  canonicalUrl: 'https://example.com/about',
  publisher: { name: 'Example Co', logoUrl: 'https://example.com/logo.png' },
  datePublished: undefined,
  dateModified: undefined,
  inLanguage: 'en',
  articleSection: undefined,
  breadcrumbs: [
    { name: 'Home', url: 'https://example.com' },
    { name: 'About', url: 'https://example.com/about' },
  ],
};

const withAddress = {
  phone: '512-555-0100',
  address: { street: '123 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
};

const withoutAddress = {
  phone: '512-555-0100',
  // address intentionally absent
};

// Empty address object — must NOT trigger LocalBusiness (no locating fields)
const withEmptyAddress = {
  phone: '512-555-0100',
  address: {},
};

describe('buildAboutPageSchema — businessProfile threading', () => {
  it('mainEntity points to /#localbusiness when businessProfile.address is set', () => {
    const schema = buildAboutPageSchema({ baseUrl, pageData, businessProfile: withAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const aboutNode = graph.find((n) => n['@type'] === 'AboutPage') as Record<string, unknown>;
    expect(aboutNode).toBeDefined();
    expect(aboutNode['mainEntity']).toEqual({ '@id': 'https://example.com/#localbusiness' });
  });

  it('mainEntity falls back to Organization @id when businessProfile.address is absent', () => {
    const schema = buildAboutPageSchema({ baseUrl, pageData, businessProfile: withoutAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const aboutNode = graph.find((n) => n['@type'] === 'AboutPage') as Record<string, unknown>;
    const mainEntity = aboutNode['mainEntity'] as Record<string, unknown>;
    expect(mainEntity['@id']).toBe('https://example.com/#organization');
  });

  it('mainEntity falls back to Organization @id when businessProfile is null', () => {
    const schema = buildAboutPageSchema({ baseUrl, pageData, businessProfile: null });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const aboutNode = graph.find((n) => n['@type'] === 'AboutPage') as Record<string, unknown>;
    const mainEntity = aboutNode['mainEntity'] as Record<string, unknown>;
    expect(mainEntity['@id']).toBe('https://example.com/#organization');
  });

  it('mainEntity falls back to Organization @id when businessProfile is undefined (no breaking change)', () => {
    const schema = buildAboutPageSchema({ baseUrl, pageData });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const aboutNode = graph.find((n) => n['@type'] === 'AboutPage') as Record<string, unknown>;
    const mainEntity = aboutNode['mainEntity'] as Record<string, unknown>;
    expect(mainEntity['@id']).toBe('https://example.com/#organization');
  });

  it('mainEntity falls back to Organization @id when address object is empty (no locating fields)', () => {
    const schema = buildAboutPageSchema({ baseUrl, pageData, businessProfile: withEmptyAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const aboutNode = graph.find((n) => n['@type'] === 'AboutPage') as Record<string, unknown>;
    const mainEntity = aboutNode['mainEntity'] as Record<string, unknown>;
    expect(mainEntity['@id']).toBe('https://example.com/#organization');
  });
});

describe('buildContactPageSchema — businessProfile threading', () => {
  it('mainEntity is LocalBusiness @id when businessProfile.address is set', () => {
    const contactPageData = { ...pageData, canonicalUrl: 'https://example.com/contact' };
    const schema = buildContactPageSchema({ baseUrl, pageData: contactPageData, businessProfile: withAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const contactNode = graph.find((n) => n['@type'] === 'ContactPage') as Record<string, unknown>;
    const businessNode = graph.find((n) => n['@type'] === 'LocalBusiness') as Record<string, unknown>;
    expect(contactNode).toBeDefined();
    expect(contactNode['mainEntity']).toEqual({ '@id': 'https://example.com/#localbusiness' });
    expect(businessNode?.address).toMatchObject({
      streetAddress: '123 Main St',
      addressLocality: 'Austin',
      addressRegion: 'TX',
      postalCode: '78701',
      addressCountry: 'US',
    });
  });

  it('mainEntity is absent when businessProfile.address is not set', () => {
    const contactPageData = { ...pageData, canonicalUrl: 'https://example.com/contact' };
    const schema = buildContactPageSchema({ baseUrl, pageData: contactPageData, businessProfile: withoutAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const contactNode = graph.find((n) => n['@type'] === 'ContactPage') as Record<string, unknown>;
    expect(contactNode['mainEntity']).toBeUndefined();
  });

  it('mainEntity is absent when businessProfile is undefined (no breaking change)', () => {
    const contactPageData = { ...pageData, canonicalUrl: 'https://example.com/contact' };
    const schema = buildContactPageSchema({ baseUrl, pageData: contactPageData });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const contactNode = graph.find((n) => n['@type'] === 'ContactPage') as Record<string, unknown>;
    expect(contactNode['mainEntity']).toBeUndefined();
  });

  it('mainEntity is absent when address object is empty (no locating fields)', () => {
    const contactPageData = { ...pageData, canonicalUrl: 'https://example.com/contact' };
    const schema = buildContactPageSchema({ baseUrl, pageData: contactPageData, businessProfile: withEmptyAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const contactNode = graph.find((n) => n['@type'] === 'ContactPage') as Record<string, unknown>;
    expect(contactNode['mainEntity']).toBeUndefined();
  });
});

describe('buildServiceSchema — businessProfile threading', () => {
  const servicePageData = {
    ...pageData,
    canonicalUrl: 'https://example.com/services/design',
    elements: undefined,
  };

  it('provider is LocalBusiness @id when businessProfile.address is set', () => {
    const schema = buildServiceSchema({ baseUrl, pageData: servicePageData, businessProfile: withAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const serviceNode = graph.find((n) => n['@type'] === 'Service') as Record<string, unknown>;
    expect(serviceNode).toBeDefined();
    expect(serviceNode['provider']).toEqual({ '@id': 'https://example.com/#localbusiness' });
  });

  it('provider is inline Organization when businessProfile.address is absent', () => {
    const schema = buildServiceSchema({ baseUrl, pageData: servicePageData, businessProfile: withoutAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const serviceNode = graph.find((n) => n['@type'] === 'Service') as Record<string, unknown>;
    const provider = serviceNode['provider'] as Record<string, unknown>;
    expect(provider['@type']).toBe('Organization');
    expect(provider['@id']).toBe('https://example.com/#organization');
  });

  it('provider is inline Organization when businessProfile is undefined (no breaking change)', () => {
    const schema = buildServiceSchema({ baseUrl, pageData: servicePageData });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const serviceNode = graph.find((n) => n['@type'] === 'Service') as Record<string, unknown>;
    const provider = serviceNode['provider'] as Record<string, unknown>;
    expect(provider['@type']).toBe('Organization');
  });

  it('provider is inline Organization when address object is empty (no locating fields)', () => {
    const schema = buildServiceSchema({ baseUrl, pageData: servicePageData, businessProfile: withEmptyAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const serviceNode = graph.find((n) => n['@type'] === 'Service') as Record<string, unknown>;
    const provider = serviceNode['provider'] as Record<string, unknown>;
    expect(provider['@type']).toBe('Organization');
    expect(provider['@id']).toBe('https://example.com/#organization');
  });
});
