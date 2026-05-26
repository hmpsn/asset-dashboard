import { describe, expect, it } from 'vitest';
import { assemblePostHtml, generateSlug } from '../../server/html-to-richtext.js';
import type { GeneratedPost } from '../../shared/types/content.js';

function makePost(overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  return {
    id: 'post-1',
    workspaceId: 'ws-1',
    briefId: 'brief-1',
    targetKeyword: 'test keyword',
    title: 'Test Post',
    metaDescription: 'A test post',
    introduction: '<p>Introduction paragraph.</p>',
    sections: [
      {
        index: 0,
        heading: 'Section One',
        content: '<p>Section one content.</p>',
        wordCount: 4,
        targetWordCount: 100,
        keywords: ['test'],
        status: 'done',
      },
    ],
    conclusion: '<p>Conclusion paragraph.</p>',
    totalWordCount: 50,
    targetWordCount: 500,
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('assemblePostHtml', () => {
  it('joins introduction, sections, and conclusion with newlines', () => {
    const post = makePost();
    const result = assemblePostHtml(post);
    expect(result).toBe(
      '<p>Introduction paragraph.</p>\n<p>Section one content.</p>\n<p>Conclusion paragraph.</p>'
    );
  });

  it('handles post with multiple sections', () => {
    const post = makePost({
      sections: [
        { index: 0, heading: 'S1', content: '<p>S1 content</p>', wordCount: 2, targetWordCount: 50, keywords: [], status: 'done' },
        { index: 1, heading: 'S2', content: '<p>S2 content</p>', wordCount: 2, targetWordCount: 50, keywords: [], status: 'done' },
      ],
    });
    const result = assemblePostHtml(post);
    expect(result).toContain('<p>S1 content</p>');
    expect(result).toContain('<p>S2 content</p>');
    // S1 should appear before S2
    expect(result.indexOf('<p>S1 content</p>')).toBeLessThan(result.indexOf('<p>S2 content</p>'));
  });

  it('skips section with empty content string', () => {
    const post = makePost({
      sections: [
        { index: 0, heading: 'Empty', content: '', wordCount: 0, targetWordCount: 50, keywords: [], status: 'done' },
      ],
    });
    const result = assemblePostHtml(post);
    expect(result).toBe(
      '<p>Introduction paragraph.</p>\n<p>Conclusion paragraph.</p>'
    );
  });

  it('handles post with no sections', () => {
    const post = makePost({ sections: [] });
    const result = assemblePostHtml(post);
    expect(result).toBe('<p>Introduction paragraph.</p>\n<p>Conclusion paragraph.</p>');
  });

  it('handles empty introduction gracefully', () => {
    const post = makePost({ introduction: '' });
    const result = assemblePostHtml(post);
    expect(result).toBe('<p>Section one content.</p>\n<p>Conclusion paragraph.</p>');
  });

  it('handles empty conclusion gracefully', () => {
    const post = makePost({ conclusion: '' });
    const result = assemblePostHtml(post);
    expect(result).toBe('<p>Introduction paragraph.</p>\n<p>Section one content.</p>');
  });

  it('returns empty string when all parts are empty', () => {
    const post = makePost({ introduction: '', sections: [], conclusion: '' });
    const result = assemblePostHtml(post);
    expect(result).toBe('');
  });
});

describe('generateSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(generateSlug('Hello World')).toBe('hello-world');
  });

  it('strips leading and trailing hyphens', () => {
    expect(generateSlug('  Hello World  ')).toBe('hello-world');
  });

  it('collapses multiple non-alphanumeric chars into one hyphen', () => {
    expect(generateSlug('Hello   World!!!')).toBe('hello-world');
  });

  it('handles special characters', () => {
    expect(generateSlug('SEO Tips & Tricks: 2026')).toBe('seo-tips-tricks-2026');
  });

  it('truncates to 100 characters', () => {
    const longTitle = 'a'.repeat(200);
    expect(generateSlug(longTitle)).toHaveLength(100);
  });

  it('returns empty string for empty input', () => {
    expect(generateSlug('')).toBe('');
  });

  it('handles title with only special characters', () => {
    const result = generateSlug('!!! ???');
    expect(result).toBe('');
  });

  it('preserves numbers in slug', () => {
    expect(generateSlug('Top 10 Tips for 2026')).toBe('top-10-tips-for-2026');
  });
});
