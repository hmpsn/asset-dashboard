// tests/unit/intelligence-slices-pure.test.ts
//
// Pure unit tests for intelligence slice helper functions that transform data
// without DB access. Focuses on:
//   - formatPageElementsSection (page-elements-slice.ts)
//   - Pure formatting helpers exported from formatters.ts that are not yet
//     covered by the existing format-*.test.ts suite
//
// Does NOT re-test:
//   - formatForPrompt main path (covered by formatters-prompt-format.test.ts)
//   - formatKnowledgeBaseForPrompt / formatKeywordsForPrompt / formatPersonasForPrompt /
//     formatPageMapForPrompt (covered by format-standalone-helpers.test.ts and
//     formatters-prompt-format.test.ts)
//   - assemblePageElements DB path (covered by page-elements-slice.test.ts)

import { describe, it, expect } from 'vitest';
import { formatPageElementsSection } from '../../server/intelligence/page-elements-slice.js';
import type { PageElementSlice } from '../../shared/types/intelligence.js';
import type { PageElementCatalog } from '../../shared/types/page-elements.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyCatalog(overrides: Partial<PageElementCatalog> = {}): PageElementCatalog {
  return {
    extractedAt: '2026-05-01T00:00:00.000Z',
    sourcePublishedAt: null,
    headings: [],
    tables: [],
    images: [],
    videos: [],
    lists: [],
    testimonials: [],
    codeBlocks: [],
    citations: [],
    diagnostics: { aiClassificationCalls: 0, hitAiBudgetCap: false, rawCounts: {} },
    ...overrides,
  };
}

function makeSlice(pagePath: string, overrides: Partial<PageElementCatalog> = {}): PageElementSlice {
  return { pagePath, catalog: emptyCatalog(overrides) };
}

// ── formatPageElementsSection ─────────────────────────────────────────────────

