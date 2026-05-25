import { describe, expect, it } from 'vitest';
import { buildStrategyKeywordEvaluationContext } from '../../server/keyword-strategy-context.js';
import type { ClientSignalsSlice, SeoContextSlice } from '../../shared/types/intelligence.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSeoContext(
  overrides: Partial<Pick<SeoContextSlice, 'businessContext' | 'knowledgeBase' | 'brandVoice' | 'backlinkProfile'>> = {},
): Pick<SeoContextSlice, 'businessContext' | 'knowledgeBase' | 'brandVoice' | 'backlinkProfile'> {
  return {
    businessContext: 'Emergency plumbing services in Austin, TX',
    knowledgeBase: 'Specialised in residential pipe repair',
    brandVoice: 'Reliable and fast',
    backlinkProfile: { totalBacklinks: 200, referringDomains: 30 },
    ...overrides,
  };
}

function makeClientSignals(
  overrides: Partial<ClientSignalsSlice> = {},
): ClientSignalsSlice {
  return {
    keywordFeedback: {
      approved: ['emergency plumber', 'pipe repair austin'],
      rejected: ['cheap plumber'],
      patterns: { approveRate: 0.8, topRejectionReasons: ['too generic'] },
    },
    contentGapVotes: [
      { topic: 'water heater repair', votes: 5 },
      { topic: 'drain unclogging', votes: 3 },
    ],
    businessPriorities: ['same-day service', 'licensed technicians'],
    approvalPatterns: { approvalRate: 0.75, avgResponseTime: null },
    recentChatTopics: ['burst pipe emergency', 'after-hours plumbing'],
    churnRisk: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildStrategyKeywordEvaluationContext', () => {
  it('sets workspaceId from options', () => {
    const ctx = buildStrategyKeywordEvaluationContext({ workspaceId: 'ws_abc' });
    expect(ctx.workspaceId).toBe('ws_abc');
  });

  it('includes all non-empty business terms from all sources', () => {
    const ctx = buildStrategyKeywordEvaluationContext({
      workspaceId: 'ws_1',
      workspaceName: 'Austin Plumbing Co',
      businessContext: 'Local plumbing company',
      seoContext: makeSeoContext({
        businessContext: 'Emergency plumbing services in Austin, TX',
        knowledgeBase: 'Specialised in residential pipe repair',
        brandVoice: 'Reliable and fast',
      }),
    });
    expect(ctx.businessTerms).toContain('Austin Plumbing Co');
    expect(ctx.businessTerms).toContain('Local plumbing company');
    expect(ctx.businessTerms).toContain('Emergency plumbing services in Austin, TX');
    expect(ctx.businessTerms).toContain('Specialised in residential pipe repair');
    expect(ctx.businessTerms).toContain('Reliable and fast');
    expect(ctx.businessTerms).toHaveLength(5);
  });

  it('trims whitespace from business terms and omits blank values', () => {
    const ctx = buildStrategyKeywordEvaluationContext({
      workspaceId: 'ws_2',
      workspaceName: '  Trimmed Name  ',
      businessContext: '   ',
      seoContext: makeSeoContext({ brandVoice: '', knowledgeBase: '   ' }),
    });
    // blank businessContext and blank knowledgeBase should be excluded
    expect(ctx.businessTerms).toContain('Trimmed Name');
    expect(ctx.businessTerms.some(t => t.trim() === '')).toBe(false);
  });

  it('merges client signals: businessPriorities, contentGapTopics, recentChatTopics', () => {
    const signals = makeClientSignals();
    const ctx = buildStrategyKeywordEvaluationContext({
      workspaceId: 'ws_3',
      clientSignals: signals,
    });
    expect(ctx.businessPriorities).toEqual(['same-day service', 'licensed technicians']);
    expect(ctx.contentGapTopics).toEqual(['water heater repair', 'drain unclogging']);
    expect(ctx.recentChatTopics).toEqual(['burst pipe emergency', 'after-hours plumbing']);
  });

  it('falls back to clientSignals approved keywords when approvedKeywords option is absent', () => {
    const signals = makeClientSignals();
    const ctx = buildStrategyKeywordEvaluationContext({
      workspaceId: 'ws_4',
      clientSignals: signals,
    });
    expect(ctx.approvedKeywords).toEqual(['emergency plumber', 'pipe repair austin']);
  });

  it('uses explicit approvedKeywords option over clientSignals fallback', () => {
    const signals = makeClientSignals();
    const ctx = buildStrategyKeywordEvaluationContext({
      workspaceId: 'ws_5',
      clientSignals: signals,
      approvedKeywords: ['override keyword'],
    });
    expect(ctx.approvedKeywords).toEqual(['override keyword']);
  });

  it('includes declined/requested keywords and rejection reasons from clientSignals', () => {
    const signals = makeClientSignals();
    const ctx = buildStrategyKeywordEvaluationContext({
      workspaceId: 'ws_6',
      clientSignals: signals,
      declinedKeywords: ['cheap plumber'],
      requestedKeywords: ['24 hour plumber'],
    });
    expect(ctx.declinedKeywords).toEqual(['cheap plumber']);
    expect(ctx.requestedKeywords).toEqual(['24 hour plumber']);
    expect(ctx.rejectionReasons).toEqual(['too generic']);
  });

  it('handles null/undefined seoContext and clientSignals gracefully', () => {
    const ctx = buildStrategyKeywordEvaluationContext({
      workspaceId: 'ws_7',
      seoContext: null,
      clientSignals: null,
    });
    expect(ctx.businessTerms).toHaveLength(0);
    expect(ctx.businessPriorities).toEqual([]);
    expect(ctx.contentGapTopics).toEqual([]);
    expect(ctx.recentChatTopics).toEqual([]);
    expect(ctx.approvedKeywords).toEqual([]);
    expect(ctx.rejectionReasons).toEqual([]);
    expect(ctx.backlinkProfile).toBeUndefined();
  });

  it('sets strictBusinessFit to false by default and true when explicitly set', () => {
    const ctxDefault = buildStrategyKeywordEvaluationContext({ workspaceId: 'ws_8' });
    expect(ctxDefault.strictBusinessFit).toBe(false);

    const ctxStrict = buildStrategyKeywordEvaluationContext({ workspaceId: 'ws_8b', strictBusinessFit: true });
    expect(ctxStrict.strictBusinessFit).toBe(true);
  });

  it('passes backlinkProfile from seoContext into the evaluation context', () => {
    const ctx = buildStrategyKeywordEvaluationContext({
      workspaceId: 'ws_9',
      seoContext: makeSeoContext({
        backlinkProfile: { totalBacklinks: 500, referringDomains: 60 },
      }),
    });
    expect(ctx.backlinkProfile).toEqual({ totalBacklinks: 500, referringDomains: 60 });
  });
});
