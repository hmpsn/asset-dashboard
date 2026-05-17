import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addActivity: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  applyBulkKeywordGuards: vi.fn(),
  isProgrammingError: vi.fn(() => false),
  updateJob: vi.fn(),
  unregisterAbort: vi.fn(),
  isJobCancelled: vi.fn(() => false),
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  callAI: vi.fn(),
  getPageKeyword: vi.fn(),
  upsertPageKeyword: vi.fn(),
  resolvePersistedKeywordMetrics: vi.fn(() => ({ keywordDifficulty: undefined, monthlyVolume: undefined })),
  resolveBaseUrl: vi.fn(),
  buildWorkspaceIntelligence: vi.fn(),
  formatForPrompt: vi.fn(() => '\nFULL CONTEXT'),
  formatPageMapForPrompt: vi.fn(() => '\nKEYWORD MAP'),
  invalidateIntelligenceCache: vi.fn(),
  getTokenForSite: vi.fn(() => 'token_1'),
}));

vi.mock('../../server/activity-log.js', () => ({ addActivity: mocks.addActivity }));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: mocks.broadcastToWorkspace }));
vi.mock('../../server/errors.js', () => ({ isProgrammingError: mocks.isProgrammingError }));
vi.mock('../../server/helpers.js', () => ({
  sanitizeForPromptInjection: vi.fn((value: string) => `<untrusted_user_content>\n${value}\n</untrusted_user_content>`),
  stripCodeFences: vi.fn((value: string) => value),
  stripHtmlToText: vi.fn(() => 'Clean page copy'),
  tryResolvePagePath: vi.fn((page: { publishedPath?: string | null; slug?: string }) => page.publishedPath ?? (page.slug ? `/${page.slug}` : null)),
}));
vi.mock('../../server/jobs.js', () => ({
  isJobCancelled: mocks.isJobCancelled,
  unregisterAbort: mocks.unregisterAbort,
  updateJob: mocks.updateJob,
}));
vi.mock('../../server/logger.js', () => ({ createLogger: vi.fn(() => mocks.logger) }));
vi.mock('../../server/ai.js', () => ({ callAI: mocks.callAI }));
vi.mock('../../server/page-keywords.js', () => ({
  getPageKeyword: mocks.getPageKeyword,
  upsertPageKeyword: mocks.upsertPageKeyword,
}));
vi.mock('../../server/provider-keyword-metrics.js', () => ({
  resolvePersistedKeywordMetrics: mocks.resolvePersistedKeywordMetrics,
}));
vi.mock('../../server/url-helpers.js', () => ({ resolveBaseUrl: mocks.resolveBaseUrl }));
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: mocks.buildWorkspaceIntelligence,
  formatForPrompt: mocks.formatForPrompt,
  formatPageMapForPrompt: mocks.formatPageMapForPrompt,
  invalidateIntelligenceCache: mocks.invalidateIntelligenceCache,
}));
vi.mock('../../server/workspaces.js', () => ({ getTokenForSite: mocks.getTokenForSite }));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: {
    BULK_OPERATION_COMPLETE: 'bulk:complete',
    BULK_OPERATION_FAILED: 'bulk:failed',
    BULK_OPERATION_PROGRESS: 'bulk:progress',
    STRATEGY_UPDATED: 'strategy:updated',
  },
}));

const { runSeoBulkAnalyzeJob } = await import('../../server/webflow-seo-bulk-analyze-job.js');

const workspace = {
  id: 'ws_1',
  name: 'Workspace',
  liveDomain: 'example.com',
  webflowSiteId: 'site_1',
};

