import { describe, expect, it } from 'vitest';
import { inlineMarkdownToHtml } from '../../src/lib/inline-markdown';

describe('inlineMarkdownToHtml', () => {
  it('escapes raw HTML before markdown formatting', () => {
    const html = inlineMarkdownToHtml('<img src=x onerror=alert(1)> **Safe**');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('<b class=');
  });

  it('drops markdown links and bare URLs from output', () => {
    const html = inlineMarkdownToHtml('See [docs](https://example.com) and https://example.com/path');
    expect(html).toContain('See docs and');
    expect(html).not.toContain('https://example.com');
    expect(html).not.toContain('<a ');
  });
});
