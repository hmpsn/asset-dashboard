import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addActivity: vi.fn(),
  debouncedPageAnalysisInvalidate: vi.fn(),
  invalidateSubCachePrefix: vi.fn(),
  parseJsonSafe: vi.fn(),
  applyBulkKeywordGuards: vi.fn(),
  getPageKeyword: vi.fn(),
  clearAnalysisFields: vi.fn(() => 0),
  countAnalyzedPages: vi.fn(() => 0),
  countPageKeywords: vi.fn(() => 0),
  listPageKeywords: vi.fn(() => []),
  upsertPageKeywordsBatch: vi.fn(),
  updateJob: vi.fn(),
  unregisterAbort: vi.fn(),
  isJobCancelled: vi.fn(() => false),
  callAI: vi.fn(),
  getConfiguredProvider: vi.fn(() => null),
  getWorkspacePages: vi.fn(),
  getWorkspace: vi.fn(() => ({ id: 'ws_1', liveDomain: 'https://example.com' })),
  resolveBaseUrl: vi.fn(),
  discoverCmsUrls: vi.fn(),
  getSiteSubdomain: vi.fn(),
  buildWorkspaceIntelligence: vi.fn(),
  formatForPrompt: vi.fn(() => ''),
  formatPageMapForPrompt: vi.fn(() => ''),
  invalidateIntelligenceCache: vi.fn(),
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../server/activity-log.js', () => ({ addActivity: mocks.addActivity }));
vi.mock('../../server/bridge-infrastructure.js', () => ({
  debouncedPageAnalysisInvalidate: mocks.debouncedPageAnalysisInvalidate,
  invalidateSubCachePrefix: mocks.invalidateSubCachePrefix,
}));
vi.mock('../../server/db/json-validation.js', () => ({ parseJsonSafe: mocks.parseJsonSafe }));
vi.mock('../../server/errors.js', () => ({ isProgrammingError: vi.fn(() => false) }));
vi.mock('../../server/helpers.js', () => ({
  applyBulkKeywordGuards: mocks.applyBulkKeywordGuards,
  decodeEntities: (text: string) => text,
  resolvePagePath: (page: { path?: string; slug?: string }) => page.path || `/${page.slug || ''}`,
  stripCodeFences: (value: string) => value,
  stripHtmlToText: (value: string) => value.replace(/<[^>]+>/g, ' ').trim(),
}));
vi.mock('../../server/jobs.js', () => ({
  updateJob: mocks.updateJob,
  unregisterAbort: mocks.unregisterAbort,
  isJobCancelled: mocks.isJobCancelled,
}));
vi.mock('../../server/logger.js', () => ({ createLogger: vi.fn(() => mocks.logger) }));
vi.mock('../../server/ai.js', () => ({ callAI: mocks.callAI }));
vi.mock('../../server/page-keywords.js', () => ({
  clearAnalysisFields: mocks.clearAnalysisFields,
  countAnalyzedPages: mocks.countAnalyzedPages,
  countPageKeywords: mocks.countPageKeywords,
  getPageKeyword: mocks.getPageKeyword,
  listPageKeywords: mocks.listPageKeywords,
  upsertPageKeywordsBatch: mocks.upsertPageKeywordsBatch,
}));
vi.mock('../../server/seo-data-provider.js', () => ({
  getConfiguredProvider: mocks.getConfiguredProvider,
  getProviderDisplayName: vi.fn(() => 'Provider'),
}));
vi.mock('../../server/url-helpers.js', () => ({ resolveBaseUrl: mocks.resolveBaseUrl }));
vi.mock('../../server/webflow.js', () => ({
  buildStaticPathSet: vi.fn(() => new Set()),
  discoverCmsUrls: mocks.discoverCmsUrls,
  getSiteSubdomain: mocks.getSiteSubdomain,
  toCmsPageId: (path: string) => `cms:${path}`,
}));
vi.mock('../../server/workspace-data.js', () => ({ getWorkspacePages: mocks.getWorkspacePages }));
vi.mock('../../server/workspaces.js', () => ({ getWorkspace: mocks.getWorkspace }));
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: mocks.buildWorkspaceIntelligence,
  formatForPrompt: mocks.formatForPrompt,
  formatPageMapForPrompt: mocks.formatPageMapForPrompt,
  invalidateIntelligenceCache: mocks.invalidateIntelligenceCache,
}));

