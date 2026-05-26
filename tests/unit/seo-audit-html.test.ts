import { describe, expect, it } from 'vitest';
import {
  stripHiddenElements,
  extractTag,
  extractMetaContent,
  countWords,
  extractLinks,
  extractImgTags,
  extractStyleBlocks,
  extractInlineScripts,
  countExternalResources,
} from '../../server/seo-audit-html.js';

describe('stripHiddenElements', () => {
  it('removes elements with display:none inline style', () => {
    const html = `<div><div style="display:none"><p>Hidden content</p></div><p>Visible</p></div>`;
    const result = stripHiddenElements(html);
    expect(result).not.toContain('Hidden content');
    expect(result).toContain('Visible');
  });

  it('removes elements with w-condition-invisible class', () => {
    const html = `<section class="w-condition-invisible"><h2>Invisible Section</h2></section><p>Shown</p>`;
    const result = stripHiddenElements(html);
    expect(result).not.toContain('Invisible Section');
    expect(result).toContain('Shown');
  });

  it('removes elements with visibility:hidden style', () => {
    const html = `<div style="visibility:hidden"><span>Invisible span</span></div><span>Visible span</span>`;
    const result = stripHiddenElements(html);
    expect(result).not.toContain('Invisible span');
    expect(result).toContain('Visible span');
  });

  it('handles nested hidden elements correctly', () => {
    const html = `<div style="display:none"><div><div>Triple nested</div></div></div><p>After</p>`;
    const result = stripHiddenElements(html);
    expect(result).not.toContain('Triple nested');
    expect(result).toContain('After');
  });

  it('returns unchanged html when no hidden elements present', () => {
    const html = `<div><p>All visible</p><span>Also visible</span></div>`;
    const result = stripHiddenElements(html);
    expect(result).toBe(html);
  });

  it('strips hidden img void elements when block-level hidden elements are also present', () => {
    // The void-element stripping regex only runs when at least one block-level hidden
    // element was found (due to early-return on line 66 of seo-audit-html.ts).
    // When the HTML contains BOTH a hidden block element AND a hidden img, both are stripped.
    const html = [
      '<div style="display:none"><p>Hidden block</p></div>',
      '<img src="hidden.jpg" style="display:none" alt="hidden">',
      '<img src="visible.jpg" alt="visible">',
    ].join('');
    const result = stripHiddenElements(html);
    expect(result).not.toContain('Hidden block');
    expect(result).not.toContain('hidden.jpg');
    expect(result).toContain('visible.jpg');
  });
});

describe('extractTag', () => {
  it('extracts h1 content', () => {
    const html = `<html><body><h1>Page Title</h1></body></html>`;
    const result = extractTag(html, 'h1');
    expect(result).toEqual(['Page Title']);
  });

  it('extracts multiple h2 tags', () => {
    const html = `<h2>First Heading</h2><p>Content</p><h2>Second Heading</h2>`;
    const result = extractTag(html, 'h2');
    expect(result).toEqual(['First Heading', 'Second Heading']);
  });

  it('returns empty array when tag not found', () => {
    const html = `<div><p>No headings here</p></div>`;
    expect(extractTag(html, 'h1')).toEqual([]);
  });

  it('extracts title tag', () => {
    const html = `<html><head><title>My Page Title</title></head></html>`;
    const result = extractTag(html, 'title');
    expect(result).toEqual(['My Page Title']);
  });
});

describe('extractMetaContent', () => {
  it('extracts meta description by name attribute', () => {
    const html = `<meta name="description" content="This is the description">`;
    expect(extractMetaContent(html, 'description')).toBe('This is the description');
  });

  it('extracts og:title by property attribute', () => {
    const html = `<meta property="og:title" content="OG Title Here">`;
    expect(extractMetaContent(html, 'og:title')).toBe('OG Title Here');
  });

  it('handles reversed attribute order (content before name)', () => {
    const html = `<meta content="Reversed order" name="description">`;
    expect(extractMetaContent(html, 'description')).toBe('Reversed order');
  });

  it('returns null when meta tag not found', () => {
    const html = `<html><head><title>No meta</title></head></html>`;
    expect(extractMetaContent(html, 'description')).toBeNull();
  });
});

describe('countWords', () => {
  it('counts words in plain HTML', () => {
    const html = `<p>Hello world this is a test</p>`;
    expect(countWords(html)).toBe(6);
  });

  it('excludes script content from word count', () => {
    const html = `<p>Real content here</p><script>var x = "not counted words text";</script>`;
    expect(countWords(html)).toBe(3);
  });

  it('excludes style blocks from word count', () => {
    const html = `<p>Just three words</p><style>.not-counted { display: none; }</style>`;
    expect(countWords(html)).toBe(3);
  });

  it('returns 0 for empty input', () => {
    expect(countWords('')).toBe(0);
  });

  it('handles multiple tags and normalizes whitespace', () => {
    const html = `<h1>Title</h1>   <p>Body   content</p>`;
    // 'Title' + 'Body' + 'content' = 3
    expect(countWords(html)).toBe(3);
  });
});

