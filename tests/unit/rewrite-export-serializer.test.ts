import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';

// Mirror of the serializeDocToMarkdown logic in PageRewriteChat — must match exactly.
function serializeToMarkdown(docBody: Element, issues: Array<{ severity: string; message: string }>): string {
  const lines: string[] = [];

  if (issues.length > 0) {
    lines.push('## Issues\n');
    issues.forEach(issue => lines.push(`- [${issue.severity}] ${issue.message}`));
    lines.push('');
  }

  const walk = (node: Node) => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text = (node.textContent || '').trim();
      if (text) lines.push(`${text}\n`);
      return;
    }
    if (node.nodeType === 1 /* ELEMENT_NODE */) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'h1') { lines.push(`# ${el.textContent?.trim()}\n`); return; }
      if (tag === 'h2') { lines.push(`\n## ${el.textContent?.trim()}\n`); return; }
      if (tag === 'h3') { lines.push(`\n### ${el.textContent?.trim()}\n`); return; }
      if (tag === 'h4') { lines.push(`\n#### ${el.textContent?.trim()}\n`); return; }
      if (tag === 'p') {
        const parts: string[] = [];
        el.childNodes.forEach(child => {
          if (child.nodeType === 3 /* TEXT_NODE */) { parts.push(child.textContent || ''); }
          else if (child.nodeType === 1) {
            const childEl = child as Element;
            if (childEl.tagName === 'STRONG' || childEl.tagName === 'B') parts.push(`**${childEl.textContent}**`);
            else if (childEl.tagName === 'EM' || childEl.tagName === 'I') parts.push(`*${childEl.textContent}*`);
            else parts.push(childEl.textContent || '');
          }
        });
        const text = parts.join('').trim();
        if (text) lines.push(`${text}\n`);
        return;
      }
      el.childNodes.forEach(walk);
    }
  };

  docBody.childNodes.forEach(walk);
  return lines.join('\n');
}

describe('rewrite export serializer', () => {
  it('serializes headings to markdown', () => {
    const dom = new JSDOM('<div><h1>Title</h1><h2>Section</h2><h3>Sub</h3><p>Body text</p></div>');
    const el = dom.window.document.querySelector('div')!;
    const md = serializeToMarkdown(el, []);
    expect(md).toContain('# Title');
    expect(md).toContain('## Section');
    expect(md).toContain('### Sub');
    expect(md).toContain('Body text');
  });

  it('prepends issues as ## Issues block', () => {
    const dom = new JSDOM('<div><h1>Title</h1></div>');
    const el = dom.window.document.querySelector('div')!;
    const md = serializeToMarkdown(el, [{ severity: 'error', message: 'Missing meta' }]);
    expect(md).toContain('## Issues');
    expect(md).toContain('- [error] Missing meta');
  });

  it('serializes bold and italic inline styles', () => {
    const dom = new JSDOM('<div><p><strong>Bold</strong> and <em>italic</em> text</p></div>');
    const el = dom.window.document.querySelector('div')!;
    const md = serializeToMarkdown(el, []);
    expect(md).toContain('**Bold**');
    expect(md).toContain('*italic*');
  });

  it('returns empty string for empty body with no issues', () => {
    const dom = new JSDOM('<div></div>');
    const el = dom.window.document.querySelector('div')!;
    const md = serializeToMarkdown(el, []);
    expect(md.trim()).toBe('');
  });

  it('serializes bare text nodes at root level (contenteditable produces these)', () => {
    // JSDOM doesn't let us inject raw text nodes via innerHTML easily, so we create manually
    const dom = new JSDOM('<div></div>');
    const el = dom.window.document.querySelector('div')!;
    el.appendChild(dom.window.document.createTextNode('  bare text  '));
    const md = serializeToMarkdown(el, []);
    expect(md).toContain('bare text');
  });
});
