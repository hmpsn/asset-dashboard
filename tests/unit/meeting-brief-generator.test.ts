import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockStructuredAIOutputError extends Error {
    issues: string[];

    constructor(message: string, issues: string[] = []) {
      super(message);
      this.name = 'StructuredAIOutputError';
      this.issues = issues;
    }
  }

  return {
    buildWorkspaceIntelligence: vi.fn(),
    withActiveLocalSeoSlice: vi.fn(),
    callAI: vi.fn(),
    parseStructuredAIOutput: vi.fn(),
    StructuredAIOutputError: MockStructuredAIOutputError,
    buildSystemPrompt: vi.fn(),
    getCustomPromptNotes: vi.fn(),
    getMeetingBriefHash: vi.fn(),
    upsertMeetingBrief: vi.fn(),
    broadcastToWorkspace: vi.fn(),
    wsEvents: { MEETING_BRIEF_GENERATED: 'meeting-brief:generated' },
  };
});

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: mocks.buildWorkspaceIntelligence,
}));
vi.mock('../../server/intelligence/generation-context-builders.js', () => ({
  withActiveLocalSeoSlice: mocks.withActiveLocalSeoSlice,
}));
vi.mock('../../server/ai.js', () => ({
  callAI: mocks.callAI,
}));
vi.mock('../../server/ai-structured-output.js', () => ({
  parseStructuredAIOutput: mocks.parseStructuredAIOutput,
  StructuredAIOutputError: mocks.StructuredAIOutputError,
}));
vi.mock('../../server/prompt-assembly.js', () => ({
  buildSystemPrompt: mocks.buildSystemPrompt,
  getCustomPromptNotes: mocks.getCustomPromptNotes,
}));
vi.mock('../../server/meeting-brief-store.js', () => ({
  getMeetingBriefHash: mocks.getMeetingBriefHash,
  upsertMeetingBrief: mocks.upsertMeetingBrief,
}));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: mocks.broadcastToWorkspace,
}));
vi.mock('../../server/ws-events.js', () => ({ WS_EVENTS: mocks.wsEvents }));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  assembleMeetingBriefMetrics,
  buildBriefPrompt,
  generateMeetingBrief,
} from '../../server/meeting-brief-generator.js';

function makeIntel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workspaceId: 'ws_1',
    version: 1,
    assembledAt: '2026-01-01T00:00:00.000Z',
    siteHealth: { auditScore: 81, auditScoreDelta: 5 },
    insights: {
      byType: { ranking_opportunity: [{ id: 'i1' }, { id: 'i2' }] },
      countsByType: { ranking_opportunity: 2 },
      bySeverity: { critical: 3 },
      topByImpact: [{
        id: 'top_1',
        computedAt: '2026-05-25T00:00:00.000Z',
        severity: 'high',
        insightType: 'ranking_opportunity',
        pageTitle: 'SEO Page',
        pageId: '/seo',
        data: { gap: 12 },
      }],
    },
    contentPipeline: {
      briefs: { total: 4 },
      posts: { total: 2 },
    },
    learnings: {
      overallWinRate: 0.56,
      topWins: [{ actionId: 'a1', actionType: 'content_published', pageUrl: '/seo', targetKeyword: 'seo agency', delta: { delta_percent: 12.3 }, score: 90 }],
    },
    clientSignals: { businessPriorities: ['Grow local leads'], effectiveBusinessPriorities: ['Grow local leads'] },
    seoContext: { strategy: { siteKeywords: ['seo agency', 'local seo'] } },
    localSeo: {
      enabled: true,
      effectiveLocalSeoBlock: '- Visibility up in Austin',
      markets: [{ label: 'Austin', status: 'active' }],
      visibility: { score: 70 },
      latestSnapshotAt: '2026-05-25T00:00:00.000Z',
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.withActiveLocalSeoSlice.mockResolvedValue([
    'seoContext',
    'insights',
    'learnings',
    'siteHealth',
    'contentPipeline',
    'clientSignals',
    'localSeo',
  ]);
  mocks.buildWorkspaceIntelligence.mockResolvedValue(makeIntel());
  mocks.getCustomPromptNotes.mockReturnValue(null);
  mocks.getMeetingBriefHash.mockReturnValue('different-hash');
  mocks.buildSystemPrompt.mockReturnValue('system prompt');
  mocks.callAI.mockResolvedValue({ text: '{"ok":true}' });
  mocks.parseStructuredAIOutput.mockReturnValue({
    situationSummary: 'Great momentum this month.',
    wins: ['Won top rankings'],
    attention: ['Homepage title still duplicated'],
    recommendations: [{ action: 'Refresh title', rationale: 'Lift CTR on homepage query set' }],
    blueprintProgress: null,
  });
});