describe('extractLinks', () => {
  it('extracts href and text from anchor tags', () => {
    const html = `<a href="https://example.com">Click here</a>`;
    const links = extractLinks(html);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ href: 'https://example.com', text: 'Click here' });
  });

  it('extracts rel attribute when present', () => {
    const html = `<a href="https://external.com" rel="nofollow">External</a>`;
    const links = extractLinks(html);
    expect(links[0].rel).toBe('nofollow');
  });

  it('returns undefined rel when not present', () => {
    const html = `<a href="/about">About</a>`;
    const links = extractLinks(html);
    expect(links[0].rel).toBeUndefined();
  });

  it('returns empty array for no links', () => {
    const html = `<p>No links here</p>`;
    expect(extractLinks(html)).toHaveLength(0);
  });

  it('extracts multiple links', () => {
    const html = `<a href="/page1">Page 1</a><a href="/page2">Page 2</a>`;
    const links = extractLinks(html);
    expect(links).toHaveLength(2);
    expect(links[1].href).toBe('/page2');
  });

  it('strips nested HTML tags from link text', () => {
    const html = `<a href="/item"><span>Nested <strong>Text</strong></span></a>`;
    const links = extractLinks(html);
    expect(links[0].text).toBe('Nested Text');
  });
});

describe('extractImgTags', () => {
  it('extracts src, alt, and hasAlt from images', () => {
    const html = `<img src="photo.jpg" alt="A photo">`;
    const imgs = extractImgTags(html);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toMatchObject({ src: 'photo.jpg', alt: 'A photo', hasAlt: true });
  });

  it('detects images without alt attribute', () => {
    const html = `<img src="noalt.jpg">`;
    const imgs = extractImgTags(html);
    expect(imgs[0].hasAlt).toBe(false);
    expect(imgs[0].alt).toBe('');
  });

  it('detects lazy loading attribute', () => {
    const html = `<img src="lazy.jpg" alt="Lazy" loading="lazy">`;
    const imgs = extractImgTags(html);
    expect(imgs[0].loading).toBe('lazy');
  });

  it('detects width and height attributes', () => {
    const html = `<img src="sized.jpg" alt="Sized" width="800" height="600">`;
    const imgs = extractImgTags(html);
    expect(imgs[0].hasWidth).toBe(true);
    expect(imgs[0].hasHeight).toBe(true);
  });

  it('reports missing width and height', () => {
    const html = `<img src="unsized.jpg" alt="Unsized">`;
    const imgs = extractImgTags(html);
    expect(imgs[0].hasWidth).toBe(false);
    expect(imgs[0].hasHeight).toBe(false);
  });

  it('returns empty array for no img tags', () => {
    expect(extractImgTags('<p>No images</p>')).toHaveLength(0);
  });
});

describe('extractStyleBlocks', () => {
  it('counts total characters in style blocks', () => {
    const css = '.foo { color: red; }';
    const html = `<style>${css}</style>`;
    expect(extractStyleBlocks(html)).toBe(css.length);
  });

  it('sums characters across multiple style blocks', () => {
    const css1 = '.a{color:red}';
    const css2 = '.b{color:blue}';
    const html = `<style>${css1}</style><style>${css2}</style>`;
    expect(extractStyleBlocks(html)).toBe(css1.length + css2.length);
  });

  it('returns 0 for html with no style blocks', () => {
    expect(extractStyleBlocks('<div><p>No styles</p></div>')).toBe(0);
  });
});

describe('extractInlineScripts', () => {
  it('counts inline script characters (not external)', () => {
    const js = 'console.log("hello");';
    const html = `<script>${js}</script>`;
    expect(extractInlineScripts(html)).toBe(js.length);
  });

  it('excludes external src scripts', () => {
    const html = `<script src="bundle.js"></script>`;
    expect(extractInlineScripts(html)).toBe(0);
  });

  it('excludes JSON-LD structured data', () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org"}</script>`;
    expect(extractInlineScripts(html)).toBe(0);
  });

  it('sums multiple inline scripts', () => {
    const js1 = 'var a=1;';
    const js2 = 'var b=2;';
    const html = `<script>${js1}</script><script>${js2}</script>`;
    expect(extractInlineScripts(html)).toBe(js1.length + js2.length);
  });
});

describe('countExternalResources', () => {
  it('counts external stylesheets', () => {
    const html = `<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="extra.css">`;
    const result = countExternalResources(html);
    expect(result.stylesheets).toBe(2);
    expect(result.scripts).toBe(0);
  });

  it('counts external scripts', () => {
    const html = `<script src="app.js"></script><script src="vendor.js"></script>`;
    const result = countExternalResources(html);
    expect(result.scripts).toBe(2);
    expect(result.stylesheets).toBe(0);
  });

  it('counts both stylesheets and scripts', () => {
    const html = `<link rel="stylesheet" href="a.css"><script src="b.js"></script>`;
    const result = countExternalResources(html);
    expect(result.stylesheets).toBe(1);
    expect(result.scripts).toBe(1);
  });

  it('returns zeros for html with no external resources', () => {
    const result = countExternalResources('<p>Plain content</p>');
    expect(result.stylesheets).toBe(0);
    expect(result.scripts).toBe(0);
  });
});
