/**
 * Pure unit tests for server/seo-audit-html.ts
 *
 * All functions are pure string-manipulation utilities with no external
 * dependencies, no DB access, and no HTTP calls — ideal for isolated unit tests.
 *
 * Covers:
 * - stripHiddenElements: display:none, visibility:hidden, w-condition-invisible,
 *   mixed classes, nested same-type elements, adjacent elements, void elements,
 *   multiple element types, deep nesting, and edge cases.
 * - extractTag: basic extraction, multiple matches, nested (non-greedy), missing.
 * - extractMetaContent: name= first, content= first, property=, missing.
 * - countWords: strips tags/scripts/styles, handles empty input.
 * - extractLinks: href, text, rel, no-href filtered out.
 * - extractImgTags: alt presence, loading attr, width/height flags.
 * - extractStyleBlocks: sums character lengths.
 * - extractInlineScripts: excludes src= scripts and JSON-LD.
 * - countExternalResources: counts stylesheets and scripts.
 */

import { describe, it, expect } from 'vitest';
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

// ── stripHiddenElements ───────────────────────────────────────────────────────

describe('stripHiddenElements', () => {
  it('returns the original string unchanged when there are no hidden elements', () => {
    const html = '<div class="hero"><h1>Visible</h1><p>Content</p></div>';
    expect(stripHiddenElements(html)).toBe(html);
  });

  it('returns empty string unchanged without throwing', () => {
    expect(stripHiddenElements('')).toBe('');
  });

  it('strips a div with display:none and its inner content', () => {
    const html = '<div style="display:none"><span>hidden</span></div><p>visible</p>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('hidden');
    expect(result).toContain('visible');
  });

  it('strips a div with visibility:hidden and its inner content', () => {
    const html = '<div style="visibility:hidden">hidden text</div><p>visible</p>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('hidden text');
    expect(result).toContain('visible');
  });

  it('strips a div with the w-condition-invisible class', () => {
    const html = '<div class="w-condition-invisible">hidden</div><p>visible</p>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('hidden');
    expect(result).toContain('visible');
  });

  it('strips an element when w-condition-invisible is mixed with other classes', () => {
    const html = '<div class="hero w-condition-invisible block">hidden</div><p>visible</p>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('hidden');
    expect(result).toContain('visible');
  });

  it('strips only the hidden element when followed by a visible sibling', () => {
    const html = '<div style="display:none"><p>gone</p></div><div class="keep"><p>stay</p></div>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('gone');
    expect(result).toContain('keep');
    expect(result).toContain('stay');
  });

  it('strips the entire subtree of a hidden div containing nested divs', () => {
    const html =
      '<div style="display:none"><div>inner 1</div><div>inner 2</div></div><p>visible</p>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('inner 1');
    expect(result).not.toContain('inner 2');
    expect(result).toContain('visible');
  });

  it('handles deeply nested same-type tags inside a hidden element (depth-counting)', () => {
    const html =
      '<div class="w-condition-invisible"><div><div>deep</div></div></div>visible';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('deep');
    expect(result).toContain('visible');
  });

  it('strips a hidden section element', () => {
    const html = '<section style="display:none"><p>hidden section</p></section><p>shown</p>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('hidden section');
    expect(result).toContain('shown');
  });

  it('strips a hidden header element', () => {
    const html = '<header class="w-condition-invisible"><h1>hidden header</h1></header><main>shown</main>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('hidden header');
    expect(result).toContain('shown');
  });

  it('strips a hidden article element', () => {
    const html = '<article style="visibility:hidden"><p>hidden article</p></article><p>shown</p>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('hidden article');
    expect(result).toContain('shown');
  });

  it('strips a hidden p element', () => {
    const html = '<p style="display:none">hidden paragraph</p><p>visible paragraph</p>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('hidden paragraph');
    expect(result).toContain('visible paragraph');
  });

  it('strips a hidden h1 element', () => {
    const html = '<h1 class="w-condition-invisible">hidden heading</h1><h2>visible heading</h2>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('hidden heading');
    expect(result).toContain('visible heading');
  });

  it('strips multiple hidden elements independently', () => {
    const html =
      '<div style="display:none">first hidden</div>' +
      '<p>between</p>' +
      '<div class="w-condition-invisible">second hidden</div>' +
      '<p>after</p>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('first hidden');
    expect(result).not.toContain('second hidden');
    expect(result).toContain('between');
    expect(result).toContain('after');
  });

  it('strips a void img element with display:none', () => {
    const html = '<img src="x.png" style="display:none"><p>visible</p>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('x.png');
    expect(result).toContain('visible');
  });

  it('strips a void img element with w-condition-invisible class', () => {
    const html = '<img src="hidden.png" class="w-condition-invisible"><p>visible</p>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('hidden.png');
    expect(result).toContain('visible');
  });

  it('does not strip a visible img element', () => {
    const html = '<img src="visible.png" alt="test"><p>visible</p>';
    const result = stripHiddenElements(html);
    expect(result).toContain('visible.png');
  });

  it('preserves HTML outside hidden elements intact', () => {
    const html =
      '<header><nav>Navigation</nav></header>' +
      '<div style="display:none">gone</div>' +
      '<footer>Footer</footer>';
    const result = stripHiddenElements(html);
    expect(result).toContain('Navigation');
    expect(result).toContain('Footer');
    expect(result).not.toContain('gone');
  });

  it('handles a hidden span element', () => {
    const html = '<p>text <span style="display:none">hidden span</span> more</p>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('hidden span');
    expect(result).toContain('text');
    expect(result).toContain('more');
  });

  it('handles a hidden ul element', () => {
    const html = '<ul class="w-condition-invisible"><li>item 1</li><li>item 2</li></ul><p>visible</p>';
    const result = stripHiddenElements(html);
    expect(result).not.toContain('item 1');
    expect(result).not.toContain('item 2');
    expect(result).toContain('visible');
  });

  it('does not strip an element with an unrelated style attribute', () => {
    const html = '<div style="color:red">visible red div</div>';
    expect(stripHiddenElements(html)).toContain('visible red div');
  });

  it('does not strip an element with an unrelated class', () => {
    const html = '<div class="hero block visible">visible content</div>';
    expect(stripHiddenElements(html)).toContain('visible content');
  });

  it('handles html with no closing tags gracefully (endOffset guard)', () => {
    // If there is no closing tag, the element should not be stripped
    // (endOffset will be -1 and the guard `endOffset > startOffset` prevents removal)
    const html = '<div style="display:none">unclosed';
    // Should not throw — behavior may leave the content or skip it,
    // but the key requirement is no exception.
    expect(() => stripHiddenElements(html)).not.toThrow();
  });
});

