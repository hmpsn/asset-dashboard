import { describe, expect, it } from 'vitest';
import { sanitizeRichText, sanitizePlainText } from '../../server/html-sanitize.js';

describe('sanitizeRichText', () => {
  it('passes through allowed block and inline tags', () => {
    const input = '<p>Hello <strong>world</strong></p>';
    expect(sanitizeRichText(input)).toBe('<p>Hello <strong>world</strong></p>');
  });

  it('strips disallowed tags like <script>', () => {
    const input = '<p>Safe</p><script>alert("xss")</script>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain('<script>');
    expect(result).toContain('<p>Safe</p>');
  });

  it('strips disallowed tags like <div> and <span>', () => {
    const input = '<div>wrapper <span>inner</span></div>';
    const result = sanitizeRichText(input);
    expect(result).not.toContain('<div>');
    expect(result).not.toContain('<span>');
    expect(result).toContain('wrapper inner');
  });

  it('allows heading tags h1–h3', () => {
    const input = '<h1>Title</h1><h2>Sub</h2><h3>Sub-sub</h3>';
    expect(sanitizeRichText(input)).toBe('<h1>Title</h1><h2>Sub</h2><h3>Sub-sub</h3>');
  });

  it('allows list tags', () => {
    const input = '<ul><li>Item one</li><li>Item two</li></ul>';
    expect(sanitizeRichText(input)).toBe('<ul><li>Item one</li><li>Item two</li></ul>');
  });

  it('preserves anchor href and adds rel=noopener noreferrer', () => {
    const input = '<a href="https://example.com">link</a>';
    const result = sanitizeRichText(input);
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it('strips javascript: hrefs', () => {
    const input = '<a href="javascript:alert(1)">click</a>';
    const result = sanitizeRichText(input);
    // href should be stripped since javascript: is not in allowedSchemes
    expect(result).not.toContain('javascript:');
  });

  it('handles empty string without error', () => {
    expect(sanitizeRichText('')).toBe('');
  });

  it('handles plain text without tags', () => {
    const result = sanitizeRichText('Hello world');
    expect(result).toBe('Hello world');
  });

  it('strips img tags', () => {
    const input = '<p>Text</p><img src="http://example.com/img.png" />';
    const result = sanitizeRichText(input);
    expect(result).not.toContain('<img');
    expect(result).toContain('<p>Text</p>');
  });

  it('preserves blockquote and code tags', () => {
    const input = '<blockquote>quote</blockquote><code>code snippet</code>';
    expect(sanitizeRichText(input)).toBe('<blockquote>quote</blockquote><code>code snippet</code>');
  });

  it('preserves semantic comparison-table structure while stripping unsafe attributes', () => {
    const input = [
      '<table class="comparison" style="display:none" onclick="steal()">',
      '<thead><tr><th scope="col" class="label">Feature</th><th>In-office</th></tr></thead>',
      '<tbody><tr data-secret="x"><td style="color:red">Speed</td><td>Faster</td></tr></tbody>',
      '</table>',
    ].join('');

    expect(sanitizeRichText(input)).toBe(
      '<table><thead><tr><th>Feature</th><th>In-office</th></tr></thead>'
      + '<tbody><tr><td>Speed</td><td>Faster</td></tr></tbody></table>',
    );
  });
});

describe('sanitizePlainText', () => {
  it('strips all HTML tags', () => {
    const input = '<p>Hello <strong>world</strong></p>';
    expect(sanitizePlainText(input)).toBe('Hello world');
  });

  it('strips script tags and their content', () => {
    const input = 'Before<script>alert("xss")</script>After';
    const result = sanitizePlainText(input);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizePlainText('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(sanitizePlainText('No tags here')).toBe('No tags here');
  });

  it('strips anchor tags', () => {
    const input = '<a href="https://example.com">link text</a>';
    const result = sanitizePlainText(input);
    expect(result).not.toContain('<a');
    expect(result).toContain('link text');
  });

  it('strips nested tags and preserves text content', () => {
    const input = '<div><p><em>Nested</em></p></div>';
    expect(sanitizePlainText(input)).toBe('Nested');
  });
});
