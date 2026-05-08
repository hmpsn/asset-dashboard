import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  buildDocHtml,
  serializeDocToMarkdown,
} from '../../src/components/page-rewrite-chat/pageRewriteChatDocument';
import type { PageData } from '../../src/components/page-rewrite-chat/pageRewriteChatModel';

describe('rewrite export serializer', () => {
  it('serializes headings to markdown', () => {
    const dom = new JSDOM('<div><h1>Title</h1><h2>Section</h2><h3>Sub</h3><p>Body text</p></div>');
    const el = dom.window.document.querySelector('div');
    const md = serializeDocToMarkdown(el as HTMLElement, null);
    expect(md).toContain('# Title');
    expect(md).toContain('## Section');
    expect(md).toContain('### Sub');
    expect(md).toContain('Body text');
  });

  it('prepends issues as ## Issues block', () => {
    const dom = new JSDOM('<div><h1>Title</h1></div>');
    const el = dom.window.document.querySelector('div');
    const pageData = {
      title: 'Title',
      sections: [],
      bodyText: '',
      html: '',
      slug: 'title',
      issues: [{ severity: 'error', message: 'Missing meta', check: 'meta' }],
    } satisfies PageData;
    const md = serializeDocToMarkdown(el as HTMLElement, pageData);
    expect(md).toContain('## Issues');
    expect(md).toContain('- [error] Missing meta');
  });

  it('serializes bold and italic inline styles', () => {
    const dom = new JSDOM('<div><p><strong>Bold</strong> and <em>italic</em> text</p></div>');
    const el = dom.window.document.querySelector('div');
    const md = serializeDocToMarkdown(el as HTMLElement, null);
    expect(md).toContain('**Bold**');
    expect(md).toContain('*italic*');
  });

  it('returns empty string for empty body with no issues', () => {
    const dom = new JSDOM('<div></div>');
    const el = dom.window.document.querySelector('div');
    const md = serializeDocToMarkdown(el as HTMLElement, null);
    expect(md.trim()).toBe('');
  });

  it('serializes bare text nodes at root level (contenteditable produces these)', () => {
    const dom = new JSDOM('<div></div>');
    const el = dom.window.document.querySelector('div');
    el?.appendChild(dom.window.document.createTextNode('  bare text  '));
    const md = serializeDocToMarkdown(el as HTMLElement, null);
    expect(md).toContain('bare text');
  });

  it('renders deep heading body paragraphs with explicit inline indentation', () => {
    const pageData = {
      title: 'Root',
      sections: [{ level: 4, heading: 'Nested', body: 'Nested body' }],
      bodyText: '',
      html: '',
      slug: 'root',
      issues: [],
    } satisfies PageData;

    const html = buildDocHtml(pageData);
    expect(html).toContain('margin-left:24px');
    expect(html).toContain('<p class="text-[13px] text-slate-500 leading-[1.7] mb-3" style="margin-left:24px">Nested body</p>');
  });
});
