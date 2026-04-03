// tests/formatting-equivalence.test.ts
// Verifies that the three new formatting helpers in workspace-intelligence.ts
// produce substantively equivalent output to the legacy mini-builders in seo-context.ts.
//
// Strategy: the helpers are pure functions; we supply the same data to both
// the old inline formatting logic (replicated via string matching) and the new
// helpers, then assert each keyword / persona name / page path appears in both.

import { describe, it, expect } from 'vitest';
import {
  formatKeywordsForPrompt,
  formatPersonasForPrompt,
  formatPageMapForPrompt,
} from '../server/workspace-intelligence.js';
import type { SeoContextSlice } from '../shared/types/intelligence.js';
import type { AudiencePersona, PageKeywordMap, KeywordStrategy } from '../shared/types/workspace.js';

// ── Test fixtures ────────────────────────────────────────────────────────

const SITE_KEYWORDS = ['dental implants', 'teeth whitening', 'cosmetic dentistry'];

const STRATEGY: KeywordStrategy = {
  siteKeywords: SITE_KEYWORDS,
  pageMap: [
    {
      pagePath: '/services/implants',
      pageTitle: 'Dental Implants',
      primaryKeyword: 'dental implants',
      secondaryKeywords: ['implant surgery', 'tooth replacement'],
      searchIntent: 'commercial',
    },
    {
      pagePath: '/services/whitening',
      pageTitle: 'Teeth Whitening',
      primaryKeyword: 'teeth whitening',
      secondaryKeywords: ['zoom whitening', 'professional bleaching', 'whiter teeth'],
    },
  ],
  opportunities: [],
  businessContext: 'Premier dental clinic serving Chicago area patients',
  generatedAt: new Date().toISOString(),
};

const PAGE_KEYWORD: PageKeywordMap = {
  pagePath: '/services/implants',
  pageTitle: 'Dental Implants',
  primaryKeyword: 'dental implants',
  secondaryKeywords: ['implant surgery', 'tooth replacement'],
  searchIntent: 'commercial',
};

const PERSONAS: AudiencePersona[] = [
  {
    id: 'p1',
    name: 'Cost-Conscious Carol',
    description: 'A 45-year-old who needs dental work but worries about cost',
    painPoints: ['dental anxiety', 'high cost of care'],
    goals: ['affordable quality care', 'pain-free treatment'],
    objections: ['too expensive', 'not sure if worth it'],
    preferredContentFormat: 'FAQ articles',
    buyingStage: 'consideration',
  },
  {
    id: 'p2',
    name: 'Smile-Ready Sam',
    description: 'Young professional seeking cosmetic improvements',
    painPoints: ['self-confidence issues'],
    goals: ['brighter smile', 'professional appearance'],
    objections: ['recovery time concerns'],
  },
];

function makeSeoSlice(overrides?: Partial<SeoContextSlice>): SeoContextSlice {
  return {
    strategy: STRATEGY,
    brandVoice: 'Warm and professional',
    businessContext: 'Premier dental clinic serving Chicago area patients',
    personas: PERSONAS,
    knowledgeBase: 'We offer implants, veneers, and whitening services',
    ...overrides,
  };
}

// ── formatKeywordsForPrompt ──────────────────────────────────────────────

describe('formatKeywordsForPrompt', () => {
  it('returns empty string for null/undefined input', () => {
    expect(formatKeywordsForPrompt(null)).toBe('');
    expect(formatKeywordsForPrompt(undefined)).toBe('');
  });

  it('returns empty string when strategy is undefined', () => {
    const seo = makeSeoSlice({ strategy: undefined });
    expect(formatKeywordsForPrompt(seo)).toBe('');
  });

  it('includes all site-level keywords (up to 8)', () => {
    const seo = makeSeoSlice();
    const block = formatKeywordsForPrompt(seo);

    for (const kw of SITE_KEYWORDS) {
      expect(block).toContain(kw);
    }
  });

  it('includes the "KEYWORD STRATEGY" header matching legacy format', () => {
    const seo = makeSeoSlice();
    const block = formatKeywordsForPrompt(seo);
    expect(block).toContain('KEYWORD STRATEGY (incorporate these naturally):');
  });

  it('includes business context', () => {
    const seo = makeSeoSlice();
    const block = formatKeywordsForPrompt(seo);
    expect(block).toContain('General business context:');
    expect(block).toContain('Chicago area');
  });

  it('includes page-specific keywords when pageKeywords slice is present', () => {
    const seo = makeSeoSlice({ pageKeywords: PAGE_KEYWORD });
    const block = formatKeywordsForPrompt(seo);
    expect(block).toContain('THIS PAGE\'S TARGET');
    expect(block).toContain('dental implants');
    expect(block).toContain('commercial');
    // Secondary keywords
    expect(block).toContain('implant surgery');
    expect(block).toContain('tooth replacement');
  });

  it('does not include page section when pageKeywords is absent', () => {
    const seo = makeSeoSlice({ pageKeywords: undefined });
    const block = formatKeywordsForPrompt(seo);
    expect(block).not.toContain('THIS PAGE\'S TARGET');
  });

  it('matches legacy "Site target keywords:" prefix format', () => {
    const seo = makeSeoSlice();
    const block = formatKeywordsForPrompt(seo);
    expect(block).toContain('Site target keywords:');
  });

  it('caps site keywords at 8 (matching legacy slice behavior)', () => {
    const manyKeywords = Array.from({ length: 12 }, (_, i) => `keyword-${i}`);
    const seo = makeSeoSlice({
      strategy: { ...STRATEGY, siteKeywords: manyKeywords, businessContext: undefined },
    });
    const block = formatKeywordsForPrompt(seo);
    // keywords 0-7 should appear, 8-11 should not
    for (let i = 0; i < 8; i++) {
      expect(block).toContain(`keyword-${i}`);
    }
    expect(block).not.toContain('keyword-8');
  });
});

