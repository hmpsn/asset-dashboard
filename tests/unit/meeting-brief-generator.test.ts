import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/workspace-intelligence.js', () => ({ buildWorkspaceIntelligence: vi.fn() }));
vi.mock('../../server/intelligence/generation-context-builders.js', () => ({ withActiveLocalSeoSlice: vi.fn() }));
vi.mock('../../server/ai.js', () => ({ callAI: vi.fn() }));
vi.mock('../../server/ai-structured-output.js', () => ({
  parseStructuredAIOutput: vi.fn(),
  StructuredAIOutputError: class StructuredAIOutputError extends Error {},
}));
vi.mock('../../server/prompt-assembly.js', () => ({
  buildSystemPrompt: vi.fn(),
  getCustomPromptNotes: vi.fn(),
}));
vi.mock('../../server/meeting-brief-store.js', () => ({
  getMeetingBriefHash: vi.fn(),
  upsertMeetingBrief: vi.fn(),
}));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: vi.fn() }));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  assembleMeetingBriefMetrics,
  buildBriefPrompt,
} from '../../server/meeting-brief-generator.js';

describe('meeting-brief-generator pure helpers', () => {
  it('assembles metrics from intelligence slices', () => {
    const metrics = assembleMeetingBriefMetrics({
      workspaceId: 'ws_1',
      version: 1,
      assembledAt: '2026-01-01T00:00:00.000Z',
      siteHealth: { auditScore: 81 },
      insights: {
        byType: { ranking_opportunity: [{ id: 'i1' }, { id: 'i2' }] },
        bySeverity: { critical: 3 },
      },
      contentPipeline: {
        briefs: { total: 4 },
        posts: { total: 2 },
      },
      learnings: { overallWinRate: 0.56 },
    } as never);

    expect(metrics).toEqual({
      siteHealthScore: 81,
      openRankingOpportunities: 2,
      contentInPipeline: 6,
      overallWinRate: 56,
      criticalIssues: 3,
    });
  });

  it('builds prompt including local SEO context and top insights/wins', () => {
    const prompt = buildBriefPrompt({
      insights: {
        topByImpact: [{ severity: 'high', insightType: 'ranking_opportunity', pageTitle: 'SEO Page', data: { gap: 12 } }],
      },
      learnings: {
        topWins: [{ actionType: 'content_published', pageUrl: '/seo', targetKeyword: 'seo agency', delta: { delta_percent: 12.3 } }],
        overallWinRate: 0.42,
      },
      siteHealth: { auditScore: 77, auditScoreDelta: 5 },
      clientSignals: { businessPriorities: ['Grow local leads'] },
      contentPipeline: { briefs: { total: 2 }, posts: { total: 1 } },
      seoContext: { strategy: { siteKeywords: ['seo agency', 'local seo'] } },
      localSeo: { enabled: true, effectiveLocalSeoBlock: '- Visibility up in Austin', markets: [], visibility: {}, latestSnapshotAt: null },
    } as never);

    expect(prompt).toContain('LOCAL SEO:');
    expect(prompt).toContain('TOP INSIGHTS');
    expect(prompt).toContain('SEO Page');
    expect(prompt).toContain('Grow local leads');
    expect(prompt).toContain('42%');
  });
});
