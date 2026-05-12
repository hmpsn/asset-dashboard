import { describe, it, expect } from 'vitest';
import { extractPageElements } from '../../../../server/schema/extractors/page-elements.js';
import { createAiBudget } from '../../../../server/schema/extractors/page-elements/ai-budget.js';

describe('extractPageElements JSON-LD evidence hardening', () => {
  it('extracts sanitized SoftwareApplication + Audience evidence', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <link rel="canonical" href="https://app.example.com/platform" />
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "@id": "/platform#app",
      "name": "Faros Ops",
      "description": "Product analytics automation platform",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web",
      "featureList": ["Forecasting", "Attribution", "Forecasting", "", 123],
      "audience": { "@type": "Audience", "audienceType": "B2B SaaS teams" },
      "offers": {
        "@type": "Offer",
        "url": "/pricing",
        "availability": "https://schema.org/InStock"
      }
    }
  </script>
  <script type="application/ld+json">
    { "@context": "https://schema.org", "@type": "Audience", "audienceType": "Growth marketers" }
  </script>
</head>
<body>
  <main>
    <p>Does Faros integrate with GA4? Yes, GA4 is supported.</p>
    <p>Can I export dashboards? Yes, CSV and PDF exports are available.</p>
  </main>
</body>
</html>`;

    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://app.example.com/platform',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });

    expect(catalog.semantics?.softwareApplication).toMatchObject({
      name: 'Faros Ops',
      description: 'Product analytics automation platform',
      url: 'https://app.example.com/platform#app',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      audience: { audienceType: 'B2B SaaS teams' },
      offer: {
        url: 'https://app.example.com/pricing',
        availability: 'https://schema.org/InStock',
      },
    });
    expect(catalog.semantics?.softwareApplication?.featureList).toEqual([
      'Forecasting',
      'Attribution',
      'Forecasting',
    ]);
    expect(catalog.semantics?.pageAudience).toEqual({ audienceType: 'Growth marketers' });
  });

  it('extracts FAQ evidence only from FAQPage with at least 2 valid Q&A pairs', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Does Faros integrate with GA4?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes, GA4 is supported." }
        },
        {
          "@type": "Question",
          "name": "Can I export dashboards?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes, CSV and PDF exports are available." }
        },
        {
          "@type": "Question",
          "name": "bad",
          "acceptedAnswer": { "@type": "Answer", "text": "" }
        }
      ]
    }
  </script>
</head>
<body>
  <main>
    <p>Does Faros integrate with GA4? Yes, GA4 is supported.</p>
    <p>Can I export dashboards? Yes, CSV and PDF exports are available.</p>
  </main>
</body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://app.example.com/faq',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.semantics?.existingFaq).toEqual([
      { question: 'Does Faros integrate with GA4?', answer: 'Yes, GA4 is supported.' },
      { question: 'Can I export dashboards?', answer: 'Yes, CSV and PDF exports are available.' },
    ]);
  });

  it('drops FAQ evidence when fewer than 2 clean pairs exist', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Only one valid question?",
          "acceptedAnswer": { "@type": "Answer", "text": "Only one valid answer." }
        }
      ]
    }
  </script>
</head>
<body><main><p>Useful product for attribution reporting. Solid onboarding and support.</p></main></body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://app.example.com/faq',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.semantics?.existingFaq).toBeUndefined();
  });

  it('extracts only valid Review evidence that satisfies shared review shape', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Review",
          "author": { "@type": "Person", "name": "Ari" },
          "reviewBody": "Useful product for attribution reporting.",
          "reviewRating": { "@type": "Rating", "ratingValue": 4.8 }
        },
        {
          "@type": "Review",
          "author": "Morgan",
          "reviewBody": "Solid onboarding and support.",
          "datePublished": "2026-05-01"
        },
        {
          "@type": "Review",
          "author": "7db70641-7c75-4a26-a4d2-c279a07db59f",
          "reviewBody": "Should be dropped due to opaque author id."
        },
        {
          "@type": "Review",
          "author": "Taylor",
          "reviewBody": ""
        }
      ]
    }
  </script>
</head>
<body><main><p>Useful product for attribution reporting. Solid onboarding and support.</p></main></body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://app.example.com/reviews',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.semantics?.reviews).toEqual([
      {
        author: 'Ari',
        reviewBody: 'Useful product for attribution reporting.',
        ratingValue: 4.8,
      },
      {
        author: 'Morgan',
        reviewBody: 'Solid onboarding and support.',
        datePublished: '2026-05-01',
      },
    ]);
  });

  it('ignores FAQ and Review JSON-LD evidence that belongs to another page', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <link rel="canonical" href="https://app.example.com/current" />
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": "https://app.example.com/other#faq",
      "mainEntityOfPage": "https://app.example.com/other",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Does this belong here?",
          "acceptedAnswer": { "@type": "Answer", "text": "No, it belongs to another URL." }
        },
        {
          "@type": "Question",
          "name": "Should it be emitted?",
          "acceptedAnswer": { "@type": "Answer", "text": "No, never on this page." }
        }
      ]
    }
  </script>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Review",
      "mainEntityOfPage": "https://app.example.com/other",
      "author": "Ari",
      "reviewBody": "This review is for a different page.",
      "reviewRating": { "@type": "Rating", "ratingValue": 5 }
    }
  </script>
</head>
<body><main><p>This current page has unrelated visible content.</p></main></body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://app.example.com/current',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.semantics?.existingFaq).toBeUndefined();
    expect(catalog.semantics?.reviews).toBeUndefined();
  });

  it('drops review ratings outside the emitted 1-to-5 scale', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Review",
      "author": "Ari",
      "reviewBody": "Excellent enterprise platform.",
      "reviewRating": { "@type": "Rating", "ratingValue": 92, "bestRating": 100 }
    }
  </script>
</head>
<body><main><p>Excellent enterprise platform.</p></main></body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://app.example.com/reviews',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.semantics?.reviews).toEqual([
      {
        author: 'Ari',
        reviewBody: 'Excellent enterprise platform.',
      },
    ]);
  });

  it('drops review ratings that use a non-5-point source scale even when the raw value is below 5', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Review",
      "author": "Ari",
      "reviewBody": "Excellent enterprise platform.",
      "reviewRating": { "@type": "Rating", "ratingValue": 4.8, "bestRating": 10 }
    }
  </script>
</head>
<body><main><p>Excellent enterprise platform.</p></main></body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://app.example.com/reviews',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.semantics?.reviews).toEqual([
      {
        author: 'Ari',
        reviewBody: 'Excellent enterprise platform.',
      },
    ]);
  });

  it('rejects unsafe URLs and omits relative URLs when base origin is unavailable', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "Unsafe URL App",
      "url": "javascript:alert(1)",
      "offers": {
        "@type": "Offer",
        "url": "/pricing"
      }
    }
  </script>
</head>
<body></body>
</html>`;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'not-a-url',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });

    expect(catalog.semantics?.softwareApplication).toEqual({
      name: 'Unsafe URL App',
    });
  });
});