describe('formatPageElementsSection', () => {
  it('returns empty string for undefined input', () => {
    expect(formatPageElementsSection(undefined)).toBe('');
  });

  it('returns empty string when catalog has no elements', () => {
    const slice = makeSlice('/empty-page');
    expect(formatPageElementsSection(slice)).toBe('');
  });

  it('includes the pagePath in the section header', () => {
    const slice: PageElementSlice = {
      pagePath: '/services/seo',
      catalog: emptyCatalog({
        videos: [{ provider: 'youtube', embedUrl: 'https://example.com/v' }],
      }),
    };
    const result = formatPageElementsSection(slice);
    expect(result).toContain('/services/seo');
    expect(result.startsWith('## Page elements (/services/seo)')).toBe(true);
  });

  it('renders singular "video" for one video element', () => {
    const slice = makeSlice('/page', {
      videos: [{ provider: 'youtube', embedUrl: 'https://example.com/v1' }],
    });
    expect(formatPageElementsSection(slice)).toContain('1 video');
    expect(formatPageElementsSection(slice)).not.toContain('1 videos');
  });

  it('renders plural "videos" for multiple video elements', () => {
    const slice = makeSlice('/page', {
      videos: [
        { provider: 'youtube', embedUrl: 'https://example.com/v1' },
        { provider: 'vimeo', embedUrl: 'https://example.com/v2' },
      ],
    });
    expect(formatPageElementsSection(slice)).toContain('2 videos');
  });

  it('only counts how-to-like lists, not plain lists', () => {
    const slice = makeSlice('/page', {
      lists: [
        { kind: 'ordered', itemCount: 3, isHowToLike: true },
        { kind: 'unordered', itemCount: 5, isHowToLike: false },
        { kind: 'ordered', itemCount: 4, isHowToLike: true },
      ],
    });
    const result = formatPageElementsSection(slice);
    expect(result).toContain('2 HowTo lists');
    // non-HowTo lists do not contribute
    expect(result).not.toContain('3 HowTo');
  });

  it('renders singular "HowTo list" for one HowTo-like list', () => {
    const slice = makeSlice('/page', {
      lists: [{ kind: 'ordered', itemCount: 5, isHowToLike: true }],
    });
    const result = formatPageElementsSection(slice);
    expect(result).toContain('1 HowTo list');
    expect(result).not.toContain('1 HowTo lists');
  });

  it('renders citations count', () => {
    const slice = makeSlice('/page', {
      citations: [
        { url: 'https://a.com', text: 'Source A', isExternal: true },
        { url: 'https://b.com', text: 'Source B', isExternal: false },
      ],
    });
    expect(formatPageElementsSection(slice)).toContain('2 citations');
  });

  it('renders singular "citation" for one citation', () => {
    const slice = makeSlice('/page', {
      citations: [{ url: 'https://a.com', text: 'Source A', isExternal: true }],
    });
    expect(formatPageElementsSection(slice)).toContain('1 citation');
    expect(formatPageElementsSection(slice)).not.toContain('1 citations');
  });

  it('renders tables count', () => {
    const slice = makeSlice('/page', {
      tables: [
        { headers: ['Col A', 'Col B'], rowCount: 3 },
        { headers: [], rowCount: 2 },
      ],
    });
    expect(formatPageElementsSection(slice)).toContain('2 tables');
  });

  it('renders singular "table" for one table', () => {
    const slice = makeSlice('/page', {
      tables: [{ headers: ['A'], rowCount: 5 }],
    });
    expect(formatPageElementsSection(slice)).toContain('1 table');
    expect(formatPageElementsSection(slice)).not.toContain('1 tables');
  });

  it('renders images count', () => {
    const slice = makeSlice('/page', {
      images: [
        { src: 'https://a.com/img1.png', alt: 'Image 1', hasCaption: false },
        { src: 'https://a.com/img2.png', alt: '', hasCaption: true },
      ],
    });
    expect(formatPageElementsSection(slice)).toContain('2 images');
  });

  it('renders singular "image" for one image', () => {
    const slice = makeSlice('/page', {
      images: [{ src: 'https://a.com/img.png', alt: 'alt', hasCaption: false }],
    });
    expect(formatPageElementsSection(slice)).toContain('1 image');
    expect(formatPageElementsSection(slice)).not.toContain('1 images');
  });

  it('renders testimonials count', () => {
    const slice = makeSlice('/page', {
      testimonials: [
        { text: 'Great product!', author: 'Alice', source: 'review' as const },
        { text: 'Highly recommend.', source: 'review' as const },
      ],
    });
    expect(formatPageElementsSection(slice)).toContain('2 testimonials');
  });

  it('renders headings count', () => {
    const slice = makeSlice('/page', {
      headings: [
        { level: 2, text: 'About Us', wordCount: 2 },
        { level: 3, text: 'Our Team', wordCount: 2 },
        { level: 2, text: 'Services', wordCount: 1 },
      ],
    });
    expect(formatPageElementsSection(slice)).toContain('3 headings');
  });

  it('renders code blocks count', () => {
    const slice = makeSlice('/page', {
      codeBlocks: [
        { language: 'javascript', lineCount: 10 },
        { language: 'python', lineCount: 5 },
      ],
    });
    expect(formatPageElementsSection(slice)).toContain('2 code blocks');
  });

  it('renders singular "code block" for one code block', () => {
    const slice = makeSlice('/page', {
      codeBlocks: [{ language: 'typescript', lineCount: 20 }],
    });
    expect(formatPageElementsSection(slice)).toContain('1 code block');
    expect(formatPageElementsSection(slice)).not.toContain('1 code blocks');
  });

  it('joins multiple element types with " · " separator', () => {
    const slice: PageElementSlice = {
      pagePath: '/multi',
      catalog: emptyCatalog({
        videos: [{ provider: 'youtube', embedUrl: 'https://example.com/v' }],
        lists: [{ kind: 'ordered', itemCount: 5, isHowToLike: true }],
        citations: [{ url: 'https://a.com', text: 'Source A', isExternal: true }],
      }),
    };
    const result = formatPageElementsSection(slice);
    expect(result).toContain('1 video · 1 HowTo list · 1 citation');
  });

  it('does not include a trailing newline in its output', () => {
    const slice = makeSlice('/page', {
      videos: [{ provider: 'youtube', embedUrl: 'https://example.com/v' }],
    });
    const result = formatPageElementsSection(slice);
    expect(result.endsWith('\n')).toBe(false);
  });

  it('returns empty string when all non-HowTo lists are present but no HowTo-like lists', () => {
    const slice = makeSlice('/page', {
      lists: [
        { kind: 'unordered', itemCount: 3, isHowToLike: false },
        { kind: 'unordered', itemCount: 7, isHowToLike: false },
      ],
    });
    // Non-HowTo lists don't appear in the output
    expect(formatPageElementsSection(slice)).toBe('');
  });

  it('omits element types with zero count from the summary', () => {
    const slice: PageElementSlice = {
      pagePath: '/partial',
      catalog: emptyCatalog({
        videos: [{ provider: 'youtube', embedUrl: 'https://example.com/v' }],
        // No tables, images, testimonials, headings, codeBlocks, citations, lists
      }),
    };
    const result = formatPageElementsSection(slice);
    expect(result).not.toContain('table');
    expect(result).not.toContain('image');
    expect(result).not.toContain('citation');
    expect(result).not.toContain('testimonial');
    expect(result).not.toContain('heading');
    expect(result).not.toContain('code block');
    expect(result).not.toContain('HowTo');
  });

  it('handles every element type populated simultaneously', () => {
    const slice: PageElementSlice = {
      pagePath: '/rich',
      catalog: emptyCatalog({
        videos: [
          { provider: 'youtube', embedUrl: 'https://a.com/v1' },
          { provider: 'vimeo', embedUrl: 'https://a.com/v2' },
        ],
        lists: [
          { kind: 'ordered', itemCount: 4, isHowToLike: true },
          { kind: 'unordered', itemCount: 3, isHowToLike: false }, // Not counted
        ],
        citations: [{ url: 'https://src.com', text: 'Src', isExternal: true }],
        tables: [{ headers: ['A', 'B'], rowCount: 5 }],
        images: [{ src: 'https://a.com/img.jpg', alt: 'alt', hasCaption: false }],
        testimonials: [{ text: 'Good!', source: 'review' as const }],
        headings: [{ level: 2, text: 'H', wordCount: 1 }, { level: 3, text: 'H2', wordCount: 1 }],
        codeBlocks: [{ language: 'js', lineCount: 5 }],
      }),
    };
    const result = formatPageElementsSection(slice);
    expect(result).toContain('2 videos');
    expect(result).toContain('1 HowTo list');
    expect(result).toContain('1 citation');
    expect(result).toContain('1 table');
    expect(result).toContain('1 image');
    expect(result).toContain('1 testimonial');
    expect(result).toContain('2 headings');
    expect(result).toContain('1 code block');
  });
});
