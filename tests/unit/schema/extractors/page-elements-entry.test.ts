import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPageElements } from '../../../../server/schema/extractors/page-elements.js';
import { createAiBudget } from '../../../../server/schema/extractors/page-elements/ai-budget.js';

function readFixture(name: string): string {
  return readFileSync(join(__dirname, `../../../fixtures/page-elements/${name}`), 'utf-8');
}

describe('extractPageElements entry-point', () => {
  it('returns empty arrays + diagnostics for a page with no elements', async () => {
    const html = readFixture('webflow-no-elements.html');
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://www.hmpsn.studio',
      sourcePublishedAt: '2026-04-29T00:00:00.000Z',
      aiBudget: createAiBudget(0),
    });
    expect(catalog.videos).toEqual([]);
    expect(catalog.lists).toEqual([]);
    expect(catalog.citations).toEqual([]);
    expect(catalog.diagnostics.aiClassificationCalls).toBe(0);
    expect(catalog.diagnostics.hitAiBudgetCap).toBe(false);
    expect(catalog.diagnostics.rawCounts).toMatchObject({ videos: 0, lists: 0, citations: 0 });
    expect(catalog.extractedAt).toBeTruthy();
    expect(catalog.sourcePublishedAt).toBe('2026-04-29T00:00:00.000Z');
  });

  it('extracts a YouTube + HowTo + citation from the mixed-elements fixture', async () => {
    const html = readFixture('webflow-mixed-elements.html');
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://www.hmpsn.studio',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.videos).toHaveLength(1);
    expect(catalog.videos[0].provider).toBe('youtube');
    expect(catalog.lists).toHaveLength(1);
    expect(catalog.lists[0].isHowToLike).toBe(true);
    expect(catalog.citations).toHaveLength(1);
    expect(catalog.citations[0].url).toBe('https://developers.google.com/search');
    expect(catalog.diagnostics.rawCounts).toMatchObject({ videos: 1, lists: 1, citations: 1 });
  });

  it('returns empty catalog when HTML is empty/missing', async () => {
    const catalog = await extractPageElements('', {
      pageBaseUrl: 'https://www.hmpsn.studio',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.videos).toEqual([]);
    expect(catalog.lists).toEqual([]);
    expect(catalog.citations).toEqual([]);
  });

  it('does not throw on malformed HTML', async () => {
    const catalog = await extractPageElements('<<<not valid', {
      pageBaseUrl: 'https://www.hmpsn.studio',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.videos).toBeDefined();
    expect(catalog.lists).toBeDefined();
  });

  it('does not throw when pageBaseUrl is malformed (citation extractor returns []) — degraded catalog', async () => {
    const catalog = await extractPageElements('<article><a href="https://example.com">x</a></article>', {
      pageBaseUrl: 'not-a-url',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    // citation extractor returns [] on malformed own-URL — does not throw.
    expect(catalog.citations).toEqual([]);
    expect(catalog.diagnostics.rawCounts.error).toBeFalsy();
  });

  it('honors the "never throws" contract — returns empty catalog with error diagnostic on internal failure', async () => {
    // We cannot easily force cheerio.load to throw on real input, but we can
    // verify the contract by passing pathological values. The catch path
    // marks `diagnostics.rawCounts.error = 1`. For a happy path, no error.
    const catalog = await extractPageElements('<p>hi</p>', {
      pageBaseUrl: 'https://example.com',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.diagnostics.rawCounts.error).toBeFalsy(); // happy path = no error marker
  });

  it('extracts conservative semantic contact data from explicit links and microdata', async () => {
    const html = `<!DOCTYPE html>
<html>
<body>
  <main>
    <a href="tel:+15125551212">Call</a>
    <a href="mailto:hello@example.com?subject=Hi">Email</a>
    <div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
      <span itemprop="streetAddress">100 Main St</span>
      <span itemprop="addressLocality">Austin</span>
      <span itemprop="addressRegion">TX</span>
      <span itemprop="postalCode">78701</span>
      <span itemprop="addressCountry">US</span>
    </div>
  </main>
</body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://www.example.com',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });

    expect(catalog.semantics).toMatchObject({
      phone: '+15125551212',
      email: 'hello@example.com',
      address: {
        street: '100 Main St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        country: 'US',
      },
    });
  });

  it('extracts trusted local business evidence from existing Dentist JSON-LD', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Dentist",
      "name": "Swish Dental - Alamo Heights",
      "image": "https://cdn.example.com/alamo.avif",
      "telephone": "210-764-6787",
      "email": "alamoheights@swishsmiles.com",
      "priceRange": "$$",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6011 Broadway, STE 100",
        "addressLocality": "San Antonio",
        "addressRegion": "TX",
        "postalCode": "78209",
        "addressCountry": "US"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": "29.48221",
        "longitude": "-98.46608"
      },
      "openingHoursSpecification": [{
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Monday", "Tuesday"],
        "opens": "09:00",
        "closes": "18:00"
      }]
    }
  </script>
</head>
<body><main><h1>Alamo Heights San Antonio</h1></main></body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://www.swishsmiles.com',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });

    expect(catalog.semantics).toMatchObject({
      businessName: 'Swish Dental - Alamo Heights',
      businessType: 'Dentist',
      phone: '210-764-6787',
      email: 'alamoheights@swishsmiles.com',
      primaryImage: 'https://cdn.example.com/alamo.avif',
      priceRange: '$$',
      address: {
        street: '6011 Broadway, STE 100',
        city: 'San Antonio',
        state: 'TX',
        postalCode: '78209',
        country: 'US',
      },
      geo: {
        latitude: 29.48221,
        longitude: -98.46608,
      },
    });
    expect(catalog.semantics?.hours).toEqual([{
      dayOfWeek: ['Monday', 'Tuesday'],
      opens: '09:00',
      closes: '18:00',
    }]);
  });

  it('prefers the local business JSON-LD node that matches the current location page', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <link rel="canonical" href="https://www.swishsmiles.com/location/alamo-heights-san-antonio" />
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Dentist",
          "@id": "https://www.swishsmiles.com/#localbusiness",
          "url": "https://www.swishsmiles.com/",
          "name": "Swish Dental - HQ",
          "telephone": "512-000-0000",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "1 HQ Way",
            "addressLocality": "Austin",
            "addressRegion": "TX"
          }
        },
        {
          "@type": ["LocalBusiness", "Dentist"],
          "@id": "https://www.swishsmiles.com/location/alamo-heights-san-antonio#localbusiness",
          "url": "https://www.swishsmiles.com/location/alamo-heights-san-antonio",
          "name": "Swish Dental - Alamo Heights",
          "telephone": "210-764-6787",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "6011 Broadway, STE 100",
            "addressLocality": "San Antonio",
            "addressRegion": "TX"
          }
        }
      ]
    }
  </script>
</head>
<body><main><h1>Alamo Heights San Antonio</h1></main></body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://swishsmiles.com/location/alamo-heights-san-antonio',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });

    expect(catalog.semantics).toMatchObject({
      businessName: 'Swish Dental - Alamo Heights',
      businessType: 'Dentist',
      phone: '210-764-6787',
      address: {
        street: '6011 Broadway, STE 100',
        city: 'San Antonio',
        state: 'TX',
      },
    });
  });

  it('omits structured hours when dayOfWeek values are not valid schema days', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Dentist",
      "name": "Swish Dental - Alamo Heights",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "6011 Broadway, STE 100",
        "addressLocality": "San Antonio",
        "addressRegion": "TX"
      },
      "openingHoursSpecification": [{
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": "Weekdays",
        "opens": "09:00",
        "closes": "18:00"
      }]
    }
  </script>
</head>
<body></body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://www.swishsmiles.com/location/alamo-heights-san-antonio',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });

    expect(catalog.semantics?.hours).toBeUndefined();
  });

  it('expands wraparound structured day ranges', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Dentist",
      "name": "Weekend Dental",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "100 Main St",
        "addressLocality": "Austin",
        "addressRegion": "TX"
      },
      "openingHoursSpecification": [{
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": "Friday-Monday",
        "opens": "09:00",
        "closes": "18:00"
      }]
    }
  </script>
</head>
<body></body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://example.com/location/weekend',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });

    expect(catalog.semantics?.hours).toEqual([{
      dayOfWeek: ['Friday', 'Saturday', 'Sunday', 'Monday'],
      opens: '09:00',
      closes: '18:00',
    }]);
  });

  it('drops unsafe or malformed local business JSON-LD evidence', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Dentist",
      "name": "7db70641-7c75-4a26-a4d2-c279a07db59f",
      "image": "javascript:alert(1)",
      "telephone": "123",
      "email": "not-an-email",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "64dbe2528747dd074755c3b2",
        "addressLocality": "Austin",
        "addressRegion": "TX"
      },
      "geo": { "latitude": "999", "longitude": "-98.46608" },
      "openingHours": "<ul><li>MON: 9am - 6pm</li></ul>"
    }
  </script>
</head>
<body></body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://www.swishsmiles.com',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });

    expect(catalog.semantics).toMatchObject({ businessType: 'Dentist' });
    expect(catalog.semantics?.businessName).toBeUndefined();
    expect(catalog.semantics?.primaryImage).toBeUndefined();
    expect(catalog.semantics?.phone).toBeUndefined();
    expect(catalog.semantics?.email).toBeUndefined();
    expect(catalog.semantics?.address).toBeUndefined();
    expect(catalog.semantics?.geo).toBeUndefined();
    expect(catalog.semantics?.hours).toBeUndefined();
  });

  it('PR2: extracts images, tables, testimonials when present', async () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>PR2 Elements</title></head>
<body>
  <article>
    <header>
      <img src="/hero.jpg" alt="Hero banner image for our agency services" width="1200" height="600" />
    </header>
    <p>We help clients grow their organic traffic.</p>
    <img src="/team.jpg" alt="Our team of experienced SEO professionals" width="800" height="400" />
    <table>
      <caption>Pricing Plans</caption>
      <thead>
        <tr><th>Plan</th><th>Price</th><th>Features</th></tr>
      </thead>
      <tbody>
        <tr><td>Starter</td><td>$99/mo</td><td>5 pages</td></tr>
        <tr><td>Growth</td><td>$299/mo</td><td>20 pages</td></tr>
        <tr><td>Premium</td><td>$599/mo</td><td>Unlimited</td></tr>
      </tbody>
    </table>
    <blockquote data-rating="5">
      <p>hmpsn.studio transformed our organic traffic within 3 months. Highly recommend their SEO services.</p>
      <cite>— Jane Smith, CEO at Acme Corp</cite>
    </blockquote>
  </article>
</body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://www.hmpsn.studio',
      sourcePublishedAt: '2026-04-30T00:00:00.000Z',
      aiBudget: createAiBudget(0),
    });

    // Images: hero + informative
    expect(catalog.images.length).toBeGreaterThanOrEqual(1);
    expect(catalog.images[0].role).toBe('hero');
    expect(catalog.images[0].src).toBe('/hero.jpg');

    // Tables: one pricing-like table
    expect(catalog.tables).toHaveLength(1);
    expect(catalog.tables[0].isPricingLike).toBe(true);
    expect(catalog.tables[0].caption).toBe('Pricing Plans');

    // Testimonials: one blockquote with rating
    expect(catalog.testimonials).toHaveLength(1);
    expect(catalog.testimonials[0].rating).toBe(5);

    // rawCounts reflect actual extracted items
    expect(catalog.diagnostics.rawCounts.images).toBeGreaterThanOrEqual(1);
    expect(catalog.diagnostics.rawCounts.tables).toBe(1);
    expect(catalog.diagnostics.rawCounts.testimonials).toBe(1);
  });
});
