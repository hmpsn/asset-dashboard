import { describe, expect, it } from 'vitest';
import { classifyPage } from '../../server/schema/classifier.js';

describe('classifyPage', () => {
  it('classifies homepage and local-business homepage variant', () => {
    expect(classifyPage('https://example.com/', 'https://example.com')).toEqual(
      expect.objectContaining({ kind: 'Homepage', primaryType: 'Organization', pagePath: '/' }),
    );
    expect(classifyPage('https://example.com/', 'https://example.com', { businessKind: 'local' })).toEqual(
      expect.objectContaining({ kind: 'Homepage', primaryType: 'LocalBusiness', pagePath: '/' }),
    );
  });

  it('normalizes path casing/trailing slash and classifies blog/service/location/legal', () => {
    expect(classifyPage('https://example.com/BLOG/How-To-Rank/?utm=1', 'https://example.com'))
      .toEqual(expect.objectContaining({ kind: 'BlogPosting', pagePath: '/blog/how-to-rank' }));
    expect(classifyPage('https://example.com/services/seo-audit/', 'https://example.com'))
      .toEqual(expect.objectContaining({ kind: 'Service', pagePath: '/services/seo-audit' }));
    expect(classifyPage('https://example.com/locations/austin', 'https://example.com'))
      .toEqual(expect.objectContaining({ kind: 'Location', primaryType: 'LocalBusiness' }));
    expect(classifyPage('https://example.com/privacy-policy', 'https://example.com'))
      .toEqual(expect.objectContaining({ kind: 'Legal' }));
  });

  it('falls back to WebPage for unmatched paths and malformed URLs', () => {
    expect(classifyPage('https://example.com/random-page', 'https://example.com'))
      .toEqual(expect.objectContaining({ kind: 'WebPage', pagePath: '/random-page' }));
    expect(classifyPage('not-a-real-url', 'https://example.com'))
      .toEqual(expect.objectContaining({ kind: 'WebPage' }));
  });
});
