import { describe, it, expect } from 'vitest';
import { UTILITY_SLUGS, autoFixSchema, upgradeHealthcareType } from '../../server/schema-suggester.js';

describe('UTILITY_SLUGS regex', () => {
  it('matches error and utility pages', () => {
    expect(UTILITY_SLUGS.test('/401')).toBe(true);
    expect(UTILITY_SLUGS.test('/404')).toBe(true);
    expect(UTILITY_SLUGS.test('/privacy-policy')).toBe(true);
    expect(UTILITY_SLUGS.test('/terms')).toBe(true);
    expect(UTILITY_SLUGS.test('/terms-of-service')).toBe(true);
    expect(UTILITY_SLUGS.test('/sitemap.xml')).toBe(true);
    expect(UTILITY_SLUGS.test('/robots.txt')).toBe(true);
    expect(UTILITY_SLUGS.test('/cookie-policy')).toBe(true);
    expect(UTILITY_SLUGS.test('/maintenance')).toBe(true);
  });

  it('does not match real content pages', () => {
    expect(UTILITY_SLUGS.test('/about')).toBe(false);
    expect(UTILITY_SLUGS.test('/dental-services')).toBe(false);
    expect(UTILITY_SLUGS.test('/contact-us')).toBe(false);
    expect(UTILITY_SLUGS.test('/blog/post-1')).toBe(false);
    expect(UTILITY_SLUGS.test('/legal-services')).toBe(false);
  });
});

describe('autoFixSchema — knowsAbout trim', () => {
  it('trims knowsAbout to max 5 items', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Organization', 'name': 'Test Co', 'knowsAbout': ['A','B','C','D','E','F','G'] }],
    };
    autoFixSchema(schema);
    expect((schema['@graph'][0] as any)['knowsAbout']).toHaveLength(5);
  });

  it('leaves knowsAbout with ≤5 items untouched', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Organization', 'name': 'Test Co', 'knowsAbout': ['A','B','C'] }],
    };
    autoFixSchema(schema);
    expect((schema['@graph'][0] as any)['knowsAbout']).toHaveLength(3);
  });
});

describe('autoFixSchema — Product zero-price strip', () => {
  it('removes zero-price single offer from Product', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Product', 'name': 'Dental Services', 'offers': { '@type': 'Offer', 'price': '0.00', 'priceCurrency': 'USD' } }],
    };
    autoFixSchema(schema);
    expect((schema['@graph'][0] as any)['offers']).toBeUndefined();
  });

  it('flags Product for removal when all offers are zero-priced', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Product', 'name': 'Dental Care', 'offers': [
        { '@type': 'Offer', 'price': '0', 'priceCurrency': 'USD' },
        { '@type': 'Offer', 'price': '0.00', 'priceCurrency': 'USD' },
      ]}],
    };
    autoFixSchema(schema);
    expect((schema['@graph'][0] as any)['_remove']).toBe(true);
  });

  it('preserves Product when it has at least one real-price offer', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Product', 'name': 'Widget', 'offers': [
        { '@type': 'Offer', 'price': '0', 'priceCurrency': 'USD' },
        { '@type': 'Offer', 'price': '49.99', 'priceCurrency': 'USD' },
      ]}],
    };
    autoFixSchema(schema);
    expect((schema['@graph'][0] as any)['_remove']).toBeUndefined();
    expect((schema['@graph'][0] as any)['offers']).toHaveLength(1);
  });
});

describe('upgradeHealthcareType', () => {
  it('upgrades Organization → Dentist when businessContext mentions dental', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Organization', 'name': 'Rinse Dental', '@id': 'https://rinse-dental.com/#organization' }],
    };
    upgradeHealthcareType(schema, { businessContext: 'We are a dental practice providing cosmetic dentistry services.' } as any);
    expect((schema['@graph'][0] as any)['@type']).toBe('Dentist');
  });

  it('does not upgrade when businessContext has no healthcare keywords', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Organization', 'name': 'Acme SaaS', '@id': 'https://acme.com/#organization' }],
    };
    upgradeHealthcareType(schema, { businessContext: 'We build software for project management teams.' } as any);
    expect((schema['@graph'][0] as any)['@type']).toBe('Organization');
  });

  it('upgrades LocalBusiness → MedicalClinic for clinic context', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'LocalBusiness', 'name': 'City Urgent Care', '@id': 'https://cityurgentcare.com/#organization' }],
    };
    upgradeHealthcareType(schema, { businessContext: 'City urgent care clinic serving patients in downtown.' } as any);
    expect((schema['@graph'][0] as any)['@type']).toBe('MedicalClinic');
  });

  it('maps dermatology context to MedicalBusiness, not invalid Dermatology type', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Organization', 'name': 'Clear Skin Dermatology' }],
    };
    upgradeHealthcareType(schema, { businessContext: 'Dermatology clinic specializing in skin care.' } as any);
    expect((schema['@graph'][0] as any)['@type']).toBe('MedicalBusiness');
  });
});

describe('generation queue — utility page pre-filter', () => {
  it('UTILITY_SLUGS matches all intended utility paths', () => {
    const utilityPaths = ['/401', '/404', '/500', '/privacy-policy', '/terms', '/terms-of-service', '/legal', '/sitemap.xml', '/robots.txt', '/cookie-policy', '/maintenance'];
    const contentPaths = ['/about', '/services', '/dental-services', '/contact-us', '/blog/post-1', '/team'];
    utilityPaths.forEach(p => expect(UTILITY_SLUGS.test(p)).toBe(true));
    contentPaths.forEach(p => expect(UTILITY_SLUGS.test(p)).toBe(false));
  });
});
