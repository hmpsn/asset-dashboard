import { describe, it, expect } from 'vitest';
import {
  countWords,
  extractLinks,
  extractInlineScripts,
  extractImgTags,
  countExternalResources,
} from '../../server/html-analysis-utils.js';

describe('html-analysis-utils', () => {
  it('countWords strips script/style blocks and HTML tags', () => {
    const html = `
      <html>
        <head>
          <style>.x { color: red; }</style>
          <script>console.log('ignored')</script>
        </head>
        <body><h1>Hello world</h1><p>SEO health check</p></body>
      </html>
    `;
    expect(countWords(html)).toBe(5);
  });

  it('extractInlineScripts excludes external and JSON-LD scripts', () => {
    const inlineA = "window.foo = 1;";
    const inlineB = "console.log('ok');";
    const html = `
      <script src="/bundle.js"></script>
      <script type="application/ld+json">{"@context":"https://schema.org"}</script>
      <script>${inlineA}</script>
      <script>${inlineB}</script>
    `;
    expect(extractInlineScripts(html)).toBe(inlineA.length + inlineB.length);
  });

  it('extractLinks supports rel capture + onclick/form extraction + dedupe/filter', () => {
    const html = `
      <a href="/about" rel="nofollow">About</a>
      <a href="/about">About Duplicate</a>
      <button onclick="window.location.href='/contact'">Contact Us</button>
      <form action="/subscribe"></form>
      <a href="#skip">Skip</a>
      <a href="mailto:test@example.com">Email</a>
    `;
    const links = extractLinks(html, {
      includeRel: true,
      includeOnclickUrls: true,
      includeFormActions: true,
      dedupeByHref: true,
      excludeHashAnchors: true,
      requireNonEmptyHref: true,
      filterHref: href => !href.startsWith('mailto:'),
      maxTextLength: 40,
    });
    expect(links).toHaveLength(3);
    expect(links[0]).toEqual({ href: '/about', text: 'About', rel: 'nofollow' });
    expect(links[1].href).toBe('/contact');
    expect(links[1].text.length).toBeGreaterThan(0);
    expect(links[2]).toEqual({ href: '/subscribe', text: '[form action]', rel: undefined });
  });

  it('extractImgTags reports hasAlt and dimension/loading hints', () => {
    const html = `
      <img src="/a.jpg" alt="Hero" loading="lazy" width="100" height="80" />
      <img src="/b.jpg" />
    `;
    const imgs = extractImgTags(html);
    expect(imgs).toEqual([
      { src: '/a.jpg', alt: 'Hero', hasAlt: true, loading: 'lazy', hasWidth: true, hasHeight: true },
      { src: '/b.jpg', alt: '', hasAlt: false, loading: undefined, hasWidth: false, hasHeight: false },
    ]);
  });

  it('countExternalResources counts stylesheets and external scripts', () => {
    const html = `
      <link rel="stylesheet" href="/app.css" />
      <link rel="stylesheet" href="/theme.css" />
      <script src="/vendor.js"></script>
      <script>console.log('inline')</script>
    `;
    expect(countExternalResources(html)).toEqual({ stylesheets: 2, scripts: 1 });
  });
});
