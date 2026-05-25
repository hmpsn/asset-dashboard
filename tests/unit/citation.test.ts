import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import {
  extractCitations,
  filterAuthorityCitations,
} from '../../server/schema/extractors/page-elements/citation.js';

describe('citation extractor', () => {
  it('filters citations by authority, dedupes normalized URLs, and excludes internal links', () => {
    const filtered = filterAuthorityCitations(
      [
        { url: 'https://developers.google.com/search/docs#intro', text: 'Google documentation', isExternal: true },
        { url: 'https://developers.google.com/search/docs#other', text: 'Google documentation', isExternal: true },
        { url: 'https://example.com/docs', text: 'Click here', isExternal: true }, // weak anchor
        { url: 'https://calendly.com/demo', text: 'Book now', isExternal: true }, // commercial
        { url: 'https://mysite.com/research', text: 'Research report', isExternal: true }, // internal
      ],
      'https://mysite.com/page',
    );

    expect(filtered).toEqual([
      {
        url: 'https://developers.google.com/search/docs',
        text: 'Google documentation',
        isExternal: true,
      },
    ]);
  });

  it('caps authority citations to MAX_CITATIONS (5)', () => {
    const citations = Array.from({ length: 7 }, (_, i) => ({
      url: `https://docs${i}.example.org/research/report-${i}`,
      text: `Research report ${i}`,
      isExternal: true,
    }));
    const filtered = filterAuthorityCitations(citations, 'https://mysite.com');
    expect(filtered).toHaveLength(5);
  });

  it('extractCitations collects links from content scope and filters non-authority/unsupported links', () => {
    const html = `
      <html><body>
        <nav><a href="https://developers.google.com/search/docs">Google docs (nav)</a></nav>
        <article>
          <a href="https://developers.google.com/search/docs">Google documentation</a>
          <a href="/internal-page">Internal link</a>
          <a href="mailto:test@example.com">Email us</a>
          <a href="https://example.com/pricing">Book now</a>
        </article>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const citations = extractCitations($, 'https://mysite.com');

    expect(citations).toEqual([
      {
        url: 'https://developers.google.com/search/docs',
        text: 'Google documentation',
        isExternal: true,
      },
    ]);
  });
});