const { runPageAnalysisJob } = await import('../../server/page-analysis-job.js');

describe('page-analysis job hardening', () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPageKeyword.mockReturnValue(undefined);
    mocks.getWorkspacePages.mockResolvedValue([]);
    mocks.resolveBaseUrl.mockResolvedValue(null);
    mocks.discoverCmsUrls.mockResolvedValue({ cmsUrls: [] });
    mocks.getSiteSubdomain.mockResolvedValue(null);
    mocks.buildWorkspaceIntelligence.mockResolvedValue({ seoContext: {} });
    mocks.callAI.mockResolvedValue({ text: '{}' });
    mocks.getConfiguredProvider.mockReturnValue(null);
    mocks.parseJsonSafe.mockReturnValue({
      primaryKeyword: 'home service',
      secondaryKeywords: [],
      optimizationIssues: [],
      recommendations: [],
      contentGaps: [],
      optimizationScore: 80,
      primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: false },
      longTailKeywords: [],
      competitorKeywords: [],
      estimatedDifficulty: 'medium',
      keywordDifficulty: 40,
      monthlyVolume: 100,
      topicCluster: 'services',
      searchIntent: 'commercial',
      searchIntentConfidence: 0.9,
    });
    process.env.OPENAI_API_KEY = 'test-openai-key';
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    globalThis.fetch = originalFetch;
  });

  it('finishes with a clear message when no pages are discovered', async () => {
    await runPageAnalysisJob({ jobId: 'job_empty', siteId: 'site_1', workspaceId: 'ws_1' });

    expect(mocks.updateJob).toHaveBeenCalledWith('job_empty', expect.objectContaining({
      status: 'done',
      message: 'No pages were discovered for analysis. Sync Webflow pages or check the site connection.',
      result: expect.objectContaining({ analyzed: 0, skipped: 0, skippedFetch: 0, failed: 0, total: 0 }),
    }));
    expect(mocks.callAI).not.toHaveBeenCalled();
  });

  it('finishes with result counters when all discovered pages are already analyzed', async () => {
    mocks.getWorkspacePages.mockResolvedValue([{ id: 'page_1', title: 'Home', slug: '', path: '/', seo: {} }]);
    mocks.getPageKeyword.mockReturnValue({ optimizationScore: 88 });

    await runPageAnalysisJob({ jobId: 'job_done', siteId: 'site_1', workspaceId: 'ws_1' });

    expect(mocks.updateJob).toHaveBeenCalledWith('job_done', expect.objectContaining({
      status: 'done',
      message: 'All 1 pages already analyzed',
      result: expect.objectContaining({ analyzed: 0, skipped: 1, skippedFetch: 0, failed: 0, total: 1 }),
    }));
    expect(mocks.callAI).not.toHaveBeenCalled();
  });

  it('sets a user-facing terminal message when OpenAI is not configured', async () => {
    delete process.env.OPENAI_API_KEY;
    mocks.getWorkspacePages.mockResolvedValue([{ id: 'page_1', title: 'Home', slug: '', path: '/', seo: {} }]);

    await runPageAnalysisJob({ jobId: 'job_no_key', siteId: 'site_1', workspaceId: 'ws_1' });

    expect(mocks.updateJob).toHaveBeenCalledWith('job_no_key', expect.objectContaining({
      status: 'error',
      error: 'OPENAI_API_KEY not configured',
      message: 'Page analysis needs an OpenAI API key before it can run.',
      result: expect.objectContaining({ analyzed: 0, skipped: 0, skippedFetch: 0, failed: 0, total: 1 }),
    }));
    expect(mocks.callAI).not.toHaveBeenCalled();
  });

  it('skips AI analysis when all page HTML fetch attempts fail', async () => {
    mocks.getWorkspacePages.mockResolvedValue([{ id: 'page_1', title: 'Home', slug: '', path: '/', seo: {} }]);
    mocks.resolveBaseUrl.mockResolvedValue('https://example.com');
    mocks.getSiteSubdomain.mockResolvedValue('example-site');
    globalThis.fetch = vi.fn(async () => ({ ok: false, text: async () => '' })) as typeof fetch;

    await runPageAnalysisJob({ jobId: 'job_fetch_fail', siteId: 'site_1', workspaceId: 'ws_1' });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.callAI).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ page: '/' }),
      'Page analysis skipped because no usable HTML content was available',
    );
    expect(mocks.updateJob).toHaveBeenCalledWith('job_fetch_fail', expect.objectContaining({
      status: 'done',
      message: 'Done — 0/1 pages analyzed (1 skipped)',
      result: expect.objectContaining({ analyzed: 0, skipped: 1, skippedFetch: 1, failed: 0, total: 1 }),
    }));
  });

  it('uses the canonical nested page path in the AI prompt', async () => {
    mocks.getWorkspacePages.mockResolvedValue([{ id: 'page_1', title: 'Invisalign', slug: 'invisalign', path: '/services/invisalign', seo: {} }]);
    mocks.resolveBaseUrl.mockResolvedValue('https://example.com');
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => '<html><title>Invisalign</title><main>Service page</main></html>' })) as typeof fetch;

    await runPageAnalysisJob({ jobId: 'job_nested_path', siteId: 'site_1', workspaceId: 'ws_1' });

    const prompt = mocks.callAI.mock.calls[0]?.[0]?.messages?.[0]?.content ?? '';
    expect(prompt).toContain('URL path: /services/invisalign');
    expect(prompt).not.toContain('URL slug: /invisalign');
  });

  it('counts AI failures as skipped in the terminal result', async () => {
    mocks.getWorkspacePages.mockResolvedValue([{ id: 'page_1', title: 'Home', slug: '', path: '/', seo: {} }]);
    mocks.resolveBaseUrl.mockResolvedValue('https://example.com');
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => '<html><title>Home</title><main>Service page</main></html>' })) as typeof fetch;
    mocks.callAI.mockRejectedValue(new Error('AI unavailable'));

    await runPageAnalysisJob({ jobId: 'job_ai_fail', siteId: 'site_1', workspaceId: 'ws_1' });

    expect(mocks.updateJob).toHaveBeenCalledWith('job_ai_fail', expect.objectContaining({
      status: 'done',
      message: 'Done — 0/1 pages analyzed (1 skipped)',
      result: expect.objectContaining({ analyzed: 0, skipped: 1, skippedFetch: 0, failed: 1, total: 1 }),
    }));
  });

  it('includes counters on cancelled terminal jobs', async () => {
    mocks.getWorkspacePages.mockResolvedValue([{ id: 'page_1', title: 'Home', slug: '', path: '/', seo: {} }]);
    mocks.resolveBaseUrl.mockResolvedValue('https://example.com');
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => '<html><title>Home</title><main>Service page</main></html>' })) as typeof fetch;
    mocks.isJobCancelled
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    await runPageAnalysisJob({ jobId: 'job_cancelled', siteId: 'site_1', workspaceId: 'ws_1' });

    expect(mocks.upsertPageKeywordsBatch).toHaveBeenCalled();
    expect(mocks.updateJob).toHaveBeenCalledWith('job_cancelled', expect.objectContaining({
      status: 'cancelled',
      message: 'Cancelled — 1 of 1 pages analyzed',
      result: expect.objectContaining({ analyzed: 1, skipped: 0, skippedFetch: 0, failed: 0, total: 1 }),
    }));
  });

  it('zeros AI-invented keyword metrics in bulk page analysis when provider has no exact match', async () => {
    const provider = { name: 'mock', getKeywordMetrics: vi.fn().mockResolvedValue([]) };
    mocks.getConfiguredProvider.mockReturnValue(provider);
    mocks.getPageKeyword.mockReturnValue({
      pagePath: '/',
      pageTitle: 'Home',
      primaryKeyword: 'old verified keyword',
      secondaryKeywords: [],
      keywordDifficulty: 99,
      monthlyVolume: 9999,
    });
    mocks.getWorkspacePages.mockResolvedValue([{ id: 'page_1', title: 'Home', slug: '', path: '/', seo: {} }]);
    mocks.resolveBaseUrl.mockResolvedValue('https://example.com');
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => '<html><title>Home</title><main>Service page</main></html>' })) as typeof fetch;
    mocks.parseJsonSafe.mockReturnValue({
      primaryKeyword: 'invented keyword',
      secondaryKeywords: [],
      optimizationIssues: [],
      recommendations: [],
      contentGaps: [],
      optimizationScore: 80,
      primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: false },
      longTailKeywords: [],
      competitorKeywords: [],
      estimatedDifficulty: 'high',
      keywordDifficulty: 99,
      monthlyVolume: 9999,
      topicCluster: 'services',
      searchIntent: 'commercial',
      searchIntentConfidence: 0.9,
    });

    await runPageAnalysisJob({ jobId: 'job_zero_metrics', siteId: 'site_1', workspaceId: 'ws_1' });

    expect(mocks.upsertPageKeywordsBatch).toHaveBeenCalledWith('ws_1', [
      expect.objectContaining({
        primaryKeyword: 'invented keyword',
        keywordDifficulty: undefined,
        monthlyVolume: undefined,
      }),
    ]);
  });

  it('preserves existing metrics for the same keyword when provider lookup misses in bulk page analysis', async () => {
    const provider = { name: 'mock', getKeywordMetrics: vi.fn().mockResolvedValue([]) };
    mocks.getConfiguredProvider.mockReturnValue(provider);
    mocks.getPageKeyword.mockReturnValue({
      pagePath: '/',
      pageTitle: 'Home',
      primaryKeyword: 'home service',
      secondaryKeywords: [],
      keywordDifficulty: 44,
      monthlyVolume: 1200,
    });
    mocks.getWorkspacePages.mockResolvedValue([{ id: 'page_1', title: 'Home', slug: '', path: '/', seo: {} }]);
    mocks.resolveBaseUrl.mockResolvedValue('https://example.com');
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => '<html><title>Home</title><main>Service page</main></html>' })) as typeof fetch;

    await runPageAnalysisJob({ jobId: 'job_preserve_metrics', siteId: 'site_1', workspaceId: 'ws_1' });

    expect(mocks.upsertPageKeywordsBatch).toHaveBeenCalledWith('ws_1', [
      expect.objectContaining({
        primaryKeyword: 'home service',
        keywordDifficulty: 44,
        monthlyVolume: 1200,
      }),
    ]);
  });

  it('uses exact provider keyword metrics in bulk page analysis when available', async () => {
    const provider = {
      name: 'mock',
      getKeywordMetrics: vi.fn().mockResolvedValue([
        { keyword: 'home service', difficulty: 37, volume: 420, cpc: 1, competition: 0.2, results: 0, trend: [] },
      ]),
    };
    mocks.getConfiguredProvider.mockReturnValue(provider);
    mocks.getWorkspacePages.mockResolvedValue([{ id: 'page_1', title: 'Home', slug: '', path: '/', seo: {} }]);
    mocks.resolveBaseUrl.mockResolvedValue('https://example.com');
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => '<html><title>Home</title><main>Service page</main></html>' })) as typeof fetch;

    await runPageAnalysisJob({ jobId: 'job_provider_metrics', siteId: 'site_1', workspaceId: 'ws_1' });

    expect(mocks.upsertPageKeywordsBatch).toHaveBeenCalledWith('ws_1', [
      expect.objectContaining({
        primaryKeyword: 'home service',
        keywordDifficulty: 37,
        monthlyVolume: 420,
      }),
    ]);
  });
});
