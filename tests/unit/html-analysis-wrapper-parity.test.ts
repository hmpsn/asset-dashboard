import { describe, it, expect } from 'vitest';
import { extractLinks as extractCanonicalLinks, extractImgTags as extractCanonicalImgs, countWords as countCanonicalWords } from '../../server/html-analysis-utils.js';
import { extractLinks as extractSeoLinks, extractImgTags as extractSeoImgs, countWords as countSeoWords } from '../../server/seo-audit-html.js';
import { extractLinks as extractSalesLinks, extractImgTags as extractSalesImgs, countWords as countSalesWords } from '../../server/sales-audit.js';

describe('html-analysis wrapper parity', () => {
  const html = `
    <a href="/about" rel="nofollow">About</a>
    <img src="/hero.jpg" alt="Hero" width="1200" height="800" loading="lazy" />
    <img src="/logo.jpg" />
    <p>Local SEO agency services</p>
  `;

  it('seo wrapper matches canonical rel/img behavior', () => {
    expect(extractSeoLinks(html)).toEqual(extractCanonicalLinks(html, { includeRel: true }));
    expect(extractSeoImgs(html)).toEqual(extractCanonicalImgs(html));
  });

  it('sales wrapper preserves projected output shape', () => {
    expect(extractSalesLinks(html)).toEqual(
      extractCanonicalLinks(html).map(link => ({ href: link.href, text: link.text }))
    );
    expect(extractSalesImgs(html)).toEqual(
      extractCanonicalImgs(html).map(img => ({
        src: img.src,
        alt: img.alt,
        loading: img.loading,
        hasWidth: img.hasWidth,
        hasHeight: img.hasHeight,
      }))
    );
  });

  it('word counting stays identical across wrappers', () => {
    const canonical = countCanonicalWords(html);
    expect(countSeoWords(html)).toBe(canonical);
    expect(countSalesWords(html)).toBe(canonical);
  });
});