// ── extractTag ────────────────────────────────────────────────────────────────

describe('extractTag', () => {
  it('extracts inner content from a single matching tag', () => {
    const html = '<title>My Page Title</title>';
    expect(extractTag(html, 'title')).toEqual(['My Page Title']);
  });

  it('returns all matches when multiple tags are present', () => {
    const html = '<h1>First</h1><p>middle</p><h1>Second</h1>';
    expect(extractTag(html, 'h1')).toEqual(['First', 'Second']);
  });

  it('returns an empty array when the tag is absent', () => {
    expect(extractTag('<p>no title</p>', 'title')).toEqual([]);
  });

  it('trims whitespace from extracted content', () => {
    const html = '<title>  Spaces Around  </title>';
    expect(extractTag(html, 'title')).toEqual(['Spaces Around']);
  });

  it('handles multiline content inside the tag', () => {
    const html = '<script type="application/ld+json">\n{"@type":"Article"}\n</script>';
    const result = extractTag(html, 'script');
    expect(result[0]).toContain('"@type":"Article"');
  });
});

// ── extractMetaContent ────────────────────────────────────────────────────────

describe('extractMetaContent', () => {
  it('extracts content when name= comes before content=', () => {
    const html = '<meta name="description" content="Page description">';
    expect(extractMetaContent(html, 'description')).toBe('Page description');
  });

  it('extracts content when content= comes before name=', () => {
    const html = '<meta content="Page description" name="description">';
    expect(extractMetaContent(html, 'description')).toBe('Page description');
  });

  it('extracts content for property= (Open Graph)', () => {
    const html = '<meta property="og:title" content="OG Title">';
    expect(extractMetaContent(html, 'og:title')).toBe('OG Title');
  });

  it('returns null when the meta name is absent', () => {
    const html = '<meta name="keywords" content="seo, test">';
    expect(extractMetaContent(html, 'description')).toBeNull();
  });

  it('returns null for empty html', () => {
    expect(extractMetaContent('', 'description')).toBeNull();
  });

  it('does not match a different meta name', () => {
    const html = '<meta name="robots" content="noindex">';
    expect(extractMetaContent(html, 'description')).toBeNull();
  });
});

