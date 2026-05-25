/**
 * Wave 22 — Unit tests for server/brief-export-html.ts
 *
 * The module exports:
 *   - renderBriefHTML(brief): produces an HTML string
 *   - renderBriefHTMLForPDF(brief): delegates to renderBriefHTML
 *
 * Internal pure helpers (not exported):
 *   - esc(s): HTML entity escaping
 *   - diffColor(score): returns color for keyword difficulty
 *
 * Tests verify HTML content, escaping, conditional sections,
 * table-of-contents generation, and the diffColor thresholds
 * via the rendered output.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { ContentBrief } from '../../shared/types/content.js';

let renderBriefHTML: (brief: ContentBrief) => string;
let renderBriefHTMLForPDF: (brief: ContentBrief) => string;

beforeAll(async () => {
  const mod = await import('../../server/brief-export-html.js');
  renderBriefHTML = mod.renderBriefHTML;
  renderBriefHTMLForPDF = mod.renderBriefHTMLForPDF;
});

// ── Minimal valid brief fixture ────────────────────────────────────────────────

function makeBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    id: 'brief-1',
    workspaceId: 'ws-1',
    targetKeyword: 'best running shoes',
    secondaryKeywords: ['trail shoes', 'marathon shoes'],
    suggestedTitle: 'The Best Running Shoes of 2026',
    suggestedMetaDesc: 'Find the best running shoes for every terrain.',
    outline: [
      { heading: 'Introduction', notes: 'Overview of running shoe types', wordCount: 200 },
      { heading: 'Top Picks', notes: 'Our top 10 picks', wordCount: 500, keywords: ['lightweight'] },
    ],
    wordCountTarget: 2500,
    intent: 'informational',
    audience: 'Amateur runners seeking advice',
    competitorInsights: '',
    internalLinkSuggestions: [],
    createdAt: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

// ── HTML structure ─────────────────────────────────────────────────────────────

describe('renderBriefHTML — document structure', () => {
  it('returns a string starting with DOCTYPE declaration', () => {
    const html = renderBriefHTML(makeBrief());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('includes the target keyword in the page title', () => {
    const html = renderBriefHTML(makeBrief({ targetKeyword: 'SEO tools 2026' }));
    expect(html).toContain('SEO tools 2026');
  });

  it('includes the suggested title in the header', () => {
    const html = renderBriefHTML(makeBrief({ suggestedTitle: 'The Ultimate SEO Guide' }));
    expect(html).toContain('The Ultimate SEO Guide');
  });

  it('includes the creation date in a human-readable format', () => {
    const html = renderBriefHTML(makeBrief({ createdAt: '2026-01-15T10:00:00.000Z' }));
    expect(html).toContain('January 15, 2026');
  });

  it('includes STUDIO_NAME in the footer', () => {
    const html = renderBriefHTML(makeBrief());
    // STUDIO_NAME = 'hmpsn studio'
    expect(html).toContain('hmpsn studio');
  });

  it('includes STUDIO_URL as a link in the footer', () => {
    const html = renderBriefHTML(makeBrief());
    expect(html).toContain('hmpsn.studio');
  });
});

// ── HTML escaping (esc helper) ────────────────────────────────────────────────

describe('renderBriefHTML — HTML escaping', () => {
  it('escapes ampersands in the target keyword', () => {
    const html = renderBriefHTML(makeBrief({ targetKeyword: 'shoes & gear' }));
    expect(html).toContain('shoes &amp; gear');
    expect(html).not.toContain('shoes & gear');
  });

  it('escapes < and > in the suggested title', () => {
    const html = renderBriefHTML(makeBrief({ suggestedTitle: 'Guide <br> Tips' }));
    expect(html).toContain('Guide &lt;br&gt; Tips');
  });

  it('escapes double quotes in audience field', () => {
    const html = renderBriefHTML(makeBrief({ audience: 'Runners with "time to spare"' }));
    expect(html).toContain('Runners with &quot;time to spare&quot;');
  });

  it('escapes HTML in secondary keywords', () => {
    const html = renderBriefHTML(makeBrief({ secondaryKeywords: ['<script>alert(1)</script>'] }));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('escapes HTML in outline headings', () => {
    const html = renderBriefHTML(makeBrief({
      outline: [{ heading: '<h2>Injected</h2>', notes: 'test', wordCount: 100 }],
    }));
    expect(html).toContain('&lt;h2&gt;Injected&lt;/h2&gt;');
  });
});

// ── diffColor helper (tested via rendered keyword difficulty) ─────────────────

describe('renderBriefHTML — diffColor (keyword difficulty)', () => {
  it('uses green (#16a34a) for difficulty score ≤ 30', () => {
    const html = renderBriefHTML(makeBrief({ difficultyScore: 25 }));
    expect(html).toContain('#16a34a');
    expect(html).toContain('25/100');
  });

  it('uses amber (#b45309) for difficulty score between 31 and 60', () => {
    const html = renderBriefHTML(makeBrief({ difficultyScore: 50 }));
    expect(html).toContain('#b45309');
    expect(html).toContain('50/100');
  });

  it('uses red (#dc2626) for difficulty score > 60', () => {
    const html = renderBriefHTML(makeBrief({ difficultyScore: 75 }));
    expect(html).toContain('#dc2626');
    expect(html).toContain('75/100');
  });

  it('uses green exactly at boundary score 30', () => {
    const html = renderBriefHTML(makeBrief({ difficultyScore: 30 }));
    expect(html).toContain('#16a34a');
  });

  it('uses amber exactly at boundary score 60', () => {
    const html = renderBriefHTML(makeBrief({ difficultyScore: 60 }));
    expect(html).toContain('#b45309');
  });
});

// ── Conditional sections ───────────────────────────────────────────────────────

describe('renderBriefHTML — conditional sections', () => {
  it('renders secondary keywords section when keywords present', () => {
    const html = renderBriefHTML(makeBrief({ secondaryKeywords: ['marathon shoes'] }));
    expect(html).toContain('marathon shoes');
    expect(html).toContain('Keywords to Include');
  });

  it('omits keywords section content when secondaryKeywords is empty', () => {
    const html = renderBriefHTML(makeBrief({ secondaryKeywords: [] }));
    // The HTML comment <!-- Keywords to Include --> always renders, but the section div should not
    expect(html).not.toContain('<div class="section-title">Keywords to Include</div>');
  });

  it('renders topical entities section when entities present', () => {
    const html = renderBriefHTML(makeBrief({ topicalEntities: ['Nike', 'Adidas'] }));
    expect(html).toContain('Topics to Reference');
    expect(html).toContain('Nike');
    expect(html).toContain('Adidas');
  });

  it('omits topical entities section when empty', () => {
    const html = renderBriefHTML(makeBrief({ topicalEntities: [] }));
    expect(html).not.toContain('Topics to Reference');
  });

  it('renders people also ask section with numbered questions', () => {
    const html = renderBriefHTML(makeBrief({ peopleAlsoAsk: ['What brand is best?', 'How to break in shoes?'] }));
    expect(html).toContain('Q1.');
    expect(html).toContain('Q2.');
    expect(html).toContain('What brand is best?');
  });

  it('omits people also ask section when array is undefined', () => {
    const html = renderBriefHTML(makeBrief({ peopleAlsoAsk: undefined }));
    expect(html).not.toContain('Questions to Address');
  });

  it('renders SERP analysis section when present', () => {
    const html = renderBriefHTML(makeBrief({
      serpAnalysis: {
        contentType: 'listicle',
        avgWordCount: 1800,
        commonElements: ['comparison table', 'pros/cons'],
        gaps: ['no video content'],
      },
    }));
    expect(html).toContain('SERP Analysis');
    expect(html).toContain('listicle');
    expect(html).toContain('1,800');
    expect(html).toContain('no video content');
  });

  it('renders content outline with section numbering', () => {
    const html = renderBriefHTML(makeBrief({
      outline: [
        { heading: 'Intro', notes: 'Brief overview', wordCount: 100 },
        { heading: 'Main', notes: 'Core content' },
      ],
    }));
    expect(html).toContain('Section 1 of 2');
    expect(html).toContain('Section 2 of 2');
    expect(html).toContain('H2: Intro');
    expect(html).toContain('H2: Main');
  });

  it('renders CTA recommendations with Primary/Secondary badges', () => {
    const html = renderBriefHTML(makeBrief({
      ctaRecommendations: ['Sign up for newsletter', 'Download guide'],
    }));
    expect(html).toContain('Primary');
    expect(html).toContain('Secondary');
    expect(html).toContain('Sign up for newsletter');
    expect(html).toContain('Download guide');
  });

  it('renders e-e-a-t section with all four signals', () => {
    const html = renderBriefHTML(makeBrief({
      eeatGuidance: {
        experience: 'Include personal training anecdotes',
        expertise: 'Cite podiatrist recommendations',
        authority: 'Link to IAAF research',
        trust: 'Display return policy clearly',
      },
    }));
    expect(html).toContain('E-E-A-T');
    expect(html).toContain('Experience');
    expect(html).toContain('Expertise');
    expect(html).toContain('Authority');
    expect(html).toContain('Trust');
  });

  it('renders content checklist items with checkboxes', () => {
    const html = renderBriefHTML(makeBrief({
      contentChecklist: ['Include primary keyword in H1', 'Add internal links'],
    }));
    expect(html).toContain('Content Checklist');
    expect(html).toContain('Include primary keyword in H1');
    expect(html).toContain('checklist-box');
  });

  it('renders schema markup recommendations', () => {
    const html = renderBriefHTML(makeBrief({
      schemaRecommendations: [
        { type: 'Article', notes: 'Standard blog article schema' },
        { type: 'FAQPage', notes: 'Add FAQ schema for PAA questions' },
      ],
    }));
    expect(html).toContain('Schema Markup');
    expect(html).toContain('Article');
    expect(html).toContain('FAQPage');
  });

  it('renders executive summary when present', () => {
    const html = renderBriefHTML(makeBrief({ executiveSummary: 'This brief targets a high-intent audience.' }));
    expect(html).toContain('Strategic Overview');
    expect(html).toContain('This brief targets a high-intent audience.');
  });

  it('renders page type badge in subtitle when pageType is set', () => {
    const html = renderBriefHTML(makeBrief({ pageType: 'blog' }));
    expect(html).toContain('blog');
  });

  it('renders word count target formatted with comma separator', () => {
    const html = renderBriefHTML(makeBrief({ wordCountTarget: 2500 }));
    expect(html).toContain('2,500');
  });

  it('renders internal link suggestions as tags', () => {
    const html = renderBriefHTML(makeBrief({ internalLinkSuggestions: ['running-gear', 'shoe-care'] }));
    expect(html).toContain('Internal Links to Include');
    expect(html).toContain('/running-gear');
    expect(html).toContain('/shoe-care');
  });
});

// ── Table of contents ──────────────────────────────────────────────────────────

describe('renderBriefHTML — table of contents', () => {
  it('always includes Strategic Overview in TOC', () => {
    const html = renderBriefHTML(makeBrief());
    expect(html).toContain('Strategic Overview');
  });

  it('always includes Content Direction in TOC', () => {
    const html = renderBriefHTML(makeBrief());
    expect(html).toContain('Content Direction');
  });

  it('includes Keywords to Include as a toc-item when secondary keywords present', () => {
    const html = renderBriefHTML(makeBrief({ secondaryKeywords: ['keyword1'] }));
    // toc-item divs appear inside toc-grid; check that a toc-item element has the text
    expect(html).toMatch(/class="toc-item"[^>]*>[\s\S]*?Keywords to Include/);
  });

  it('includes SERP Analysis as a toc-item when serpAnalysis present', () => {
    const html = renderBriefHTML(makeBrief({
      serpAnalysis: { contentType: 'guide', avgWordCount: 1500, commonElements: [], gaps: [] },
    }));
    expect(html).toMatch(/class="toc-item"[^>]*>[\s\S]*?SERP Analysis/);
  });
});

// ── renderBriefHTMLForPDF delegation ──────────────────────────────────────────

describe('renderBriefHTMLForPDF', () => {
  it('returns the same HTML as renderBriefHTML', () => {
    const brief = makeBrief();
    expect(renderBriefHTMLForPDF(brief)).toBe(renderBriefHTML(brief));
  });
});