describe('meeting-brief-generator', () => {
  it('assembles metrics from intelligence slices', () => {
    const metrics = assembleMeetingBriefMetrics(makeIntel() as never);

    expect(metrics).toEqual({
      siteHealthScore: 81,
      openRankingOpportunities: 2,
      contentInPipeline: 6,
      overallWinRate: 56,
      criticalIssues: 3,
    });
  });

  it('handles partial intelligence shapes in metric assembly without throwing', () => {
    const metrics = assembleMeetingBriefMetrics({
      workspaceId: 'ws_1',
      version: 1,
      assembledAt: '2026-01-01T00:00:00.000Z',
      insights: {},
      contentPipeline: {},
      learnings: {},
      siteHealth: {},
    } as never);

    expect(metrics).toEqual({
      siteHealthScore: null,
      openRankingOpportunities: 0,
      contentInPipeline: 0,
      overallWinRate: null,
      criticalIssues: 0,
    });
  });

  it('builds prompt including local SEO context and top insights/wins', () => {
    const prompt = buildBriefPrompt(makeIntel() as never);

    expect(prompt).toContain('LOCAL SEO:');
    expect(prompt).toContain('TOP INSIGHTS');
    expect(prompt).toContain('SEO Page');
    expect(prompt).toContain('Grow local leads');
    expect(prompt).toContain('56%');
    expect(prompt).toContain('Briefs in progress: 4');
    expect(prompt).toContain('Posts: 2');
  });

  it('builds prompt with safe defaults for partial pipeline/local-seo shapes', () => {
    const prompt = buildBriefPrompt(makeIntel({
      contentPipeline: {},
      localSeo: { enabled: true, effectiveLocalSeoBlock: '' },
      insights: { topByImpact: [] },
      learnings: { topWins: [] },
    }) as never);

    expect(prompt).toContain('Briefs in progress: 0');
    expect(prompt).toContain('Posts: 0');
    expect(prompt).toContain('(no open insights)');
    expect(prompt).toContain('(no tracked wins yet)');
    expect(prompt).not.toContain('LOCAL SEO:');
  });

  it('generates a brief from partial intelligence shapes without crashing', async () => {
    mocks.buildWorkspaceIntelligence.mockResolvedValue(makeIntel({
      insights: { topByImpact: [] },
      contentPipeline: {},
      learnings: {},
      siteHealth: {},
      clientSignals: {},
      seoContext: {},
      localSeo: { enabled: false },
    }));
    mocks.getMeetingBriefHash.mockReturnValue('different-hash');

    const brief = await generateMeetingBrief('ws_1');

    expect(brief.metrics).toEqual({
      siteHealthScore: null,
      openRankingOpportunities: 0,
      contentInPipeline: 0,
      overallWinRate: null,
      criticalIssues: 0,
    });
    expect(mocks.upsertMeetingBrief).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'meeting-brief:generated', {});
  });

  it('throws BRIEF_UNCHANGED when hash matches cached brief hash', async () => {
    mocks.getMeetingBriefHash.mockReturnValue('same-hash');
    mocks.callAI.mockResolvedValue({ text: '{"unused":true}' });
    mocks.parseStructuredAIOutput.mockReturnValue({
      situationSummary: 'unused',
      wins: [],
      attention: [],
      recommendations: [],
      blueprintProgress: null,
    });

    // Match computed hash by making deterministic object
    const intel = makeIntel();
    mocks.buildWorkspaceIntelligence.mockResolvedValue(intel);
    const crypto = await import('crypto');
    const relevant = {
      // P4 (G8): the rec/tier signal leads the hash object. No rec set is loaded for 'ws_1'
      // (loadRecommendations returns null), so both are null — matching buildBriefRecSignal.
      topRecommendationId: null,
      topTier: null,
      topIds: ['top_1:2026-05-25T00:00:00.000Z'],
      siteScore: 81,
      scoreDelta: 5,
      briefsTotal: 4,
      postsTotal: 2,
      winRate: 0.56,
      topWins: ['a1:90:12.3'],
      criticalIssues: 3,
      rankingOpportunities: 2,
      priorities: ['Grow local leads'],
      siteKeywords: ['seo agency', 'local seo'],
      localSeo: {
        enabled: true,
        activeMarkets: ['Austin'],
        visibility: { score: 70 },
        latestSnapshotAt: '2026-05-25T00:00:00.000Z',
        promptBlock: '- Visibility up in Austin',
      },
      customPromptNotes: null,
    };
    const hash = crypto.createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
    mocks.getMeetingBriefHash.mockReturnValue(hash);

    await expect(generateMeetingBrief('ws_1')).rejects.toThrow('BRIEF_UNCHANGED');
    expect(mocks.callAI).not.toHaveBeenCalled();
    expect(mocks.upsertMeetingBrief).not.toHaveBeenCalled();
  });

  it('retries once when structured output parsing fails initially, then succeeds', async () => {
    mocks.parseStructuredAIOutput
      .mockImplementationOnce(() => {
        throw new mocks.StructuredAIOutputError('invalid json', ['wins must be array']);
      })
      .mockReturnValueOnce({
        situationSummary: 'Retry path summary.',
        wins: ['Win A'],
        attention: ['Attention A'],
        recommendations: [{ action: 'Action A', rationale: 'Reason A' }],
        blueprintProgress: null,
      });

    const brief = await generateMeetingBrief('ws_1');

    expect(mocks.callAI).toHaveBeenCalledTimes(2);
    expect(mocks.parseStructuredAIOutput).toHaveBeenCalledTimes(2);
    expect(brief.situationSummary).toBe('Retry path summary.');
    expect(mocks.upsertMeetingBrief).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'meeting-brief:generated', {});
  });

  it('throws explicit error after retry also returns invalid structured output', async () => {
    mocks.parseStructuredAIOutput.mockImplementation(() => {
      throw new mocks.StructuredAIOutputError('still invalid', ['bad output']);
    });

    await expect(generateMeetingBrief('ws_1')).rejects.toThrow(
      'Meeting brief AI returned invalid structured output after retry',
    );
    expect(mocks.callAI).toHaveBeenCalledTimes(2);
    expect(mocks.upsertMeetingBrief).not.toHaveBeenCalled();
    expect(mocks.broadcastToWorkspace).not.toHaveBeenCalled();
  });
});