// ── countWords ────────────────────────────────────────────────────────────────

describe('countWords', () => {
  it('counts words in plain text inside a tag', () => {
    const html = '<p>Hello world this is four</p>';
    // 5 words
    expect(countWords(html)).toBe(5);
  });

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('strips script tags before counting', () => {
    const html = '<p>Hello world</p><script>var x = "injected code";</script>';
    expect(countWords(html)).toBe(2);
  });

  it('strips style tags before counting', () => {
    const html = '<p>Hello world</p><style>.class { color: red; }</style>';
    expect(countWords(html)).toBe(2);
  });

  it('strips HTML tags and counts the remaining words', () => {
    const html = '<h1>Title</h1><p>Body text here</p>';
    expect(countWords(html)).toBe(4);
  });

  it('handles multiple whitespace characters between words', () => {
    const html = '<p>word1   word2</p>';
    expect(countWords(html)).toBe(2);
  });

  it('returns 0 for html with no text nodes', () => {
    expect(countWords('<br><hr><img src="x.jpg">')).toBe(0);
  });
});

// ── extractLinks ─────────────────────────────────────────────────────────────

describe('extractLinks', () => {
  it('extracts href and text from a basic anchor', () => {
    const html = '<a href="/about">About Us</a>';
    expect(extractLinks(html)).toEqual([{ href: '/about', text: 'About Us', rel: undefined }]);
  });

  it('extracts multiple links', () => {
    const html = '<a href="/a">Alpha</a><a href="/b">Beta</a>';
    const result = extractLinks(html);
    expect(result).toHaveLength(2);
    expect(result[0].href).toBe('/a');
    expect(result[1].href).toBe('/b');
  });

  it('extracts the rel attribute when present', () => {
    const html = '<a href="https://ext.com" rel="nofollow">External</a>';
    const [link] = extractLinks(html);
    expect(link.rel).toBe('nofollow');
  });

  it('strips inner HTML tags from the link text', () => {
    const html = '<a href="/img"><img src="x.jpg"> Image link</a>';
    const [link] = extractLinks(html);
    expect(link.text).toBe('Image link');
    expect(link.text).not.toContain('<img');
  });

  it('filters out anchors without href', () => {
    const html = '<a name="anchor">No href</a><a href="/yes">Yes</a>';
    const result = extractLinks(html);
    expect(result).toHaveLength(1);
    expect(result[0].href).toBe('/yes');
  });

  it('returns empty array when no links present', () => {
    expect(extractLinks('<p>No links here</p>')).toEqual([]);
  });
});

// ── extractImgTags ────────────────────────────────────────────────────────────

describe('extractImgTags', () => {
  it('extracts src, alt, and marks hasAlt true when alt is present', () => {
    const html = '<img src="photo.jpg" alt="A photo">';
    const [img] = extractImgTags(html);
    expect(img.src).toBe('photo.jpg');
    expect(img.alt).toBe('A photo');
    expect(img.hasAlt).toBe(true);
  });

  it('marks hasAlt false and alt empty when alt attribute is absent', () => {
    const html = '<img src="photo.jpg">';
    const [img] = extractImgTags(html);
    expect(img.hasAlt).toBe(false);
    expect(img.alt).toBe('');
  });

  it('marks hasAlt true but alt empty when alt="" is present', () => {
    const html = '<img src="photo.jpg" alt="">';
    const [img] = extractImgTags(html);
    expect(img.hasAlt).toBe(true);
    expect(img.alt).toBe('');
  });

  it('extracts the loading attribute', () => {
    const html = '<img src="x.jpg" alt="x" loading="lazy">';
    const [img] = extractImgTags(html);
    expect(img.loading).toBe('lazy');
  });

  it('loading is undefined when loading attribute is absent', () => {
    const html = '<img src="x.jpg" alt="x">';
    const [img] = extractImgTags(html);
    expect(img.loading).toBeUndefined();
  });

  it('detects hasWidth and hasHeight when present', () => {
    const html = '<img src="x.jpg" alt="x" width="200" height="100">';
    const [img] = extractImgTags(html);
    expect(img.hasWidth).toBe(true);
    expect(img.hasHeight).toBe(true);
  });

  it('hasWidth and hasHeight are false when dimensions are absent', () => {
    const html = '<img src="x.jpg" alt="x">';
    const [img] = extractImgTags(html);
    expect(img.hasWidth).toBe(false);
    expect(img.hasHeight).toBe(false);
  });

  it('extracts multiple img tags', () => {
    const html = '<img src="a.jpg" alt="A"><img src="b.jpg">';
    const imgs = extractImgTags(html);
    expect(imgs).toHaveLength(2);
    expect(imgs[0].src).toBe('a.jpg');
    expect(imgs[1].src).toBe('b.jpg');
  });

  it('returns empty array when no img tags present', () => {
    expect(extractImgTags('<p>No images</p>')).toEqual([]);
  });
});

