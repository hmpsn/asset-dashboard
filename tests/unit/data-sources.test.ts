import { describe, expect, it } from 'vitest';
import { extractPageData, type ExtractInput } from '../../server/schema/data-sources.js';

function makeInput(overrides: Partial<ExtractInput> = {}): ExtractInput {
  const { pageMeta: pageMetaOverride, workspace: workspaceOverride, html, baseUrl } = overrides;
  return {
    pageMeta: {
      title: 'Default Title',
      slug: 'default-title',
      publishedPath: '/services/default-title',
      createdOn: '2026-01-01T00:00:00.000Z',
      lastPublished: '2026-02-01T00:00:00.000Z',
      pageKeywords: {
        primary: 'Default keyword',
        secondary: ['Secondary one'],
      },
      ...(pageMetaOverride ?? {}),
    },
    html: html ?? '<html><body><main><h1>Default Title</h1></main></body></html>',
    baseUrl: baseUrl ?? 'https://example.com',
    workspace: {
      id: 'ws_1',
      name: 'Acme Dental',
      publisherLogoUrl: 'https://cdn.example.com/logo.png',
      defaultLocale: 'en-US',
      businessProfile: {
        address: {
          city: 'Austin',
          state: 'TX',
        },
      },
      siteKeywordsForKnowsAbout: ['Teeth Whitening', 'Dental Implants', 'Invisalign', 'Root Canal', 'Veneers', 'Orthodontics'],
      ...(workspaceOverride ?? {}),
    },
  };
}

describe('schema data-sources extractPageData', () => {
  it('uses same-site canonical URL, strips byline prefixes, and emits normalized breadcrumbs', () => {
    const input = makeInput({
      pageMeta: {
        title: 'Teeth Whitening | Acme Dental',
        slug: 'teeth-whitening',
        publishedPath: '/services/teeth-whitening',
      },
      html: `
        <html>
          <head>
            <meta name="description" content="Fast and safe whitening services." />
            <link rel="canonical" href="https://www.example.com/services/whitening" />
          </head>
          <body>
            <main>
              <h1>Professional Teeth Whitening</h1>
              <p>We help patients improve confidence and smile brighter.</p>
              <p>Our modern treatment process is fast and comfortable.</p>
              <div class="byline">By Dr. Jane Doe updated May 2026</div>
            </main>
            <nav>Navigation text should not inflate word count.</nav>
            <script>console.log('ignore me')</script>
          </body>
        </html>
      `,
    });

    const result = extractPageData(input);

    expect(result.title).toBe('Professional Teeth Whitening');
    expect(result.description).toBe('Fast and safe whitening services.');
    expect(result.canonicalUrl).toBe('https://www.example.com/services/whitening');
    expect(result.author).toBe('Dr. Jane Doe');
    expect(result.wordCount).toBeGreaterThan(10);
    expect(result.keywords).toBe('Default keyword, Secondary one');
    expect(result.areaServed).toBe('Austin, TX');

    expect(result.publisher).toEqual({
      name: 'Acme Dental',
      logoUrl: 'https://cdn.example.com/logo.png',
    });

    expect(result.breadcrumbs).toEqual([
      { name: 'Home', url: 'https://www.example.com' },
      { name: 'Services', url: 'https://www.example.com/services' },
      { name: 'Professional Teeth Whitening', url: 'https://www.example.com/services/whitening' },
    ]);

    expect(result.evidenceSources?.canonicalUrl).toBe('rendered-html');
    expect(result.evidenceSources?.logo).toBe('business-profile');

    expect(result.knowsAbout).toEqual([
      'teeth whitening',
      'dental implants',
      'invisalign',
      'root canal',
      'veneers',
    ]);
  });

  it('falls back to configured canonical, honors service profile overrides, and preserves locale fallback', () => {
    const input = makeInput({
      pageMeta: {
        title: 'Emergency Dentistry',
        slug: 'acme-service-page',
        publishedPath: '/services/acme-services-page',
        locale: null,
        serviceProfile: {
          serviceName: '24/7 Emergency Dentist',
          serviceType: 'Emergency Dentistry',
          areaServed: 'Dallas, TX',
          offers: [
            { name: 'Emergency Exam', price: '120.00', priceCurrency: 'USD' },
          ],
        },
      },
      html: `
        <html>
          <head>
            <link rel="canonical" href="https://malicious.example.net/services/hijack" />
          </head>
          <body>
            <main><h1>Emergency Dentistry</h1></main>
          </body>
        </html>
      `,
    });

    const result = extractPageData(input);

    expect(result.canonicalUrl).toBe('https://example.com/services/acme-services-page');
    expect(result.inLanguage).toBe('en-US');

    expect(result.serviceName).toBe('24/7 Emergency Dentist');
    expect(result.serviceType).toBe('Emergency Dentistry');
    expect(result.areaServed).toBe('Dallas, TX');
    expect(result.offers).toEqual([
      { name: 'Emergency Exam', price: '120.00', priceCurrency: 'USD' },
    ]);

    expect(result.breadcrumbs[0]).toEqual({ name: 'Home', url: 'https://example.com' });
    expect(result.breadcrumbs[result.breadcrumbs.length - 1]).toEqual({
      name: 'Emergency Dentistry',
      url: 'https://example.com/services/acme-services-page',
    });
  });
});
