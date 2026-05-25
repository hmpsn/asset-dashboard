/**
 * Wave 18 — Unit tests for pure helper functions in server/routes/rewrite-chat.ts
 *
 * Covered here (functions not already tested in rewrite-chat-tokenizer.test.ts):
 *   - preamble collection: orphan paragraphs before the first heading
 *   - title extraction: <title> tag, missing title
 *   - bodyText truncation: content stripped of tags, max 8000 chars
 *   - content area preference: <main> > <article> > <body>
 *   - noisy element stripping: <script>, <style>, <nav>, <footer>, <header>
 *   - heading body truncation: body capped at 800 chars
 *   - section level: h1 → 1, h2 → 2, h3 → 3
 *   - empty input handling
 *
 * NOT re-tested from rewrite-chat-tokenizer.test.ts:
 *   - <li> / <blockquote> / <div> body capture (covered by tokenizer tests)
 *   - nested wrapper div pass-through
 *   - deeply nested wrappers
 *   - mixed token types
 */
import { describe, it, expect } from 'vitest';
import { extractPageSections } from '../../server/routes/rewrite-chat.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function doc(head: string, body: string): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

function page(title: string, body: string): string {
  return doc(`<title>${title}</title>`, body);
}

// ─── Title extraction ─────────────────────────────────────────────────────────

describe('extractPageSections — title extraction', () => {
  it('extracts a plain title tag', () => {
    const { title } = extractPageSections(page('My Page Title', '<h1>Hello</h1>'));
    expect(title).toBe('My Page Title');
  });

  it('trims whitespace from title', () => {
    const { title } = extractPageSections(page('  Padded Title  ', '<h1>Hello</h1>'));
    expect(title).toBe('Padded Title');
  });

  it('returns empty string when title tag is absent', () => {
    const { title } = extractPageSections(doc('', '<h1>Hello</h1>'));
    expect(title).toBe('');
  });

  it('handles title with nested whitespace', () => {
    const { title } = extractPageSections(page('Home | My Company', '<p>Some content</p>'));
    expect(title).toBe('Home | My Company');
  });
});

// ─── Content area preference ──────────────────────────────────────────────────

describe('extractPageSections — content area preference', () => {
  it('prefers <main> content over <body>', () => {
    const html = page('T', '<header><h2>Header heading</h2></header><main><h2>Main heading</h2><p>Main content.</p></main>');
    const { sections } = extractPageSections(html);
    // Should find the main heading, not the header heading
    const headings = sections.map(s => s.heading);
    expect(headings).toContain('Main heading');
    expect(headings).not.toContain('Header heading');
  });

  it('falls back to <article> when <main> is absent', () => {
    const html = page('T', '<article><h2>Article heading</h2><p>Article content.</p></article>');
    const { sections } = extractPageSections(html);
    expect(sections.some(s => s.heading === 'Article heading')).toBe(true);
  });

  it('falls back to <body> when neither <main> nor <article> exists', () => {
    const html = page('T', '<h2>Body heading</h2><p>Body content.</p>');
    const { sections } = extractPageSections(html);
    expect(sections.some(s => s.heading === 'Body heading')).toBe(true);
  });
});

// ─── Noisy element stripping ──────────────────────────────────────────────────

describe('extractPageSections — noisy element stripping', () => {
  it('strips <script> content from sections', () => {
    const html = page('T', '<main><script>alert("do not include")</script><h2>Section</h2><p>Good content.</p></main>');
    const { sections } = extractPageSections(html);
    expect(sections.some(s => s.heading === 'Section')).toBe(true);
    // Script content should not appear in body text
    const allBodies = sections.map(s => s.body).join(' ');
    expect(allBodies).not.toContain('alert');
  });

  it('strips <style> content', () => {
    const html = page('T', '<main><style>.class { color: red; }</style><h2>Styled</h2><p>Text.</p></main>');
    const { sections } = extractPageSections(html);
    const allBodies = sections.map(s => s.body).join(' ');
    expect(allBodies).not.toContain('.class');
  });

  it('strips <nav> content', () => {
    const html = page('T', '<main><nav><a href="/about">About</a></nav><h2>Content</h2><p>Paragraph.</p></main>');
    const { sections } = extractPageSections(html);
    const allBodies = sections.map(s => s.body).join(' ');
    expect(allBodies).not.toContain('/about');
  });

  it('strips <footer> content', () => {
    const html = page('T', '<main><h2>Main</h2><p>Content.</p><footer>Footer text</footer></main>');
    const { sections } = extractPageSections(html);
    const allBodies = sections.map(s => s.body).join(' ');
    expect(allBodies).not.toContain('Footer text');
  });

  it('strips <header> content inside the selected content area', () => {
    const html = page('T', '<main><header>Site header text</header><h2>Real Heading</h2><p>Real content.</p></main>');
    const { sections } = extractPageSections(html);
    const allBodies = sections.map(s => s.body).join(' ');
    expect(allBodies).not.toContain('Site header text');
  });
});

// ─── Preamble collection ──────────────────────────────────────────────────────

