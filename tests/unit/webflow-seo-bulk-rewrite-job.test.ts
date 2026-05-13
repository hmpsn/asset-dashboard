import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addActivity: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  callCreativeAI: vi.fn(),
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
  buildSystemPrompt: vi.fn((_workspaceId: string, prompt: string) => prompt),
  getQueryPageData: vi.fn(),
  saveSuggestion: vi.fn(),
  resolveBaseUrl: vi.fn(),
  buildWorkspaceIntelligence: vi.fn(),
  formatKeywordsForPrompt: vi.fn(() => '\nKEYWORDS'),
  formatKnowledgeBaseForPrompt: vi.fn(() => '\nKNOWLEDGE'),
  formatPersonasForPrompt: vi.fn(() => '\nPERSONAS'),
  getBrandName: vi.fn(() => 'Studio Brand'),
  getTokenForSite: vi.fn(() => 'token_1'),
}));

vi.mock('../../server/activity-log.js', () => ({ addActivity: mocks.addActivity }));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: mocks.broadcastToWorkspace }));
vi.mock('../../server/content-posts-ai.js', () => ({ callCreativeAI: mocks.callCreativeAI }));
vi.mock('../../server/errors.js', () => ({ isProgrammingError: mocks.isProgrammingError }));
vi.mock('../../server/helpers.js', () => ({
  findPageMapEntryForPage: vi.fn(() => ({ pagePath: '/services', primaryKeyword: 'seo services' })),
  matchGscUrlToPath: vi.fn(() => false),
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
vi.mock('../../server/prompt-assembly.js', () => ({ buildSystemPrompt: mocks.buildSystemPrompt }));
vi.mock('../../server/search-console.js', () => ({ getQueryPageData: mocks.getQueryPageData }));
vi.mock('../../server/seo-suggestions.js', () => ({ saveSuggestion: mocks.saveSuggestion }));
vi.mock('../../server/url-helpers.js', () => ({ resolveBaseUrl: mocks.resolveBaseUrl }));
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: mocks.buildWorkspaceIntelligence,
  formatKeywordsForPrompt: mocks.formatKeywordsForPrompt,
  formatKnowledgeBaseForPrompt: mocks.formatKnowledgeBaseForPrompt,
  formatPersonasForPrompt: mocks.formatPersonasForPrompt,
}));
vi.mock('../../server/workspaces.js', () => ({
  getBrandName: mocks.getBrandName,
  getTokenForSite: mocks.getTokenForSite,
}));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: {
    BULK_OPERATION_COMPLETE: 'bulk:complete',
    BULK_OPERATION_FAILED: 'bulk:failed',
    BULK_OPERATION_PROGRESS: 'bulk:progress',
  },
}));

const { runSeoBulkRewriteJob } = await import('../../server/webflow-seo-bulk-rewrite-job.js');

const workspace = {
  id: 'ws_1',
  name: 'Workspace',
  liveDomain: 'example.com',
  webflowSiteId: 'site_1',
};