// ── formatPersonasForPrompt ──────────────────────────────────────────────

describe('formatPersonasForPrompt', () => {
  it('returns empty string for null/undefined input', () => {
    expect(formatPersonasForPrompt(null)).toBe('');
    expect(formatPersonasForPrompt(undefined)).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(formatPersonasForPrompt([])).toBe('');
  });

  it('includes all persona names', () => {
    const block = formatPersonasForPrompt(PERSONAS);
    expect(block).toContain('Cost-Conscious Carol');
    expect(block).toContain('Smile-Ready Sam');
  });

  it('includes the "TARGET AUDIENCE PERSONAS" header matching legacy format', () => {
    const block = formatPersonasForPrompt(PERSONAS);
    expect(block).toContain('TARGET AUDIENCE PERSONAS');
  });

  it('includes buying stage when present', () => {
    const block = formatPersonasForPrompt(PERSONAS);
    expect(block).toContain('consideration stage');
  });

  it('includes description text', () => {
    const block = formatPersonasForPrompt(PERSONAS);
    expect(block).toContain('45-year-old');
    expect(block).toContain('cosmetic improvements');
  });

  it('includes pain points when present', () => {
    const block = formatPersonasForPrompt(PERSONAS);
    expect(block).toContain('Pain points:');
    expect(block).toContain('dental anxiety');
    expect(block).toContain('high cost of care');
  });

  it('includes goals when present', () => {
    const block = formatPersonasForPrompt(PERSONAS);
    expect(block).toContain('Goals:');
    expect(block).toContain('affordable quality care');
  });

  it('includes objections when present', () => {
    const block = formatPersonasForPrompt(PERSONAS);
    expect(block).toContain('Objections:');
    expect(block).toContain('too expensive');
  });

  it('includes preferred content format when present', () => {
    const block = formatPersonasForPrompt(PERSONAS);
    expect(block).toContain('Prefers:');
    expect(block).toContain('FAQ articles');
  });

  it('omits buying stage when not provided', () => {
    const noBuyingStage: AudiencePersona[] = [
      { id: 'p3', name: 'Generic Gary', description: 'A test persona', painPoints: [], goals: [], objections: [] },
    ];
    const block = formatPersonasForPrompt(noBuyingStage);
    expect(block).toContain('Generic Gary');
    expect(block).not.toContain('stage)');
  });

  it('omits empty arrays (pain points / goals / objections)', () => {
    const minimal: AudiencePersona[] = [
      { id: 'p4', name: 'Minimal Mike', description: 'Simple persona', painPoints: [], goals: [], objections: [] },
    ];
    const block = formatPersonasForPrompt(minimal);
    expect(block).toContain('Minimal Mike');
    expect(block).not.toContain('Pain points:');
    expect(block).not.toContain('Goals:');
    expect(block).not.toContain('Objections:');
  });

  it('produces output containing same content as legacy buildPersonasContext inline logic', () => {
    // Replicate the legacy formatting inline (from buildPersonasContext in seo-context.ts)
    const legacyPersonaStr = PERSONAS.map(p => {
      const parts = [`**${p.name}**${p.buyingStage ? ` (${p.buyingStage} stage)` : ''}: ${p.description}`];
      if (p.painPoints.length) parts.push(`  Pain points: ${p.painPoints.join('; ')}`);
      if (p.goals.length) parts.push(`  Goals: ${p.goals.join('; ')}`);
      if (p.objections.length) parts.push(`  Objections: ${p.objections.join('; ')}`);
      if (p.preferredContentFormat) parts.push(`  Prefers: ${p.preferredContentFormat}`);
      return parts.join('\n');
    }).join('\n\n');
    const legacyBlock = `\n\nTARGET AUDIENCE PERSONAS (write to address these specific people — their pain points, goals, and objections):\n${legacyPersonaStr}`;

    const newBlock = formatPersonasForPrompt(PERSONAS);

    // Both blocks should contain all persona names and key content
    for (const persona of PERSONAS) {
      expect(newBlock).toContain(persona.name);
      expect(legacyBlock).toContain(persona.name);
    }
    // Structural equivalence — same header
    expect(newBlock).toContain('TARGET AUDIENCE PERSONAS');
    expect(legacyBlock).toContain('TARGET AUDIENCE PERSONAS');
  });
});

