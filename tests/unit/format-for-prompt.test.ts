// tests/unit/format-for-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { formatForPrompt } from '../../server/workspace-intelligence.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import { RICH_INTELLIGENCE, RICH_SEO_CONTEXT } from '../fixtures/rich-intelligence.js';

const baseIntelligence: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-1',
  assembledAt: '2026-03-30T12:00:00.000Z',
};

const richIntelligence: WorkspaceIntelligence = {
  ...baseIntelligence,
  seoContext: {
    strategy: undefined,
    brandVoice: 'Professional, authoritative, data-driven',
    businessContext: 'SEO agency serving mid-market B2B companies',
    personas: [],
    knowledgeBase: 'We specialize in technical SEO and content strategy.',
  },
  insights: {
    all: [
      { id: '1', insightType: 'content_decay', severity: 'warning', impactScore: 8, pageId: '/blog/old-post' } as any,
      { id: '2', insightType: 'ranking_opportunity', severity: 'opportunity', impactScore: 6, pageId: '/services' } as any,
    ],
    byType: {},
    bySeverity: { critical: 0, warning: 1, opportunity: 1, positive: 0 },
    topByImpact: [],
  },
  learnings: {
    summary: null,
    confidence: 'medium',
    topActionTypes: [
      { type: 'content_refreshed', winRate: 0.72, count: 10 },
      { type: 'meta_updated', winRate: 0.45, count: 8 },
    ],
    overallWinRate: 0.58,
    recentTrend: 'improving',
    playbooks: [],
  },
};

describe('formatForPrompt', () => {
  it('returns a non-empty string for empty intelligence', () => {
    const result = formatForPrompt(baseIntelligence);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
    expect(result).toContain('Limited data available');
  });

  it('includes brand voice in compact mode', () => {
    const result = formatForPrompt(richIntelligence, { verbosity: 'compact' });
    expect(result).toContain('Professional');
  });

  it('includes insight counts in standard mode', () => {
    const result = formatForPrompt(richIntelligence, { verbosity: 'standard' });
    expect(result).toContain('warning');
    expect(result).toContain('opportunity');
  });

  it('includes win rates in detailed mode', () => {
    const result = formatForPrompt(richIntelligence, { verbosity: 'detailed' });
    expect(result).toContain('content_refreshed');
    expect(result).toContain('72%');
    expect(result).toContain('10 actions');
  });

  it('omits sections for undefined slices', () => {
    const partial: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: richIntelligence.seoContext,
    };
    const result = formatForPrompt(partial, { verbosity: 'detailed' });
    expect(result).toContain('Professional');
    expect(result).not.toContain('Insights');
  });

  it('defaults to standard verbosity', () => {
    const result = formatForPrompt(richIntelligence);
    expect(result).toContain('warning');
  });

  it('includes persona pain points at standard verbosity', () => {
    const result = formatForPrompt(RICH_INTELLIGENCE, { verbosity: 'standard', sections: ['seoContext'] });
    expect(result).toContain('Proving SEO ROI');
  });

  it('includes site keyword names (not just count)', () => {
    const result = formatForPrompt(RICH_INTELLIGENCE, { verbosity: 'standard', sections: ['seoContext'] });
    expect(result).toContain('enterprise seo');
    expect(result).not.toMatch(/\d+ site keywords/);
  });

  it('includes backlinkProfile in standard mode when present', () => {
    const intel: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: {
        ...RICH_SEO_CONTEXT,
        backlinkProfile: { totalBacklinks: 3400, referringDomains: 210 },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'standard' });
    expect(result).toContain('3,400');
    expect(result).toContain('210');
    // trend not shown — BacklinksOverview API doesn't provide it
  });

  it('omits backlinkProfile in compact mode', () => {
    const intel: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: {
        ...RICH_SEO_CONTEXT,
        backlinkProfile: { totalBacklinks: 3400, referringDomains: 210 },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'compact' });
    expect(result).not.toContain('Backlinks:');
  });

  it('includes serpFeatures in standard mode', () => {
    const intel: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: {
        ...RICH_SEO_CONTEXT,
        serpFeatures: { featuredSnippets: 3, peopleAlsoAsk: 5, localPack: false },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'standard' });
    expect(result).toContain('featured snippet');
    expect(result).toContain('People Also Ask');
  });

  it('omits serpFeatures in compact mode', () => {
    const intel: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: {
        ...RICH_SEO_CONTEXT,
        serpFeatures: { featuredSnippets: 3, peopleAlsoAsk: 5, localPack: false },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'compact' });
    expect(result).not.toContain('SERP features:');
  });
});