describe('webflow SEO bulk rewrite job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isJobCancelled.mockReturnValue(false);
    mocks.callCreativeAI.mockResolvedValue(JSON.stringify(['One improved title', 'Two improved title', 'Three improved title']));
    mocks.getQueryPageData.mockResolvedValue([]);
    mocks.resolveBaseUrl.mockResolvedValue('');
    mocks.buildWorkspaceIntelligence.mockResolvedValue({
      seoContext: {
        effectiveBrandVoiceBlock: '\nVOICE',
        personas: [],
        knowledgeBase: [],
        strategy: { pageMap: [{ pagePath: '/services', primaryKeyword: 'seo services' }] },
      },
    });
    mocks.saveSuggestion.mockImplementation((opts) => ({ id: `suggestion_${opts.pageId}_${opts.field}`, ...opts }));
  });

  it('generates single-field suggestions and records terminal success', async () => {
    const ac = new AbortController();

    await runSeoBulkRewriteJob({
      jobId: 'job_1',
      workspaceId: 'ws_1',
      siteId: 'site_1',
      pages: [{ pageId: 'page_1', title: 'Services', slug: 'services', currentSeoTitle: 'Old title' }],
      field: 'title',
      workspace,
      signal: ac.signal,
    });

    expect(mocks.callCreativeAI).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'seo-bulk-rewrite',
      json: false,
      workspaceId: 'ws_1',
    }));
    expect(mocks.saveSuggestion).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      siteId: 'site_1',
      pageId: 'page_1',
      field: 'title',
      variations: ['One improved title', 'Two improved title', 'Three improved title'],
    }));
    expect(mocks.updateJob).toHaveBeenCalledWith('job_1', expect.objectContaining({
      status: 'done',
      result: expect.objectContaining({ suggestions: 1, failed: 0, total: 1, field: 'title' }),
    }));
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'bulk:complete', expect.objectContaining({
      jobId: 'job_1',
      operation: 'bulk-rewrite',
      generated: 1,
      failed: 0,
    }));
    expect(mocks.addActivity).toHaveBeenCalledWith(
      'ws_1',
      'seo_updated',
      'Bulk SEO rewrite: 1 title variations for 1/1 pages',
      'Background job completed',
      { generated: 1, suggestions: 1, failed: 0, total: 1, field: 'title' },
    );
    expect(mocks.unregisterAbort).toHaveBeenCalledWith('job_1');
  });

  it('generates paired title and description suggestions in both mode', async () => {
    const ac = new AbortController();
    mocks.callCreativeAI.mockResolvedValueOnce(JSON.stringify([
      { title: 'First services title', description: 'First services description' },
      { title: 'Second services title', description: 'Second services description' },
      { title: 'Third services title', description: 'Third services description' },
    ]));

    await runSeoBulkRewriteJob({
      jobId: 'job_both',
      workspaceId: 'ws_1',
      siteId: 'site_1',
      pages: [{
        pageId: 'page_1',
        title: 'Services',
        slug: 'services',
        currentSeoTitle: 'Old title',
        currentDescription: 'Old description',
      }],
      field: 'both',
      workspace,
      signal: ac.signal,
    });

    expect(mocks.callCreativeAI).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'seo-bulk-rewrite-both',
      json: false,
      workspaceId: 'ws_1',
    }));
    expect(mocks.saveSuggestion).toHaveBeenCalledTimes(2);
    expect(mocks.saveSuggestion).toHaveBeenNthCalledWith(1, expect.objectContaining({
      field: 'title',
      currentValue: 'Old title',
      variations: ['First services title', 'Second services title', 'Third services title'],
    }));
    expect(mocks.saveSuggestion).toHaveBeenNthCalledWith(2, expect.objectContaining({
      field: 'description',
      currentValue: 'Old description',
      variations: ['First services description', 'Second services description', 'Third services description'],
    }));
    expect(mocks.updateJob).toHaveBeenCalledWith('job_both', expect.objectContaining({
      status: 'done',
      result: expect.objectContaining({ suggestions: 2, generatedPages: 1, failed: 0, total: 1, field: 'both' }),
    }));
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'bulk:complete', expect.objectContaining({
      generated: 1,
      suggestions: 2,
      total: 1,
      field: 'both',
    }));
  });

  it('counts per-page AI failures and still completes the job', async () => {
    const ac = new AbortController();
    mocks.callCreativeAI
      .mockResolvedValueOnce(JSON.stringify(['Good one', 'Good two', 'Good three']))
      .mockRejectedValueOnce(new Error('AI unavailable'));

    await runSeoBulkRewriteJob({
      jobId: 'job_partial',
      workspaceId: 'ws_1',
      siteId: 'site_1',
      pages: [
        { pageId: 'page_1', title: 'Services', slug: 'services', currentDescription: 'Old desc' },
        { pageId: 'page_2', title: 'About', slug: 'about', currentDescription: 'Old desc' },
      ],
      field: 'description',
      workspace,
      signal: ac.signal,
    });

    expect(mocks.saveSuggestion).toHaveBeenCalledTimes(1);
    expect(mocks.updateJob).toHaveBeenCalledWith('job_partial', expect.objectContaining({
      status: 'done',
      result: expect.objectContaining({ suggestions: 1, failed: 1, total: 2, field: 'description' }),
    }));
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'bulk:complete', expect.objectContaining({
      generated: 1,
      failed: 1,
      total: 2,
    }));
  });

  it('reports cancellation before processing pages', async () => {
    const ac = new AbortController();
    ac.abort();

    await runSeoBulkRewriteJob({
      jobId: 'job_cancel',
      workspaceId: 'ws_1',
      siteId: 'site_1',
      pages: [{ pageId: 'page_1', title: 'Services', slug: 'services' }],
      field: 'both',
      workspace,
      signal: ac.signal,
    });

    expect(mocks.callCreativeAI).not.toHaveBeenCalled();
    expect(mocks.saveSuggestion).not.toHaveBeenCalled();
    expect(mocks.updateJob).toHaveBeenCalledWith('job_cancel', expect.objectContaining({
      status: 'cancelled',
      message: 'Cancelled after 0 pages',
      result: expect.objectContaining({ suggestions: 0, failed: 0, total: 1, field: 'both' }),
    }));
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'bulk:failed', expect.objectContaining({
      jobId: 'job_cancel',
      operation: 'bulk-rewrite',
      error: 'Cancelled',
    }));
  });
});