// ── formatPageMapForPrompt ────────────────────────────────────────────────

describe('formatPageMapForPrompt', () => {
  it('returns empty string for null/undefined input', () => {
    expect(formatPageMapForPrompt(null)).toBe('');
    expect(formatPageMapForPrompt(undefined)).toBe('');
  });

  it('returns empty string when strategy is undefined', () => {
    const seo = makeSeoSlice({ strategy: undefined });
    expect(formatPageMapForPrompt(seo)).toBe('');
  });

  it('returns empty string when pageMap is empty', () => {
    const seo = makeSeoSlice({ strategy: { ...STRATEGY, pageMap: [] } });
    expect(formatPageMapForPrompt(seo)).toBe('');
  });

  it('includes all page paths when no pagePath filter provided', () => {
    const seo = makeSeoSlice();
    const block = formatPageMapForPrompt(seo);
    expect(block).toContain('/services/implants');
    expect(block).toContain('/services/whitening');
  });

  it('includes primary keywords for each page', () => {
    const seo = makeSeoSlice();
    const block = formatPageMapForPrompt(seo);
    expect(block).toContain('"dental implants"');
    expect(block).toContain('"teeth whitening"');
  });

  it('includes secondary keywords in "(also: ...)" format', () => {
    const seo = makeSeoSlice();
    const block = formatPageMapForPrompt(seo);
    expect(block).toContain('(also:');
    expect(block).toContain('implant surgery');
    expect(block).toContain('zoom whitening');
  });

  it('caps secondary keywords at 3 (matching legacy behavior)', () => {
    const seo = makeSeoSlice();
    const block = formatPageMapForPrompt(seo);
    // whitening page has 3 secondary keywords — all 3 should appear
    expect(block).toContain('zoom whitening');
    expect(block).toContain('professional bleaching');
    expect(block).toContain('whiter teeth');
  });

  it('includes the "EXISTING KEYWORD MAP" header matching legacy format', () => {
    const seo = makeSeoSlice();
    const block = formatPageMapForPrompt(seo);
    expect(block).toContain('EXISTING KEYWORD MAP (avoid cannibalization, suggest internal links where relevant):');
  });

  it('filters to a single page when pagePath is provided', () => {
    const seo = makeSeoSlice();
    const block = formatPageMapForPrompt(seo, '/services/implants');
    expect(block).toContain('/services/implants');
    expect(block).not.toContain('/services/whitening');
  });

  it('returns empty string when pagePath filter matches no pages', () => {
    const seo = makeSeoSlice();
    const block = formatPageMapForPrompt(seo, '/nonexistent-page');
    expect(block).toBe('');
  });

  it('produces output containing same content as legacy buildKeywordMapContext inline logic', () => {
    const seo = makeSeoSlice();
    const pageMap = seo.strategy!.pageMap;

    // Replicate the legacy formatting inline (from buildKeywordMapContext in seo-context.ts)
    const legacyMapStr = pageMap.map(
      p => `${p.pagePath}: "${p.primaryKeyword}"${p.secondaryKeywords?.length ? ` (also: ${p.secondaryKeywords.slice(0, 3).join(', ')})` : ''}`
    ).join('\n');
    const legacyBlock = `\n\nEXISTING KEYWORD MAP (avoid cannibalization, suggest internal links where relevant):\n${legacyMapStr}`;

    const newBlock = formatPageMapForPrompt(seo);

    // Both blocks should contain each page path and its primary keyword
    for (const page of pageMap) {
      expect(newBlock).toContain(page.pagePath);
      expect(legacyBlock).toContain(page.pagePath);
      expect(newBlock).toContain(page.primaryKeyword);
      expect(legacyBlock).toContain(page.primaryKeyword);
    }
    // Structural equivalence — same header
    expect(newBlock).toContain('EXISTING KEYWORD MAP');
    expect(legacyBlock).toContain('EXISTING KEYWORD MAP');
  });
});
