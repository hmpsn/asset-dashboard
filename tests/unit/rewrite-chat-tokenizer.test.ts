// tests/unit/rewrite-chat-tokenizer.test.ts
//
// Covers the page tokeniser used by the rewrite-chat /load-page endpoint.
// Issue #578 expanded the tokeniser beyond <p>/<h*> so that <li>, <blockquote>,
// and <div> body copy (common in Webflow CMS templates) get surfaced as
// section bodies that the rewriter can target.
import { describe, it, expect } from 'vitest';
import { extractPageSections } from '../../server/routes/rewrite-chat.js';

function wrap(body: string): string {
  return `<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`;
}

describe('extractPageSections tokeniser', () => {
  it('captures <li> items as paragraph-like body text under the preceding heading', () => {
    const html = wrap('<h2>Benefits</h2><ul><li>Faster builds</li><li>Lower cost</li></ul>');
    const { sections } = extractPageSections(html);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Benefits');
    expect(sections[0].body).toContain('Faster builds');
    expect(sections[0].body).toContain('Lower cost');
  });

  it('captures <blockquote> body as a paragraph under the preceding heading', () => {
    const html = wrap('<h2>Testimonial</h2><blockquote>It changed my life.</blockquote>');
    const { sections } = extractPageSections(html);
    expect(sections).toHaveLength(1);
    expect(sections[0].body).toContain('It changed my life.');
  });

  it('captures Webflow-style <div> body wrappers as section body', () => {
    // Webflow CMS rich-text fields often render body copy inside <div>
    // blocks rather than <p>. The pre-#578 tokeniser ignored these.
    const html = wrap('<h2>About</h2><div>We help SaaS teams ship faster.</div>');
    const { sections } = extractPageSections(html);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('About');
    expect(sections[0].body).toContain('We help SaaS teams ship faster.');
  });

  it('skips pure-wrapper <div>s and tokenises their inner block children', () => {
    // The outer <div class="container"> has no direct text — it should NOT
    // collapse the inner heading/paragraph into a single flattened token.
    const html = wrap(
      '<div class="container"><h2>Pricing</h2><p>Three plans. No surprises.</p></div>',
    );
    const { sections } = extractPageSections(html);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Pricing');
    expect(sections[0].body).toContain('Three plans');
    expect(sections[0].body).toContain('No surprises');
  });

  it('handles deeply nested wrapper <div>s without losing inner headings', () => {
    const html = wrap(
      '<div class="outer"><div class="inner"><h2>Why Us</h2><p>We ship.</p></div></div>',
    );
    const { sections } = extractPageSections(html);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Why Us');
    expect(sections[0].body).toContain('We ship.');
  });

  it('preserves existing <p> handling alongside the new tags', () => {
    const html = wrap(
      '<h1>Main</h1><p>Intro line.</p><h2>List</h2><ul><li>Item A</li></ul><blockquote>Quote.</blockquote>',
    );
    const { sections, preamble } = extractPageSections(html);
    // No preamble — <h1> is the first token so the <p> attaches to that section.
    expect(preamble).toBe('');
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('Main');
    expect(sections[0].body).toContain('Intro line.');
    expect(sections[1].heading).toBe('List');
    expect(sections[1].body).toContain('Item A');
    expect(sections[1].body).toContain('Quote.');
  });

  it('still emits headings as headings (not body) regardless of div wrappers', () => {
    const html = wrap('<div><h1>Title</h1><h2>Sub</h2><div>Body line.</div></div>');
    const { sections } = extractPageSections(html);
    expect(sections.map(s => s.heading)).toEqual(['Title', 'Sub']);
    expect(sections[1].body).toContain('Body line.');
  });
});
