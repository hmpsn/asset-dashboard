import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addActivity: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  generateSeoMetadataVariations: vi.fn(),
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
  getQueryPageData: vi.fn(),
  saveSuggestion: vi.fn(),
  resolveBaseUrl: vi.fn(),
  buildPageAssistContext: vi.fn(),
  getBrandName: vi.fn(() => 'Studio Brand'),
  getTokenForSite: vi.fn(() => 'token_1'),
}));

vi.mock('../../server/activity-log.js', () => ({ addActivity: mocks.addActivity }));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: mocks.broadcastToWorkspace }));
vi.mock('../../server/domains/seo-health/seo-copy-generation.js', () => ({
  generateSeoMetadataVariations: mocks.generateSeoMetadataVariations,
}));
vi.mock('../../server/errors.js', () => ({ isProgrammingError: mocks.isProgrammingError }));
vi.mock('../../server/jobs.js', () => ({
  isJobCancelled: mocks.isJobCancelled,
  unregisterAbort: mocks.unregisterAbort,
  updateJob: mocks.updateJob,
}));
vi.mock('../../server/logger.js', () => ({ createLogger: vi.fn(() => mocks.logger) }));
vi.mock('../../server/search-console.js', () => ({ getQueryPageData: mocks.getQueryPageData }));
vi.mock('../../server/seo-suggestions.js', () => ({ saveSuggestion: mocks.saveSuggestion }));
vi.mock('../../server/url-helpers.js', () => ({ resolveBaseUrl: mocks.resolveBaseUrl }));
vi.mock('../../server/intelligence/page-assist-context-builder.js', () => ({
  buildPageAssistContext: mocks.buildPageAssistContext,
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
    mocks.generateSeoMetadataVariations.mockResolvedValue({
      variations: ['One improved title', 'Two improved title', 'Three improved title'],
    });
    mocks.getQueryPageData.mockResolvedValue([]);
    mocks.resolveBaseUrl.mockResolvedValue('');
    mocks.buildPageAssistContext.mockResolvedValue({
      seoContext: {
        strategy: { pageMap: [{ pagePath: '/seo', pageTitle: 'SEO Services', primaryKeyword: 'seo services', secondaryKeywords: [] }] },
        effectiveBrandVoiceBlock: '\nVOICE',
      },
      blocks: {
        keywordBlock: '\nKEYWORDS',
        brandVoiceBlock: '\nVOICE',
        personasBlock: '\nPERSONAS',
        knowledgeBlock: '\nKNOWLEDGE',
        pageProfileBlock: '\nPAGE PROFILE',
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
      pages: [{ pageId: 'page_1', title: 'Services', slug: 'services', publishedPath: '/services/seo', currentSeoTitle: 'Old title' }],
      field: 'title',
      workspace,
      signal: ac.signal,
    });

    expect(mocks.generateSeoMetadataVariations).toHaveBeenCalledWith(expect.objectContaining({
      adapterHint: 'background',
      workspaceId: 'ws_1',
      field: 'title',
      authority: expect.objectContaining({
        brandVoice: '\nVOICE',
        approvedEvidence: ['\nKNOWLEDGE'],
      }),
    }));
    expect(mocks.saveSuggestion).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      siteId: 'site_1',
      pageId: 'page_1',
      pageSlug: '/services/seo',
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
    mocks.generateSeoMetadataVariations.mockResolvedValueOnce({
      pairs: [
        { title: 'First services title', description: 'First services description' },
        { title: 'Second services title', description: 'Second services description' },
        { title: 'Third services title', description: 'Third services description' },
      ],
    });

    await runSeoBulkRewriteJob({
      jobId: 'job_both',
      workspaceId: 'ws_1',
      siteId: 'site_1',
      pages: [{
        pageId: 'page_1',
        title: 'Services',
        slug: 'services',
        publishedPath: '/services/seo',
        currentSeoTitle: 'Old title',
        currentDescription: 'Old description',
      }],
      field: 'both',
      workspace,
      signal: ac.signal,
    });

    expect(mocks.generateSeoMetadataVariations).toHaveBeenCalledWith(expect.objectContaining({
      adapterHint: 'background',
      workspaceId: 'ws_1',
      field: 'both',
    }));
    expect(mocks.saveSuggestion).toHaveBeenCalledTimes(2);
    expect(mocks.saveSuggestion).toHaveBeenNthCalledWith(1, expect.objectContaining({
      field: 'title',
      pageSlug: '/services/seo',
      currentValue: 'Old title',
      variations: ['First services title', 'Second services title', 'Third services title'],
    }));
    expect(mocks.saveSuggestion).toHaveBeenNthCalledWith(2, expect.objectContaining({
      field: 'description',
      pageSlug: '/services/seo',
      currentValue: 'Old description',
      variations: ['First services description', 'Second services description', 'Third services description'],
    }));
    expect(mocks.updateJob).toHaveBeenCalledWith('job_both', expect.objectContaining({
      status: 'done',
      result: expect.objectContaining({ suggestions: 2, generatedPages: 1, failed: 0, total: 1, field: 'both' }),
    }));
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'bulk:complete', expect.objectContaining({
      generated: 2,
      generatedPages: 1,
      suggestions: 2,
      total: 1,
      field: 'both',
    }));
  });

  it('counts per-page AI failures and still completes the job', async () => {
    const ac = new AbortController();
    mocks.generateSeoMetadataVariations
      .mockResolvedValueOnce({ variations: ['Good one', 'Good two', 'Good three'] })
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

  it('treats malformed canonical output as a failed page without saving a suggestion', async () => {
    const ac = new AbortController();
    mocks.generateSeoMetadataVariations.mockResolvedValueOnce(null);

    await runSeoBulkRewriteJob({
      jobId: 'job_malformed',
      workspaceId: 'ws_1',
      siteId: 'site_1',
      pages: [{ pageId: 'page_1', title: 'Services', slug: 'services', currentSeoTitle: 'Old title' }],
      field: 'title',
      workspace,
      signal: ac.signal,
    });

    expect(mocks.saveSuggestion).not.toHaveBeenCalled();
    expect(mocks.updateJob).toHaveBeenCalledWith('job_malformed', expect.objectContaining({
      status: 'error',
      result: expect.objectContaining({ suggestions: 0, generatedPages: 0, failed: 1, total: 1 }),
    }));
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'bulk:failed', expect.objectContaining({
      jobId: 'job_malformed',
      failed: 1,
      total: 1,
    }));
  });

  it('never reports terminal success when every provider call fails', async () => {
    const ac = new AbortController();
    mocks.generateSeoMetadataVariations.mockRejectedValueOnce(new Error('provider unavailable'));

    await runSeoBulkRewriteJob({
      jobId: 'job_provider_failed',
      workspaceId: 'ws_1',
      siteId: 'site_1',
      pages: [{ pageId: 'page_1', title: 'Services', slug: 'services', currentSeoTitle: 'Old title' }],
      field: 'title',
      workspace,
      signal: ac.signal,
    });

    expect(mocks.saveSuggestion).not.toHaveBeenCalled();
    expect(mocks.updateJob).toHaveBeenCalledWith('job_provider_failed', expect.objectContaining({
      status: 'error',
      result: expect.objectContaining({ suggestions: 0, generatedPages: 0, failed: 1, total: 1 }),
    }));
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws_1', 'bulk:failed', expect.objectContaining({
      jobId: 'job_provider_failed',
      failed: 1,
      total: 1,
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

    expect(mocks.generateSeoMetadataVariations).not.toHaveBeenCalled();
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
