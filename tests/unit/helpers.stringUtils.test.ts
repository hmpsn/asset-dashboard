import { describe, it, expect } from 'vitest';
import { stripHtmlToText, stripCodeFences } from '../../server/helpers';

describe('stripHtmlToText', () => {
  it('extracts body content from full HTML document', () => {
    const html = '<html><head><title>T</title></head><body><p>Hello world</p></body></html>';
    expect(stripHtmlToText(html)).toBe('Hello world');
  });

  it('strips script and style tags', () => {
    const html = '<body><script>alert(1)</script><style>.x{}</style><p>Clean</p></body>';
    expect(stripHtmlToText(html)).toBe('Clean');
  });

  it('strips nav and footer by default', () => {
    const html = '<body><nav>Menu</nav><main>Content</main><footer>Footer</footer></body>';
    expect(stripHtmlToText(html)).not.toContain('Menu');
    expect(stripHtmlToText(html)).not.toContain('Footer');
    expect(stripHtmlToText(html)).toContain('Content');
  });

  it('strips header when stripHeader option is true', () => {
    const html = '<body><header>Site Header</header><main>Content</main></body>';
    expect(stripHtmlToText(html, { stripHeader: true })).not.toContain('Site Header');
    expect(stripHtmlToText(html, { stripHeader: false })).toContain('Site Header');
  });

  it('respects maxLength option', () => {
    const html = '<body><p>' + 'x'.repeat(200) + '</p></body>';
    const result = stripHtmlToText(html, { maxLength: 100 });
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('falls back to full input if no body tag found', () => {
    const html = '<p>No body tag here</p>';
    expect(stripHtmlToText(html)).toContain('No body tag here');
  });

  it('collapses whitespace', () => {
    const html = '<body><p>foo   bar\n\nbaz</p></body>';
    expect(stripHtmlToText(html)).toBe('foo bar baz');
  });
});

describe('stripCodeFences', () => {
  it('strips leading ```json fence', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips leading ``` fence with no language', () => {
    expect(stripCodeFences('```\nsome text\n```')).toBe('some text');
  });

  it('strips leading ```html fence', () => {
    expect(stripCodeFences('```html\n<p>hi</p>\n```')).toBe('<p>hi</p>');
  });

  it('strips leading ```xml fence', () => {
    expect(stripCodeFences('```xml\n<root/>\n```')).toBe('<root/>');
  });

  it('returns unchanged string with no fences', () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });

  it('does not strip fences in the middle of the string', () => {
    const s = 'intro\n```json\n{"a":1}\n```';
    expect(stripCodeFences(s)).toBe(s); // no leading fence
  });
});
