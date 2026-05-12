import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractCitations } from '../../../../server/schema/extractors/page-elements/citation.js';

function fixture(name: string): cheerio.CheerioAPI {
  const html = readFileSync(join(__dirname, `../../../fixtures/page-elements/${name}`), 'utf-8');
  return cheerio.load(html);
}

describe('extractCitations', () => {
  it('extracts external citations from article body and skips nav/footer + internal links', () => {
    const $ = fixture('webflow-blog-with-citations.html');
    const citations = extractCitations($, 'https://www.hmpsn.studio');
    // Should find 2 external citations from <article>; nav + footer + internal-link skipped
    expect(citations).toHaveLength(2);
    expect(citations[0]).toEqual({
      url: 'https://web.dev/articles/vitals',
      text: "Google's Web Vitals docs",
      isExternal: true,
    });
    expect(citations[1]).toEqual({
      url: 'https://developer.mozilla.org/en-US/docs/Web/API/Performance_API',
      text: 'MDN Performance API guide',
      isExternal: true,
    });
  });

  it('returns empty array when no <article> on page', () => {
    const $ = cheerio.load('<body><p>Just text. <a href="https://external.com">Link</a></p></body>');
    expect(extractCitations($, 'https://www.hmpsn.studio')).toEqual([]);
  });

  it('skips citations with empty href or javascript:/mailto:', () => {
    const $ = cheerio.load(`
      <article>
        <a href="">Empty</a>
        <a href="javascript:void(0)">JS</a>
        <a href="mailto:a@b.com">Email</a>
        <a href="https://example.com/research/report">External research report</a>
      </article>
    `);
    const citations = extractCitations($, 'https://www.hmpsn.studio');
    expect(citations).toHaveLength(1);
    expect(citations[0].url).toBe('https://example.com/research/report');
  });

  it('skips relative-path links (treats them as internal)', () => {
    const $ = cheerio.load(`
      <article>
        <a href="/about">Internal</a>
        <a href="../other">Internal too</a>
      </article>
    `);
    expect(extractCitations($, 'https://www.hmpsn.studio')).toEqual([]);
  });

  it('skips empty anchor text and image-only links because they are weak citations', () => {
    const $ = cheerio.load(`
      <article>
        <a href="https://example.com"><img src="/icon.png" alt="Logo"></a>
      </article>
    `);
    expect(extractCitations($, 'https://www.hmpsn.studio')).toEqual([]);
  });

  it('skips tel:, data:, blob:, file:, and vbscript: schemes (allowlist defense-in-depth)', () => {
    const $ = cheerio.load(`
      <article>
        <a href="tel:+15551234567">Call us</a>
        <a href="data:text/html,<h1>x</h1>">Data URI</a>
        <a href="blob:https://example.com/abc">Blob</a>
        <a href="file:///etc/passwd">File</a>
        <a href="vbscript:msgbox(1)">VB</a>
        <a href="https://example.com/research/report">Allowed research report</a>
      </article>
    `);
    const citations = extractCitations($, 'https://www.hmpsn.studio');
    expect(citations).toHaveLength(1);
    expect(citations[0].url).toBe('https://example.com/research/report');
  });

  it('skips in-page anchor hrefs (#section)', () => {
    const $ = cheerio.load(`
      <article>
        <a href="#methodology">Methodology</a>
        <a href="#references">References</a>
        <a href="https://nih.gov/research">External cite</a>
      </article>
    `);
    const citations = extractCitations($, 'https://www.hmpsn.studio');
    expect(citations).toHaveLength(1);
    expect(citations[0].url).toBe('https://nih.gov/research');
  });

  it('skips absolute same-host links (subdomain treated as external — intentional)', () => {
    const $ = cheerio.load(`
      <article>
        <a href="https://www.hmpsn.studio/about">Same host</a>
        <a href="https://blog.hmpsn.studio/research/report">Subdomain research report</a>
        <a href="https://external.com/research/report">External research report</a>
      </article>
    `);
    const citations = extractCitations($, 'https://www.hmpsn.studio');
    // Same exact hostname is filtered; subdomain is a different hostname (treated external).
    expect(citations).toHaveLength(2);
    expect(citations.map(c => c.url)).toEqual([
      'https://blog.hmpsn.studio/research/report',
      'https://external.com/research/report',
    ]);
  });

  it('filters CTA and weak-anchor links while keeping informational authority citations', () => {
    const $ = cheerio.load(`
      <article>
        <a href="https://scheduler.example.com/book">Drop some time on my calendar</a>
        <a href="https://payments.example.com/affirm">Affirm</a>
        <a href="https://example.com/research#methodology">click here</a>
        <a href="https://developers.google.com/search/docs/appearance/structured-data/article#guidelines">Google Article structured data guidelines</a>
        <a href="https://booking.com/research/report">Booking.com industry report</a>
        <a href="https://example.edu/contact-tracing-study">Contact tracing efficacy study</a>
      </article>
    `);

    expect(extractCitations($, 'https://www.hmpsn.studio')).toEqual([
      {
        url: 'https://developers.google.com/search/docs/appearance/structured-data/article',
        text: 'Google Article structured data guidelines',
        isExternal: true,
      },
      {
        url: 'https://booking.com/research/report',
        text: 'Booking.com industry report',
        isExternal: true,
      },
      {
        url: 'https://example.edu/contact-tracing-study',
        text: 'Contact tracing efficacy study',
        isExternal: true,
      },
    ]);
  });

  it('dedupes and caps citations to five useful external sources', () => {
    const $ = cheerio.load(`
      <article>
        <a href="https://a.example.com/report">Report A</a>
        <a href="https://a.example.com/report#section">Report A duplicate</a>
        <a href="https://b.example.com/report">Report B</a>
        <a href="https://c.example.com/report">Report C</a>
        <a href="https://d.example.com/report">Report D</a>
        <a href="https://e.example.com/report">Report E</a>
        <a href="https://f.example.com/report">Report F</a>
      </article>
    `);

    const citations = extractCitations($, 'https://www.hmpsn.studio');
    expect(citations).toHaveLength(5);
    expect(citations.map(c => c.url)).toEqual([
      'https://a.example.com/report',
      'https://b.example.com/report',
      'https://c.example.com/report',
      'https://d.example.com/report',
      'https://e.example.com/report',
    ]);
  });

  it('filters scheduling, form, widget, and affiliate links from real-world article citations', () => {
    const $ = cheerio.load(`
      <article>
        <a href="http://www.jobportraits.com/">Job Portraits</a>
        <a href="http://www.pro.goodshuffle.com/">Goodshuffle</a>
        <a href="https://www.quercus.design/">Quercus</a>
        <a href="https://calendly.grsm.io/hmpsn">Calendly</a>
        <a href="https://typeform.grsm.io/hmpsn">Typeform</a>
        <a href="https://webflow.grsm.io/hmpsn">Webflow</a>
        <a href="https://elfsight.com/?ref=939044be-3028-4145-87f8-9accc2341da9">Elfsight</a>
        <a href="http://www.hmpsn.com/post/our-partnership-with-job-portraits-building-a-scalable-blueprint-for-careers-microsites">career micro-site template</a>
      </article>
    `);

    expect(extractCitations($, 'https://www.hmpsn.studio')).toEqual([]);
  });
});