describe('webflow SEO bulk analyze job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isJobCancelled.mockReturnValue(false);
    mocks.resolveBaseUrl.mockResolvedValue('');
    mocks.buildWorkspaceIntelligence.mockResolvedValue({
      seoContext: {
        strategy: { pageMap: [] },
      },
      learnings: {},
    });
    mocks.getPageKeyword.mockReturnValue({
      pageTitle: 'Existing services page',
      primaryKeyword: 'old keyword',
      secondaryKeywords: ['old secondary'],
      currentPosition: 4,
      impressions: 123,
    });
    mocks.resolvePersistedKeywordMetrics.mockReturnValue({ keywordDifficulty: 45, monthlyVolume: 320 });
    mocks.callAI.mockResolvedValue({
      text: JSON.stringify({
        primaryKeyword: 'seo services',
        primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: true },
        secondaryKeywords: ['technical seo'],
        longTailKeywords: ['technical seo services'],
        searchIntent: 'commercial',
        searchIntentConfidence: 0.87,
        contentGaps: ['pricing'],
        competitorKeywords: ['seo agency'],
        optimizationScore: 82,
        optimizationIssues: ['Missing proof'],
        recommendations: ['Add case study'],
        estimatedDifficulty: 'medium',
        keywordDifficulty: 45,
        monthlyVolume: 320,
        topicCluster: 'SEO services',
      }),
    });
  });

  it('persists successful page analysis and records terminal success', async () => {
    const ac = new AbortController();

    await runSeoBulkAnalyzeJob({
      jobId: 'job_1',
      workspaceId: 'ws_1',
      pages: [{ pageId: 'page_1', title: 'Services', slug: 'services', seoTitle: 'Services SEO', seoDescription: 'Old meta' }],
      workspace,
      signal: ac.signal,
    });

    expect(mocks.callAI).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'bulk-page-analysis',
      responseFormat: { type: 'json_object' },
      researchMode: true,
      workspaceId: 'ws_1',
    }));
    expect(mocks.resolvePersistedKeywordMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ primaryKeyword: 'old keyword' }),
      'seo services',
      null,
    );
    expect(mocks.upsertPageKeyword).toHaveBeenCalledWith('ws_1', expect.objectContaining({
      pagePath: '/services',
      pageTitle: 'Existing services page',
      primaryKeyword: 'seo services',
      secondaryKeywords: ['technical seo'],
      keywordDifficulty: 45,
      monthlyVolume: 320,
      currentPosition: 4,
      impressions: 123,
    }));
    expect(mocks.invalidateIntelligenceCache).toHaveBeenCalledWith('ws_1');
    expect(mocks.updateJob).toHaveBeenCalledWith('job_1', expect.objectContaining({
      status: 'done',
      result: expect.objectContaining({ analyzed: 1, failed: 0, total: 1 }),
    }));
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'bulk:complete', expect.objectContaining({
      jobId: 'job_1',
      operation: 'bulk-analyze',
      analyzed: 1,
      failed: 0,
    }));
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'strategy:updated', expect.objectContaining({
      analyzed: 1,
      persisted: 1,
      source: 'seo-bulk-analyze',
    }));
    expect(mocks.addActivity).toHaveBeenCalledWith(
      'ws_1',
      'page_analysis',
      'Bulk page analysis: 1/1 pages analyzed',
      'Background job completed',
      { analyzed: 1, failed: 0, total: 1 },
    );
    expect(mocks.unregisterAbort).toHaveBeenCalledWith('job_1');
  });

  it('marks all-failed invalid AI JSON runs as an error', async () => {
    const ac = new AbortController();
    mocks.callAI.mockResolvedValueOnce({ text: 'not json' });

    await runSeoBulkAnalyzeJob({
      jobId: 'job_invalid_json',
      workspaceId: 'ws_1',
      pages: [{ pageId: 'page_1', title: 'Services', slug: 'services' }],
      workspace,
      signal: ac.signal,
    });

    expect(mocks.upsertPageKeyword).not.toHaveBeenCalled();
    expect(mocks.updateJob).toHaveBeenCalledWith('job_invalid_json', expect.objectContaining({
      status: 'error',
      message: 'Bulk analyze failed for all 1 pages',
      result: expect.objectContaining({ analyzed: 0, failed: 1, total: 1 }),
    }));
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'bulk:failed', expect.objectContaining({
      jobId: 'job_invalid_json',
      operation: 'bulk-analyze',
      error: 'Bulk analyze failed for all 1 pages',
      failed: 1,
      total: 1,
    }));
  });

  it('skips persistence for pages without a resolvable path', async () => {
    const ac = new AbortController();

    await runSeoBulkAnalyzeJob({
      jobId: 'job_pathless',
      workspaceId: 'ws_1',
      pages: [{ pageId: 'page_pathless', title: 'Pathless page' }],
      workspace,
      signal: ac.signal,
    });

    expect(mocks.getPageKeyword).not.toHaveBeenCalled();
    expect(mocks.upsertPageKeyword).not.toHaveBeenCalled();
    expect(mocks.updateJob).toHaveBeenCalledWith('job_pathless', expect.objectContaining({
      status: 'done',
      result: expect.objectContaining({ analyzed: 1, failed: 0, total: 1 }),
    }));
  });

  it('reports cancellation before processing pages', async () => {
    const ac = new AbortController();
    ac.abort();

    await runSeoBulkAnalyzeJob({
      jobId: 'job_cancel',
      workspaceId: 'ws_1',
      pages: [{ pageId: 'page_1', title: 'Services', slug: 'services' }],
      workspace,
      signal: ac.signal,
    });

    expect(mocks.callAI).not.toHaveBeenCalled();
    expect(mocks.upsertPageKeyword).not.toHaveBeenCalled();
    expect(mocks.updateJob).toHaveBeenCalledWith('job_cancel', expect.objectContaining({
      status: 'cancelled',
      message: 'Cancelled after 0 pages',
      result: expect.objectContaining({ analyzed: 0, failed: 0, total: 1 }),
    }));
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'bulk:failed', expect.objectContaining({
      jobId: 'job_cancel',
      operation: 'bulk-analyze',
      error: 'Cancelled',
    }));
    expect(mocks.unregisterAbort).toHaveBeenCalledWith('job_cancel');
  });
});
