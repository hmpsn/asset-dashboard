import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import {
  citationDisplayName,
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

  it('keeps branded-anchor citations for trusted technical authority hosts', () => {
    const filtered = filterAuthorityCitations(
      [
        {
          url: 'https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering',
          text: 'LangChain',
          isExternal: true,
        },
      ],
      'https://www.faros.ai/blog/harness-engineering',
    );

    expect(filtered).toEqual([
      {
        url: 'https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering',
        text: 'LangChain',
        isExternal: true,
      },
    ]);
  });

  it('keeps branded-anchor citations for cross-industry reference hosts when brand aligns with domain', () => {
    const filtered = filterAuthorityCitations(
      [
        {
          url: 'https://www.invisalign.com/provider/the-invisalign-system',
          text: 'Invisalign',
          isExternal: true,
        },
      ],
      'https://www.example-dental.com/blog/invisalign-faq',
    );

    expect(filtered).toEqual([
      {
        url: 'https://www.invisalign.com/provider/the-invisalign-system',
        text: 'Invisalign',
        isExternal: true,
      },
    ]);
  });

  it('rejects branded anchors for social/profile hosts in branded fallback mode', () => {
    const filtered = filterAuthorityCitations(
      [
        {
          url: 'https://www.linkedin.com/company/langchain',
          text: 'LinkedIn',
          isExternal: true,
        },
      ],
      'https://www.example.com/blog/agent-research',
    );

    expect(filtered).toEqual([]);
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

  it('uses URL-derived fallback display names for generic anchor labels', () => {
    expect(citationDisplayName({
      url: 'https://www.anthropic.com/engineering/harness-design-long-running-apps',
      text: 'research',
    })).toBe('Harness Design Long Running Apps');
  });

  it('preserves meaningful non-generic anchor labels for display names', () => {
    expect(citationDisplayName({
      url: 'https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering',
      text: 'LangChain',
    })).toBe('LangChain');
  });

  it('does not throw on malformed percent-encoded citation paths', () => {
    expect(citationDisplayName({
      url: 'https://example.com/%zz/resource',
      text: 'research',
    })).toBe('Resource');
  });
});
