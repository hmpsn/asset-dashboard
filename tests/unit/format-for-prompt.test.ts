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
    effectiveBrandVoiceBlock: '\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\nProfessional, authoritative, data-driven',
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
        serpFeatures: { featuredSnippets: 3, peopleAlsoAsk: 5, localPack: false, videoCarousel: 2 },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'standard' });
    expect(result).toContain('featured snippet');
    expect(result).toContain('People Also Ask');
    expect(result).toContain('video carousel');
  });

  it('omits serpFeatures in compact mode', () => {
    const intel: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: {
        ...RICH_SEO_CONTEXT,
        serpFeatures: { featuredSnippets: 3, peopleAlsoAsk: 5, localPack: false, videoCarousel: 0 },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'compact' });
    expect(result).not.toContain('SERP features:');
  });

  // ── IG-2: topWins rendering ──────────────────────────────────────────

  it('renders topWins in standard mode', () => {
    const intel: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: richIntelligence.seoContext,
      learnings: {
        ...richIntelligence.learnings!,
        topWins: [
          {
            actionId: 'a1', actionType: 'content_refreshed', pageUrl: '/blog/seo-guide',
            targetKeyword: 'seo guide', createdAt: '2026-03-01', scoredAt: '2026-03-15',
            delta: { primary_metric: 'traffic', baseline_value: 100, current_value: 150, delta_absolute: 50, delta_percent: 50, direction: 'improved' },
            score: 'win',
          },
          {
            actionId: 'a2', actionType: 'meta_updated', pageUrl: '/services',
            targetKeyword: 'seo services', createdAt: '2026-03-02', scoredAt: '2026-03-16',
            delta: { primary_metric: 'position', baseline_value: 12, current_value: 5, delta_absolute: -7, delta_percent: -58, direction: 'improved' },
            score: 'win',
          },
        ],
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'standard' });
    expect(result).toContain('Recent wins:');
    expect(result).toContain('content refreshed');
    expect(result).toContain('/blog/seo-guide');
    expect(result).toContain('traffic');
  });

  it('omits topWins in compact mode', () => {
    const intel: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: richIntelligence.seoContext,
      learnings: {
        ...richIntelligence.learnings!,
        topWins: [
          {
            actionId: 'a1', actionType: 'content_refreshed', pageUrl: '/blog/seo-guide',
            targetKeyword: 'seo guide', createdAt: '2026-03-01', scoredAt: '2026-03-15',
            delta: { primary_metric: 'traffic', baseline_value: 100, current_value: 150, delta_absolute: 50, delta_percent: 50, direction: 'improved' },
            score: 'win',
          },
        ],
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'compact' });
    expect(result).not.toContain('Recent wins:');
  });

  // ── IG-2: suggestedBriefs rendering ──────────────────────────────────

  it('renders suggestedBriefs count in standard mode', () => {
    const intel: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: richIntelligence.seoContext,
      contentPipeline: {
        briefs: { total: 10, byStatus: { draft: 5, published: 5 } },
        posts: { total: 8, byStatus: { draft: 3, published: 5 } },
        matrices: { total: 1, cellsPlanned: 20, cellsPublished: 10 },
        requests: { pending: 2, inProgress: 1, delivered: 5 },
        workOrders: { active: 1 },
        coverageGaps: [],
        seoEdits: { pending: 3, applied: 10, inReview: 1 },
        suggestedBriefs: 7,
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'standard' });
    expect(result).toContain('Suggested briefs: 7 pending topics identified');
  });

  // ── IG-2: rewritePlaybook rendering ──────────────────────────────────

  it('renders rewritePlaybook patterns in detailed mode', () => {
    const intel: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: richIntelligence.seoContext,
      contentPipeline: {
        briefs: { total: 10, byStatus: { draft: 5, published: 5 } },
        posts: { total: 8, byStatus: { draft: 3, published: 5 } },
        matrices: { total: 1, cellsPlanned: 20, cellsPublished: 10 },
        requests: { pending: 2, inProgress: 1, delivered: 5 },
        workOrders: { active: 1 },
        coverageGaps: [],
        seoEdits: { pending: 3, applied: 10, inReview: 1 },
        rewritePlaybook: {
          patterns: ['Add FAQ sections for AEO', 'Use data-driven headers', 'Include schema markup'],
          lastUsedAt: '2026-03-20',
        },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'detailed' });
    expect(result).toContain('Rewrite playbook: 3 learned patterns');
    expect(result).toContain('Add FAQ sections for AEO');
  });

  it('omits rewritePlaybook in standard mode', () => {
    const intel: WorkspaceIntelligence = {
      ...baseIntelligence,
      seoContext: richIntelligence.seoContext,
      contentPipeline: {
        briefs: { total: 10, byStatus: { draft: 5, published: 5 } },
        posts: { total: 8, byStatus: { draft: 3, published: 5 } },
        matrices: { total: 1, cellsPlanned: 20, cellsPublished: 10 },
        requests: { pending: 2, inProgress: 1, delivered: 5 },
        workOrders: { active: 1 },
        coverageGaps: [],
        seoEdits: { pending: 3, applied: 10, inReview: 1 },
        rewritePlaybook: {
          patterns: ['Add FAQ sections for AEO'],
          lastUsedAt: '2026-03-20',
        },
      },
    };
    const result = formatForPrompt(intel, { verbosity: 'standard' });
    expect(result).not.toContain('Rewrite playbook:');
  });
});
