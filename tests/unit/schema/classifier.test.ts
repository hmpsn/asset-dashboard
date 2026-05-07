import { describe, it, expect } from 'vitest';
import { classifyPage } from '../../../server/schema/classifier.js';

const BASE = 'https://example.com';

describe('classifyPage', () => {
  it('returns Homepage kind for root URL', () => {
    expect(classifyPage(`${BASE}/`, BASE).kind).toBe('Homepage');
    expect(classifyPage(BASE, BASE).kind).toBe('Homepage');
  });

  it('classifies blog post URLs as BlogPosting', () => {
    expect(classifyPage(`${BASE}/blog/my-post`, BASE).kind).toBe('BlogPosting');
    expect(classifyPage(`${BASE}/insights/seo-tips`, BASE).kind).toBe('BlogPosting');
    expect(classifyPage(`${BASE}/articles/2026-trends`, BASE).kind).toBe('BlogPosting');
    expect(classifyPage(`${BASE}/news/launch`, BASE).kind).toBe('BlogPosting');
  });

  it('classifies blog index URLs as CollectionPage', () => {
    expect(classifyPage(`${BASE}/blog`, BASE).kind).toBe('BlogIndex');
    expect(classifyPage(`${BASE}/insights`, BASE).kind).toBe('BlogIndex');
    expect(classifyPage(`${BASE}/insights/`, BASE).kind).toBe('BlogIndex');
  });

  it('classifies service detail URLs as Service', () => {
    expect(classifyPage(`${BASE}/services/web-design`, BASE).kind).toBe('Service');
    expect(classifyPage(`${BASE}/service/consulting`, BASE).kind).toBe('Service');
  });

  it('classifies service index as ServiceIndex', () => {
    expect(classifyPage(`${BASE}/services`, BASE).kind).toBe('ServiceIndex');
  });

  it('classifies case studies under /our-work or /case-studies as CaseStudy', () => {
    expect(classifyPage(`${BASE}/our-work/expero`, BASE).kind).toBe('CaseStudy');
    expect(classifyPage(`${BASE}/case-studies/swish-dental`, BASE).kind).toBe('CaseStudy');
    expect(classifyPage(`${BASE}/portfolio/project-x`, BASE).kind).toBe('CaseStudy');
  });

  it('classifies AboutPage and ContactPage', () => {
    expect(classifyPage(`${BASE}/about`, BASE).kind).toBe('AboutPage');
    expect(classifyPage(`${BASE}/about-us`, BASE).kind).toBe('AboutPage');
    expect(classifyPage(`${BASE}/contact`, BASE).kind).toBe('ContactPage');
  });

  it('classifies legal pages as Legal (becomes plain WebPage)', () => {
    expect(classifyPage(`${BASE}/privacy-policy`, BASE).kind).toBe('Legal');
    expect(classifyPage(`${BASE}/terms-of-service`, BASE).kind).toBe('Legal');
    expect(classifyPage(`${BASE}/privacy-policy`, BASE).primaryType).toBe('WebPage');
    expect(classifyPage(`${BASE}/terms-of-service`, BASE).primaryType).toBe('WebPage');
  });

  it('strips query strings and fragments before matching', () => {
    expect(classifyPage(`${BASE}/blog/post?utm=x`, BASE).kind).toBe('BlogPosting');
    expect(classifyPage(`${BASE}/blog/post#section`, BASE).kind).toBe('BlogPosting');
  });

  it('handles trailing slashes', () => {
    expect(classifyPage(`${BASE}/blog/post/`, BASE).kind).toBe('BlogPosting');
  });

  it('classifies /location/* paths as Location', () => {
    expect(classifyPage(`${BASE}/location/downtown`, BASE).kind).toBe('Location');
    expect(classifyPage(`${BASE}/location/cedar-park`, BASE).kind).toBe('Location');
    expect(classifyPage(`${BASE}/locations/main-street`, BASE).kind).toBe('Location');
    expect(classifyPage(`${BASE}/office/suite-100`, BASE).kind).toBe('Location');
    expect(classifyPage(`${BASE}/studio/east-austin`, BASE).kind).toBe('Location');
    expect(classifyPage(`${BASE}/clinic/north`, BASE).kind).toBe('Location');
    expect(classifyPage(`${BASE}/branch/west`, BASE).kind).toBe('Location');
    expect(classifyPage(`${BASE}/branches/south`, BASE).kind).toBe('Location');
    expect(classifyPage(`${BASE}/store/downtown`, BASE).kind).toBe('Location');
    expect(classifyPage(`${BASE}/stores/main-street`, BASE).kind).toBe('Location');
  });

  it('Location pages have LocalBusiness primaryType', () => {
    expect(classifyPage(`${BASE}/location/downtown`, BASE).primaryType).toBe('LocalBusiness');
  });

  it('falls back to WebPage for unknown patterns', () => {
    expect(classifyPage(`${BASE}/random/deep/path`, BASE).kind).toBe('WebPage');
  });

  it('respects opts.businessKind for healthcare workspaces (LocalBusiness on homepage)', () => {
    expect(classifyPage(BASE, BASE, { businessKind: 'local' }).primaryType).toBe('LocalBusiness');
  });

  it('returns BlogPosting primaryType not "BlogPost"', () => {
    expect(classifyPage(`${BASE}/blog/x`, BASE).primaryType).toBe('BlogPosting');
  });

  it('case-study primaryType is Article (not Service)', () => {
    expect(classifyPage(`${BASE}/our-work/x`, BASE).primaryType).toBe('Article');
  });
});
