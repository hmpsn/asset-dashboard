import { describe, expect, it } from 'vitest';
import { COMPACT_LOGO_SVG, escapeHtml, LOGO_SVG } from '../../server/export-html-shared.js';

describe('export-html-shared', () => {
  it('preserves the brief/post escape contract by default', () => {
    expect(escapeHtml(`A&B <tag> "quote" 'apostrophe'`)).toBe(
      `A&amp;B &lt;tag&gt; &quot;quote&quot; 'apostrophe'`,
    );
  });

  it('supports the one-pager defensive single-quote escape contract', () => {
    expect(escapeHtml(`A&B <tag> "quote" 'apostrophe'`, { singleQuote: true })).toBe(
      'A&amp;B &lt;tag&gt; &quot;quote&quot; &#39;apostrophe&#39;',
    );
  });

  it('keeps the compact logo as a size-only variant of the full logo', () => {
    expect(LOGO_SVG).toContain('width="160" height="51"');
    expect(COMPACT_LOGO_SVG).toContain('width="100" height="32"');
    expect(COMPACT_LOGO_SVG).toBe(LOGO_SVG.replace('width="160" height="51"', 'width="100" height="32"'));
  });
});