describe('extractPageSections — preamble', () => {
  it('collects orphan paragraphs before the first heading into preamble', () => {
    const html = page('T', '<p>Opening paragraph before any heading.</p><h2>First Heading</h2><p>Section body.</p>');
    const { preamble, sections } = extractPageSections(html);
    expect(preamble).toContain('Opening paragraph before any heading.');
    // The section body should NOT include the preamble text
    expect(sections[0].body).not.toContain('Opening paragraph before any heading.');
  });

  it('returns empty preamble when content starts with a heading', () => {
    const html = page('T', '<h1>Starts with heading</h1><p>Body text.</p>');
    const { preamble } = extractPageSections(html);
    expect(preamble).toBe('');
  });

  it('collects multiple preamble paragraphs', () => {
    const html = page('T', '<p>First para.</p><p>Second para.</p><h2>Heading</h2>');
    const { preamble } = extractPageSections(html);
    expect(preamble).toContain('First para.');
    expect(preamble).toContain('Second para.');
  });

  it('truncates preamble to 800 characters', () => {
    const longText = 'A'.repeat(1000);
    const html = page('T', `<p>${longText}</p><h2>Heading</h2>`);
    const { preamble } = extractPageSections(html);
    expect(preamble.length).toBeLessThanOrEqual(800);
  });
});

// ─── Section heading level ────────────────────────────────────────────────────

describe('extractPageSections — section heading levels', () => {
  it('records h1 as level 1', () => {
    const html = page('T', '<h1>Main Title</h1>');
    const { sections } = extractPageSections(html);
    expect(sections[0].level).toBe(1);
  });

  it('records h2 as level 2', () => {
    const html = page('T', '<h2>Subtitle</h2>');
    const { sections } = extractPageSections(html);
    expect(sections[0].level).toBe(2);
  });

  it('records h3 as level 3', () => {
    const html = page('T', '<h3>Sub-subtitle</h3>');
    const { sections } = extractPageSections(html);
    expect(sections[0].level).toBe(3);
  });

  it('records mixed heading levels correctly', () => {
    const html = page('T', '<h1>Top</h1><h2>Second</h2><h3>Third</h3>');
    const { sections } = extractPageSections(html);
    expect(sections.map(s => s.level)).toEqual([1, 2, 3]);
  });
});

// ─── Section body truncation ──────────────────────────────────────────────────

describe('extractPageSections — section body truncation', () => {
  it('truncates section body to 800 characters', () => {
    const longText = 'B'.repeat(1000);
    const html = page('T', `<h2>Heading</h2><p>${longText}</p>`);
    const { sections } = extractPageSections(html);
    expect(sections[0].body.length).toBeLessThanOrEqual(800);
  });

  it('combines multiple paragraphs in section body up to 800 chars', () => {
    const html = page('T', '<h2>Heading</h2><p>First para.</p><p>Second para.</p>');
    const { sections } = extractPageSections(html);
    expect(sections[0].body).toContain('First para.');
    expect(sections[0].body).toContain('Second para.');
  });

  it('does not include paragraph text from the next section', () => {
    const html = page('T', '<h2>Section A</h2><p>Body A.</p><h2>Section B</h2><p>Body B.</p>');
    const { sections } = extractPageSections(html);
    expect(sections[0].body).toContain('Body A.');
    expect(sections[0].body).not.toContain('Body B.');
    expect(sections[1].body).toContain('Body B.');
    expect(sections[1].body).not.toContain('Body A.');
  });
});

// ─── bodyText field ───────────────────────────────────────────────────────────

describe('extractPageSections — bodyText', () => {
  it('returns bodyText with tags stripped', () => {
    const html = page('T', '<main><h2>Hello</h2><p>World</p></main>');
    const { bodyText } = extractPageSections(html);
    expect(bodyText).not.toContain('<h2>');
    expect(bodyText).not.toContain('<p>');
    expect(bodyText).toContain('Hello');
    expect(bodyText).toContain('World');
  });

  it('truncates bodyText to 8000 characters', () => {
    const longText = 'C'.repeat(10000);
    const html = page('T', `<main><p>${longText}</p></main>`);
    const { bodyText } = extractPageSections(html);
    expect(bodyText.length).toBeLessThanOrEqual(8000);
  });
});

// ─── Empty / minimal input ────────────────────────────────────────────────────

describe('extractPageSections — empty and minimal input', () => {
  it('handles empty string without throwing', () => {
    expect(() => extractPageSections('')).not.toThrow();
    const { title, sections, bodyText, preamble } = extractPageSections('');
    expect(title).toBe('');
    expect(sections).toHaveLength(0);
    expect(typeof bodyText).toBe('string');
    expect(typeof preamble).toBe('string');
  });

  it('handles HTML with no headings and no paragraphs', () => {
    const html = page('Empty', '<div class="container"></div>');
    const { sections, preamble } = extractPageSections(html);
    expect(sections).toHaveLength(0);
    expect(preamble).toBe('');
  });

  it('handles a page with only headings and no body paragraphs', () => {
    const html = page('T', '<h1>Only Heading</h1><h2>Another Heading</h2>');
    const { sections } = extractPageSections(html);
    expect(sections).toHaveLength(2);
    expect(sections[0].body).toBe('');
    expect(sections[1].body).toBe('');
  });

  it('returns correct section count for multiple headings', () => {
    const html = page('T', '<h1>One</h1><h2>Two</h2><h3>Three</h3><h2>Four</h2>');
    const { sections } = extractPageSections(html);
    expect(sections).toHaveLength(4);
    expect(sections.map(s => s.heading)).toEqual(['One', 'Two', 'Three', 'Four']);
  });
});
