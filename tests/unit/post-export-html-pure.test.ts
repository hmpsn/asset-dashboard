/**
 * Unit tests for server/post-export-html.ts
 *
 * The module exports:
 *   - renderPostHTML(post: GeneratedPost): string
 *
 * Internal helpers (not exported):
 *   - esc(s): HTML entity escaping
 *
 * Tests verify HTML structure, title/SEO title fallback, HTML escaping,
 * status labels and colors, conditional sections (introduction, conclusion,
 * sections, review checklist, table of contents), date formatting,
 * and graceful handling of minimal/missing optional fields.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { GeneratedPost, PostSection, ReviewChecklist } from '../../shared/types/content.js';

let renderPostHTML: (post: GeneratedPost) => string;

beforeAll(async () => {
  const mod = await import('../../server/post-export-html.js');
  renderPostHTML = mod.renderPostHTML;
});

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makeSection(overrides: Partial<PostSection> = {}): PostSection {
  return {
    index: 0,
    heading: 'Section Heading',
    content: '<p>Section body content.</p>',
    wordCount: 100,
    targetWordCount: 150,
    keywords: ['keyword'],
    status: 'done',
    ...overrides,
  };
}

function makePost(overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  return {
    id: 'post-1',
    workspaceId: 'ws-1',
    briefId: 'brief-1',
    targetKeyword: 'best running shoes',
    title: 'The Best Running Shoes of 2026',
    metaDescription: 'Find the best running shoes for every terrain.',
    introduction: '<p>Introduction paragraph.</p>',
    sections: [makeSection()],
    conclusion: '<p>Conclusion paragraph.</p>',
    totalWordCount: 1200,
    targetWordCount: 1500,
    status: 'draft',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── HTML structure ─────────────────────────────────────────────────────────────

describe('renderPostHTML — document structure', () => {
  it('returns a string starting with DOCTYPE declaration', () => {
    const html = renderPostHTML(makePost());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('includes an <html> element with lang="en"', () => {
    const html = renderPostHTML(makePost());
    expect(html).toContain('<html lang="en">');
  });

  it('includes a <head> and <body> element', () => {
    const html = renderPostHTML(makePost());
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
  });

  it('includes STUDIO_NAME in the document', () => {
    const html = renderPostHTML(makePost());
    // STUDIO_NAME = 'hmpsn studio'
    expect(html).toContain('hmpsn studio');
  });

  it('includes STUDIO_URL as a link in the footer', () => {
    const html = renderPostHTML(makePost());
    expect(html).toContain('hmpsn.studio');
  });

  it('includes the post title in the document body', () => {
    const html = renderPostHTML(makePost({ title: 'My Unique Post Title' }));
    expect(html).toContain('My Unique Post Title');
  });

  it('includes the target keyword in the header', () => {
    const html = renderPostHTML(makePost({ targetKeyword: 'unique target keyword' }));
    expect(html).toContain('unique target keyword');
  });
});

// ── <title> tag — seoTitle fallback ───────────────────────────────────────────

describe('renderPostHTML — <title> tag', () => {
  it('uses seoTitle in the <title> tag when present', () => {
    const html = renderPostHTML(makePost({
      title: 'Post Title',
      seoTitle: 'SEO Optimized Title Tag',
    }));
    expect(html).toContain('<title>SEO Optimized Title Tag');
    // The plain title should not appear in the <title> tag
    expect(html).not.toMatch(/<title>Post Title/);
  });

  it('falls back to post title in the <title> tag when seoTitle is absent', () => {
    const html = renderPostHTML(makePost({
      title: 'Plain Post Title',
      seoTitle: undefined,
    }));
    expect(html).toContain('<title>Plain Post Title');
  });
});

// ── SEO preview section ────────────────────────────────────────────────────────

describe('renderPostHTML — SEO preview section', () => {
  it('shows seoTitle in seo-title element when present', () => {
    const html = renderPostHTML(makePost({
      seoTitle: 'Custom SEO Title for Preview',
    }));
    // The seo-title div should contain the seoTitle
    expect(html).toMatch(/class="seo-title"[^>]*>Custom SEO Title for Preview/);
  });

  it('falls back to post title in seo-title element when seoTitle is absent', () => {
    const html = renderPostHTML(makePost({
      title: 'Fallback Post Title',
      seoTitle: undefined,
    }));
    expect(html).toMatch(/class="seo-title"[^>]*>Fallback Post Title/);
  });

  it('shows seoMetaDescription in seo-desc element when present', () => {
    const html = renderPostHTML(makePost({
      seoMetaDescription: 'Custom SEO meta description text here.',
    }));
    expect(html).toMatch(/class="seo-desc"[^>]*>Custom SEO meta description text here\./);
  });

  it('falls back to metaDescription when seoMetaDescription is absent', () => {
    const html = renderPostHTML(makePost({
      metaDescription: 'Fallback meta description',
      seoMetaDescription: undefined,
    }));
    expect(html).toMatch(/class="seo-desc"[^>]*>Fallback meta description/);
  });

  it('shows the published slug when available', () => {
    const html = renderPostHTML(makePost({ publishedSlug: '/blog/my-post-slug' }));
    expect(html).toContain('/blog/my-post-slug');
  });

  it('shows fallback placeholder URL when publishedSlug is absent', () => {
    const html = renderPostHTML(makePost({ publishedSlug: undefined }));
    expect(html).toContain('example.com/...');
  });
});

// ── HTML escaping (esc helper) ────────────────────────────────────────────────

describe('renderPostHTML — HTML escaping', () => {
  it('escapes ampersands in the post title', () => {
    const html = renderPostHTML(makePost({ title: 'Shoes & Gear Review' }));
    expect(html).toContain('Shoes &amp; Gear Review');
    expect(html).not.toContain('Shoes & Gear Review');
  });

  it('escapes < and > in the post title', () => {
    const html = renderPostHTML(makePost({ title: 'Guide <br> to Shoes' }));
    expect(html).toContain('Guide &lt;br&gt; to Shoes');
    expect(html).not.toContain('Guide <br> to Shoes');
  });

  it('escapes double quotes in the post title', () => {
    const html = renderPostHTML(makePost({ title: 'The "Best" Shoes' }));
    expect(html).toContain('The &quot;Best&quot; Shoes');
  });

  it('escapes script tags in seoTitle without executing them', () => {
    const html = renderPostHTML(makePost({ seoTitle: '<script>alert(1)</script>' }));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // The raw script tag must not appear anywhere except inside escaped form
    const unescaped = html.replace(/&lt;script&gt;/g, '').replace(/&lt;\/script&gt;/g, '');
    expect(unescaped).not.toContain('<script>alert(1)</script>');
  });

  it('escapes ampersands in the target keyword', () => {
    const html = renderPostHTML(makePost({ targetKeyword: 'shoes & boots' }));
    expect(html).toContain('shoes &amp; boots');
  });
});

// ── Status labels and colors ──────────────────────────────────────────────────

describe('renderPostHTML — status labels', () => {
  it('shows "Approved" label for approved status', () => {
    const html = renderPostHTML(makePost({ status: 'approved' }));
    expect(html).toContain('Approved');
  });

  it('shows "In Review" label for review status', () => {
    const html = renderPostHTML(makePost({ status: 'review' }));
    expect(html).toContain('In Review');
  });

  it('shows "Draft" label for draft status', () => {
    const html = renderPostHTML(makePost({ status: 'draft' }));
    expect(html).toContain('Draft');
  });

  it('shows "Failed" label for error status', () => {
    const html = renderPostHTML(makePost({ status: 'error' }));
    expect(html).toContain('Failed');
  });

  it('shows "Draft" label for generating status (fallback)', () => {
    const html = renderPostHTML(makePost({ status: 'generating' }));
    expect(html).toContain('Draft');
  });

  it('uses green color (#16a34a) for approved status badge', () => {
    const html = renderPostHTML(makePost({ status: 'approved' }));
    expect(html).toContain('#16a34a');
  });

  it('uses amber color (#b45309) for review status badge', () => {
    const html = renderPostHTML(makePost({ status: 'review' }));
    expect(html).toContain('#b45309');
  });

  it('uses red color (#dc2626) for error status badge', () => {
    const html = renderPostHTML(makePost({ status: 'error' }));
    expect(html).toContain('#dc2626');
  });

  it('uses slate color (#64748b) for draft status badge', () => {
    const html = renderPostHTML(makePost({ status: 'draft' }));
    expect(html).toContain('#64748b');
  });
});

// ── Metrics strip ─────────────────────────────────────────────────────────────

describe('renderPostHTML — key metrics', () => {
  it('shows totalWordCount formatted with locale comma separator', () => {
    const html = renderPostHTML(makePost({ totalWordCount: 1500 }));
    expect(html).toContain('1,500');
  });

  it('shows targetWordCount formatted with locale comma separator', () => {
    const html = renderPostHTML(makePost({ targetWordCount: 2500 }));
    expect(html).toContain('2,500');
  });

  it('shows the section count matching the sections array length', () => {
    const html = renderPostHTML(makePost({
      sections: [makeSection({ index: 0 }), makeSection({ index: 1 })],
    }));
    // The sections count "2" should appear in the meta-card for Sections
    expect(html).toMatch(/mc-label[^>]*>Sections[\s\S]*?mc-value[^>]*>2/);
  });
});

// ── Date formatting ───────────────────────────────────────────────────────────

describe('renderPostHTML — date formatting', () => {
  it('renders the created date in long human-readable format', () => {
    const html = renderPostHTML(makePost({ createdAt: '2026-05-15T00:00:00.000Z' }));
    // en-US long format: "May 15, 2026"
    expect(html).toContain('May');
    expect(html).toContain('2026');
  });

  it('shows updated date when it differs from created date', () => {
    const html = renderPostHTML(makePost({
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z',
    }));
    expect(html).toContain('Updated');
    expect(html).toContain('May');
  });

  it('does not show updated date when it matches created date', () => {
    const html = renderPostHTML(makePost({
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }));
    expect(html).not.toContain('Updated');
  });
});

// ── Content sections ──────────────────────────────────────────────────────────

describe('renderPostHTML — content rendering', () => {
  it('renders the introduction HTML when present', () => {
    const html = renderPostHTML(makePost({
      introduction: '<p>My intro paragraph.</p>',
    }));
    expect(html).toContain('<p>My intro paragraph.</p>');
  });

  it('omits the introduction div when introduction is empty string', () => {
    const html = renderPostHTML(makePost({ introduction: '' }));
    // Empty string is falsy; introduction block should not render
    expect(html).not.toContain('My intro paragraph.');
  });

  it('renders each section\'s content HTML', () => {
    const html = renderPostHTML(makePost({
      sections: [
        makeSection({ content: '<p>First section body.</p>' }),
        makeSection({ content: '<p>Second section body.</p>', index: 1 }),
      ],
    }));
    expect(html).toContain('<p>First section body.</p>');
    expect(html).toContain('<p>Second section body.</p>');
  });

  it('renders the conclusion HTML when present', () => {
    const html = renderPostHTML(makePost({
      conclusion: '<p>My conclusion paragraph.</p>',
    }));
    expect(html).toContain('<p>My conclusion paragraph.</p>');
  });

  it('omits the conclusion div when conclusion is empty string', () => {
    const html = renderPostHTML(makePost({ conclusion: '' }));
    expect(html).not.toContain('My conclusion paragraph.');
  });
});

// ── Table of contents ─────────────────────────────────────────────────────────

describe('renderPostHTML — table of contents', () => {
  it('renders TOC when there are more than 2 entries (intro + sections + conclusion)', () => {
    const html = renderPostHTML(makePost({
      introduction: '<p>Intro</p>',
      sections: [
        makeSection({ heading: 'Section One', index: 0 }),
        makeSection({ heading: 'Section Two', index: 1 }),
      ],
      conclusion: '<p>Conclusion</p>',
    }));
    expect(html).toContain('<div class="toc">');
    expect(html).toContain('toc-title');
    expect(html).toContain('Introduction');
    expect(html).toContain('Section One');
    expect(html).toContain('Section Two');
    expect(html).toContain('Conclusion');
  });

  it('omits TOC when there are 2 or fewer entries', () => {
    const html = renderPostHTML(makePost({
      introduction: '',
      sections: [makeSection({ heading: 'Only Section' })],
      conclusion: '',
    }));
    // Only 1 section heading = 1 TOC entry → TOC div not rendered
    // (Note: "<!-- Table of Contents -->" HTML comment is always emitted; check for the toc div)
    expect(html).not.toContain('<div class="toc">');
  });

  it('includes Introduction in TOC when introduction is present', () => {
    const html = renderPostHTML(makePost({
      introduction: '<p>Intro text</p>',
      sections: [
        makeSection({ heading: 'Body Section', index: 0 }),
        makeSection({ heading: 'More Content', index: 1 }),
      ],
      conclusion: '<p>Conclusion text</p>',
    }));
    expect(html).toContain('Introduction');
  });

  it('includes Conclusion in TOC when conclusion is present', () => {
    const html = renderPostHTML(makePost({
      introduction: '<p>Intro text</p>',
      sections: [
        makeSection({ heading: 'Body Section', index: 0 }),
        makeSection({ heading: 'More Content', index: 1 }),
      ],
      conclusion: '<p>Conclusion text</p>',
    }));
    expect(html).toContain('Conclusion');
  });

  it('escapes section headings in TOC', () => {
    const html = renderPostHTML(makePost({
      introduction: '<p>Intro</p>',
      sections: [
        makeSection({ heading: 'Section <script>xss</script>', index: 0 }),
        makeSection({ heading: 'Normal Section', index: 1 }),
      ],
      conclusion: '<p>Conclusion</p>',
    }));
    expect(html).toContain('&lt;script&gt;xss&lt;/script&gt;');
  });
});

// ── Review checklist ──────────────────────────────────────────────────────────

describe('renderPostHTML — review checklist', () => {
  const fullChecklist: ReviewChecklist = {
    factual_accuracy: true,
    brand_voice: false,
    internal_links: true,
    no_hallucinations: false,
    meta_optimized: true,
    word_count_target: false,
  };

  it('renders checklist section when reviewChecklist is present', () => {
    const html = renderPostHTML(makePost({ reviewChecklist: fullChecklist }));
    expect(html).toContain('<div class="section-title">Review Checklist</div>');
    expect(html).toContain('Factual accuracy verified');
    expect(html).toContain('Brand voice match confirmed');
    expect(html).toContain('Internal links verified and working');
    expect(html).toContain('No AI hallucinations or fabricated statistics');
    expect(html).toContain('Meta title/description optimized');
    expect(html).toContain('Word count within brief target');
  });

  it('omits checklist section when reviewChecklist is absent', () => {
    const html = renderPostHTML(makePost({ reviewChecklist: undefined }));
    // (Note: "<!-- Review Checklist -->" HTML comment and ".checklist-wrap" CSS class
    // are always emitted in the template; check for the actual rendered section div)
    expect(html).not.toContain('<div class="section-title">Review Checklist</div>');
    expect(html).not.toContain('<div class="checklist-wrap">');
  });

  it('marks checked items with "done" class and checkmark', () => {
    const html = renderPostHTML(makePost({
      reviewChecklist: { ...fullChecklist, factual_accuracy: true },
    }));
    // The "done" CSS class appears for checked items
    expect(html).toContain('checklist-check done');
    // Checkmark character entity for done items
    expect(html).toContain('&#10003;');
  });

  it('marks unchecked items with "pending" class and no checkmark', () => {
    const html = renderPostHTML(makePost({
      reviewChecklist: { ...fullChecklist, brand_voice: false },
    }));
    expect(html).toContain('checklist-check pending');
  });

  it('renders all-true checklist with six done items', () => {
    const allDone: ReviewChecklist = {
      factual_accuracy: true,
      brand_voice: true,
      internal_links: true,
      no_hallucinations: true,
      meta_optimized: true,
      word_count_target: true,
    };
    const html = renderPostHTML(makePost({ reviewChecklist: allDone }));
    const doneCount = (html.match(/checklist-check done/g) || []).length;
    expect(doneCount).toBe(6);
  });

  it('renders all-false checklist with six pending items and no checkmarks', () => {
    const allPending: ReviewChecklist = {
      factual_accuracy: false,
      brand_voice: false,
      internal_links: false,
      no_hallucinations: false,
      meta_optimized: false,
      word_count_target: false,
    };
    const html = renderPostHTML(makePost({ reviewChecklist: allPending }));
    const pendingCount = (html.match(/checklist-check pending/g) || []).length;
    expect(pendingCount).toBe(6);
    // No checkmarks for all-false
    expect(html).not.toContain('&#10003;');
  });
});

// ── Missing optional fields — no throw ───────────────────────────────────────

describe('renderPostHTML — minimal / missing optional fields', () => {
  it('does not throw when rendering a minimal post with no optional fields', () => {
    const minimal: GeneratedPost = {
      id: 'min-1',
      workspaceId: 'ws-1',
      briefId: 'brief-1',
      targetKeyword: 'minimal keyword',
      title: 'Minimal Post',
      metaDescription: 'Minimal description',
      introduction: '',
      sections: [],
      conclusion: '',
      totalWordCount: 0,
      targetWordCount: 500,
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(() => renderPostHTML(minimal)).not.toThrow();
  });

  it('returns a non-empty HTML string for a minimal post', () => {
    const minimal: GeneratedPost = {
      id: 'min-2',
      workspaceId: 'ws-1',
      briefId: 'brief-1',
      targetKeyword: 'test keyword',
      title: 'Test Post',
      metaDescription: '',
      introduction: '',
      sections: [],
      conclusion: '',
      totalWordCount: 0,
      targetWordCount: 0,
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const html = renderPostHTML(minimal);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(100);
  });

  it('renders zero totalWordCount as "0"', () => {
    const html = renderPostHTML(makePost({ totalWordCount: 0 }));
    // 0.toLocaleString() = "0"
    expect(html).toContain('>0<');
  });

  it('renders an empty sections array without throwing', () => {
    const html = renderPostHTML(makePost({ sections: [] }));
    expect(html).toContain('Sections');
    // Section count should be 0
    expect(html).toMatch(/mc-label[^>]*>Sections[\s\S]*?mc-value[^>]*>0/);
  });
});
