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
        <a href="https://example.com">Real external</a>
      </article>
    `);
    const citations = extractCitations($, 'https://www.hmpsn.studio');
    expect(citations).toHaveLength(1);
    expect(citations[0].url).toBe('https://example.com');
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

  it('captures empty anchor text gracefully (image-only links)', () => {
    const $ = cheerio.load(`
      <article>
        <a href="https://example.com"><img src="/icon.png" alt="Logo"></a>
      </article>
    `);
    const citations = extractCitations($, 'https://www.hmpsn.studio');
    expect(citations).toHaveLength(1);
    expect(citations[0].text).toBe('');
    expect(citations[0].url).toBe('https://example.com');
  });
});
