import { describe, it, expect } from 'vitest';
import type { ClientIntelligence, ClientInsightsSummary, ClientPipelineStatus, ClientLearningHighlights, ClientSiteHealthSummary } from '../shared/types/intelligence.js';

describe('ClientIntelligence type contract', () => {
  it('ClientIntelligence has insightsSummary and pipelineStatus for all tiers', () => {
    const intel: ClientIntelligence = {
      workspaceId: 'ws-1',
      assembledAt: new Date().toISOString(),
      tier: 'free',
      insightsSummary: null,
      pipelineStatus: null,
    };
    expect(intel).toBeDefined();
  });

  it('ClientIntelligence accepts optional tier-gated fields', () => {
    const premium: ClientIntelligence = {
      workspaceId: 'ws-1',
      assembledAt: new Date().toISOString(),
      tier: 'premium',
      insightsSummary: null,
      pipelineStatus: null,
      learningHighlights: null,
      siteHealthSummary: null,
    };
    expect(premium).toBeDefined();
  });

  it('ClientInsightsSummary has required fields', () => {
    const summary: ClientInsightsSummary = {
      total: 5,
      highPriority: 2,
      mediumPriority: 3,
      topInsights: [{ title: 'Fix title tag', type: 'page_health' }],
    };
    expect(summary.highPriority).toBe(2);
  });

  it('ClientPipelineStatus has briefs, posts, pendingApprovals', () => {
    const pipeline: ClientPipelineStatus = {
      briefs: { total: 4, inProgress: 2 },
      posts: { total: 2, inProgress: 1 },
      pendingApprovals: 3,
    };
    expect(pipeline.pendingApprovals).toBe(3);
  });

  it('ClientLearningHighlights has win rate and recent wins', () => {
    const highlights: ClientLearningHighlights = {
      overallWinRate: 0.62,
      topActionType: 'title_update',
      recentWins: 4,
    };
    expect(highlights.overallWinRate).toBe(0.62);
  });

  it('ClientSiteHealthSummary has audit score and dead links', () => {
    const health: ClientSiteHealthSummary = {
      auditScore: 87,
      auditScoreDelta: 3,
      cwvPassRatePct: 72,
      deadLinks: 1,
    };
    expect(health.deadLinks).toBe(1);
  });
});
