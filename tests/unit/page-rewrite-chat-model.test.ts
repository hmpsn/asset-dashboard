import { describe, expect, it } from 'vitest';
import {
  QUICK_PROMPTS,
  createRewriteSessionId,
  getIndentLevel,
  isUrlQuery,
  toSectionSlug,
} from '../../src/components/page-rewrite-chat/pageRewriteChatModel';

describe('pageRewriteChatModel', () => {
  it('builds stable rewrite session IDs from injected entropy', () => {
    expect(createRewriteSessionId(1700000000000, 0.123456789)).toBe('rewrite-1700000000000-4fzzzx');
  });

  it('normalizes section headings into URL-friendly slugs', () => {
    expect(toSectionSlug('What Is AEO in 2026?')).toBe('what-is-aeo-in-2026');
    expect(toSectionSlug('  Multi   Space -- Heading  ')).toBe('multi-space-heading');
  });

  it('computes sitemap indentation depth from slug paths', () => {
    expect(getIndentLevel('')).toBe(0);
    expect(getIndentLevel('services')).toBe(0);
    expect(getIndentLevel('blog/how-to-rank')).toBe(1);
    expect(getIndentLevel('/docs/guides/checklist/')).toBe(2);
  });

  it('detects URL query mode even when user input includes leading spaces', () => {
    expect(isUrlQuery('https://example.com/page')).toBe(true);
    expect(isUrlQuery('   http://example.com/page')).toBe(true);
    expect(isUrlQuery('/relative/path')).toBe(false);
    expect(isUrlQuery('blog/how-to-rank')).toBe(false);
  });

  it('keeps quick prompts list available to the root shell', () => {
    expect(QUICK_PROMPTS.length).toBeGreaterThan(4);
    expect(QUICK_PROMPTS).toContain('Optimize all headings for search intent and AEO');
  });
});
