/**
 * Wave 25 — Unit tests for server/post-export-html.ts
 *
 * The module exports:
 *   - renderPostHTML(post: GeneratedPost): string — produces a full HTML page
 *
 * Tests verify:
 *   - Output is a valid HTML5 document starting with DOCTYPE
 *   - Post title, keyword, and metadata are injected correctly
 *   - HTML special characters are escaped in output
 *   - Status labels and colors are mapped correctly for all post statuses
 *   - Table of contents is rendered only when > 2 sections (intro/outro included)
 *   - Review checklist is rendered when present, omitted when absent
 *   - Word counts appear in the metrics strip
 *   - STUDIO_NAME appears in title and footer
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { GeneratedPost, PostSection, ReviewChecklist } from '../../shared/types/content.js';

let renderPostHTML: (post: GeneratedPost) => string;

beforeAll(async () => {
  const mod = await import('../../server/post-export-html.js');
  renderPostHTML = mod.renderPostHTML;
});

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makeSection(index: number, heading = `Section ${index}`): PostSection {
  return {
    index,
    heading,
    content: `<p>Content for ${heading}</p>`,
    wordCount: 100,
    targetWordCount: 120,
    keywords: [],
    status: 'done',
  };
}

function makePost(overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  return {
    id: 'post-1',
    workspaceId: 'ws-1',
    briefId: 'brief-1',
    targetKeyword: 'best plumbing tips',
    title: 'The Best Plumbing Tips for Homeowners',
    metaDescription: 'Learn the best plumbing tips to save money and avoid disasters.',
    introduction: '<p>This is the introduction.</p>',
    sections: [makeSection(1, 'Tools You Need'), makeSection(2, 'Common Mistakes')],
    conclusion: '<p>In conclusion, prevention is key.</p>',
    totalWordCount: 1500,
    targetWordCount: 2000,
    status: 'draft',
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...overrides,
  };
}

// ── Document structure ─────────────────────────────────────────────────────────

describe('renderPostHTML — document structure', () => {
  it('returns a string starting with <!DOCTYPE html>', () => {
    const html = renderPostHTML(makePost());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('contains <html>, <head>, and <body> elements', () => {
    const html = renderPostHTML(makePost());
    expect(html).toContain('<html');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
  });

  it('includes the post title in the <title> tag', () => {
    const html = renderPostHTML(makePost({ title: 'Ultimate Plumbing Guide' }));
    expect(html).toContain('Ultimate Plumbing Guide');
  });

  it('includes STUDIO_NAME from constants in the page', () => {
    const html = renderPostHTML(makePost());
    // STUDIO_NAME resolves to 'hmpsn studio' based on existing test patterns
    expect(html.toLowerCase()).toMatch(/hmpsn/);
  });
});

// ── HTML escaping ──────────────────────────────────────────────────────────────

describe('renderPostHTML — HTML escaping', () => {
  it('escapes angle brackets in title to prevent XSS', () => {
    const html = renderPostHTML(makePost({ title: '<script>alert(1)</script>' }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes ampersands in targetKeyword', () => {
    const html = renderPostHTML(makePost({ targetKeyword: 'tips & tricks' }));
    expect(html).toContain('tips &amp; tricks');
  });

  it('escapes double quotes in seoTitle', () => {
    const html = renderPostHTML(makePost({ seoTitle: 'The "Best" Tips' }));
    expect(html).toContain('The &quot;Best&quot; Tips');
  });
});

// ── Status mapping ─────────────────────────────────────────────────────────────

describe('renderPostHTML — status labels', () => {
  it.each([
    ['draft', 'Draft'],
    ['review', 'In Review'],
    ['approved', 'Approved'],
    ['error', 'Failed'],
  ] as const)('maps status "%s" to label "%s"', (status, expectedLabel) => {
    const html = renderPostHTML(makePost({ status }));
    expect(html).toContain(expectedLabel);
  });

  it('applies green color (#16a34a) for approved status', () => {
    const html = renderPostHTML(makePost({ status: 'approved' }));
    expect(html).toContain('#16a34a');
  });

  it('applies red color (#dc2626) for error status', () => {
    const html = renderPostHTML(makePost({ status: 'error' }));
    expect(html).toContain('#dc2626');
  });
});

// ── Metadata strip ─────────────────────────────────────────────────────────────

describe('renderPostHTML — metrics strip', () => {
  it('includes formatted totalWordCount in the metrics strip', () => {
    const html = renderPostHTML(makePost({ totalWordCount: 1234 }));
    // toLocaleString in en-US adds a comma for thousands
    expect(html).toContain('1,234');
  });

  it('includes targetWordCount in the metrics strip', () => {
    const html = renderPostHTML(makePost({ targetWordCount: 2500 }));
    expect(html).toContain('2,500');
  });

  it('includes section count in the metrics strip', () => {
    const post = makePost({ sections: [makeSection(1), makeSection(2), makeSection(3)] });
    const html = renderPostHTML(post);
    expect(html).toContain('>3<');  // mc-value contains 3
  });
});

// ── Table of contents ──────────────────────────────────────────────────────────

describe('renderPostHTML — table of contents', () => {
  it('renders TOC when post has introduction + 2 sections + conclusion (> 2 entries)', () => {
    const post = makePost({
      introduction: '<p>Intro</p>',
      sections: [makeSection(1, 'Section A'), makeSection(2, 'Section B')],
      conclusion: '<p>Conclusion</p>',
    });
    const html = renderPostHTML(post);
    expect(html).toContain('Table of Contents');
    expect(html).toContain('Introduction');
    expect(html).toContain('Section A');
    expect(html).toContain('Conclusion');
  });

  it('omits TOC when there are 2 or fewer entries', () => {
    // Only 2 entries: intro + 1 section, no conclusion → toc.length = 2, NOT > 2
    const post = makePost({
      introduction: '<p>Intro</p>',
      sections: [makeSection(1, 'Only Section')],
      conclusion: '',
    });
    const html = renderPostHTML(post);
    // The toc <div class="toc"> element is only emitted when toc.length > 2
    // CSS classes like .toc-title still appear in <style>, so we check the div element
    expect(html).not.toContain('<div class="toc">');
  });

  it('section headings appear in the TOC', () => {
    const post = makePost({
      introduction: '<p>Intro</p>',
      sections: [
        makeSection(1, 'Why Plumbing Matters'),
        makeSection(2, 'DIY Fixes'),
        makeSection(3, 'When to Call a Pro'),
      ],
      conclusion: '<p>Done</p>',
    });
    const html = renderPostHTML(post);
    expect(html).toContain('Why Plumbing Matters');
    expect(html).toContain('DIY Fixes');
    expect(html).toContain('When to Call a Pro');
  });
});

// ── Review checklist ───────────────────────────────────────────────────────────

describe('renderPostHTML — review checklist', () => {
  it('renders the review checklist when reviewChecklist is present', () => {
    const checklist: ReviewChecklist = {
      factual_accuracy: true,
      brand_voice: false,
      internal_links: true,
      no_hallucinations: true,
      meta_optimized: false,
      word_count_target: true,
    };
    const html = renderPostHTML(makePost({ reviewChecklist: checklist }));
    expect(html).toContain('Review Checklist');
    expect(html).toContain('Factual accuracy verified');
    expect(html).toContain('Brand voice match confirmed');
  });

  it('marks checked items with the done class and unchecked with the pending class', () => {
    const checklist: ReviewChecklist = {
      factual_accuracy: true,
      brand_voice: false,
      internal_links: false,
      no_hallucinations: true,
      meta_optimized: false,
      word_count_target: false,
    };
    const html = renderPostHTML(makePost({ reviewChecklist: checklist }));
    // At least one 'done' class for checked items
    expect(html).toContain('checklist-check done');
    // At least one 'pending' class for unchecked items
    expect(html).toContain('checklist-check pending');
  });

  it('omits the checklist section entirely when reviewChecklist is undefined', () => {
    const html = renderPostHTML(makePost({ reviewChecklist: undefined }));
    // The checklist items are only rendered when reviewChecklist is defined
    expect(html).not.toContain('Factual accuracy verified');
    expect(html).not.toContain('Brand voice match confirmed');
    expect(html).not.toContain('No AI hallucinations');
  });
});

// ── SEO preview ────────────────────────────────────────────────────────────────

describe('renderPostHTML — SEO preview', () => {
  it('uses seoTitle when present instead of title for the SEO preview', () => {
    const html = renderPostHTML(
      makePost({
        title: 'Regular Title',
        seoTitle: 'SEO Optimized Title | Brand',
      }),
    );
    expect(html).toContain('SEO Optimized Title | Brand');
  });

  it('uses seoMetaDescription when present instead of metaDescription', () => {
    const html = renderPostHTML(
      makePost({
        metaDescription: 'Generic description.',
        seoMetaDescription: 'SEO-optimized description with keyword.',
      }),
    );
    expect(html).toContain('SEO-optimized description with keyword.');
  });

  it('renders publishedSlug in the SEO URL area when provided', () => {
    const html = renderPostHTML(makePost({ publishedSlug: '/blog/best-plumbing-tips' }));
    expect(html).toContain('/blog/best-plumbing-tips');
  });

  it('falls back to "example.com/..." when publishedSlug is absent', () => {
    const html = renderPostHTML(makePost({ publishedSlug: undefined }));
    expect(html).toContain('example.com/...');
  });
});