// ── extractStyleBlocks ────────────────────────────────────────────────────────

describe('extractStyleBlocks', () => {
  it('returns 0 when no style blocks are present', () => {
    expect(extractStyleBlocks('<p>No styles</p>')).toBe(0);
  });

  it('returns the character length of a single style block', () => {
    const css = 'body { color: red; }';
    const html = `<style>${css}</style>`;
    expect(extractStyleBlocks(html)).toBe(css.length);
  });

  it('sums the lengths of multiple style blocks', () => {
    const css1 = 'body { color: red; }';
    const css2 = '.hero { display: flex; }';
    const html = `<style>${css1}</style><style>${css2}</style>`;
    expect(extractStyleBlocks(html)).toBe(css1.length + css2.length);
  });
});

// ── extractInlineScripts ──────────────────────────────────────────────────────

describe('extractInlineScripts', () => {
  it('returns 0 when no inline scripts are present', () => {
    expect(extractInlineScripts('<p>No scripts</p>')).toBe(0);
  });

  it('counts character length of a plain inline script', () => {
    const js = 'var x = 1;';
    const html = `<script>${js}</script>`;
    expect(extractInlineScripts(html)).toBe(js.length);
  });

  it('excludes external scripts (those with src= attribute)', () => {
    const html = '<script src="/bundle.js"></script>';
    expect(extractInlineScripts(html)).toBe(0);
  });

  it('excludes JSON-LD structured data scripts', () => {
    const html = '<script type="application/ld+json">{"@type":"Article"}</script>';
    expect(extractInlineScripts(html)).toBe(0);
  });

  it('sums multiple inline scripts and skips external/JSON-LD', () => {
    const js1 = 'var a = 1;';
    const js2 = 'var b = 2;';
    const html =
      `<script>${js1}</script>` +
      `<script src="/ext.js"></script>` +
      `<script type="application/ld+json">{"@type":"Person"}</script>` +
      `<script>${js2}</script>`;
    expect(extractInlineScripts(html)).toBe(js1.length + js2.length);
  });
});

// ── countExternalResources ────────────────────────────────────────────────────

describe('countExternalResources', () => {
  it('returns 0 for both when no external resources are present', () => {
    expect(countExternalResources('<p>Nothing</p>')).toEqual({ stylesheets: 0, scripts: 0 });
  });

  it('counts a single external stylesheet', () => {
    const html = '<link rel="stylesheet" href="/styles.css">';
    expect(countExternalResources(html)).toEqual({ stylesheets: 1, scripts: 0 });
  });

  it('counts a single external script', () => {
    const html = '<script src="/bundle.js"></script>';
    expect(countExternalResources(html)).toEqual({ stylesheets: 0, scripts: 1 });
  });

  it('counts multiple stylesheets and multiple scripts independently', () => {
    const html =
      '<link rel="stylesheet" href="/a.css">' +
      '<link rel="stylesheet" href="/b.css">' +
      '<script src="/c.js"></script>' +
      '<script src="/d.js"></script>' +
      '<script src="/e.js"></script>';
    expect(countExternalResources(html)).toEqual({ stylesheets: 2, scripts: 3 });
  });

  it('does not count inline scripts as external resources', () => {
    const html = '<script>var x = 1;</script>';
    expect(countExternalResources(html)).toEqual({ stylesheets: 0, scripts: 0 });
  });

  it('does not count non-stylesheet link tags', () => {
    const html = '<link rel="icon" href="/favicon.ico"><link rel="canonical" href="/page">';
    expect(countExternalResources(html)).toEqual({ stylesheets: 0, scripts: 0 });
  });
});
