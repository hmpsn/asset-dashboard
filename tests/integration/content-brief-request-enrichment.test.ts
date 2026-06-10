/**
 * C1 — Request-driven brief enrichment parity (audit #3)
 *
 * Verifies that generateBriefForRequest gets the same scraping enrichment
 * (scrapedReferences, serpData, styleExamples) and outcome recording that
 * the standalone path already has.
 *
 * Tests use in-process DB (no HTTP server) and mocked scraper/outcome modules.
 *
 * Port: n/a — direct function calls only.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ── Module-level mocks (hoisted by Vitest) ──────────────────────────────────

import {
  setupOpenAIMocks,
  mockOpenAIJsonResponse,
  resetOpenAIMocks,
} from '../mocks/openai.js';

setupOpenAIMocks();

vi.mock('../../server/intelligence/generation-context-builders.js', () => ({
  buildContentGenerationContext: vi.fn(),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  formatForPrompt: vi.fn(() => ''),
  formatKeywordsForPrompt: vi.fn(() => ''),
  formatPersonasForPrompt: vi.fn(() => ''),
  formatPageMapForPrompt: vi.fn(() => ''),
  formatKnowledgeBaseForPrompt: vi.fn(() => ''),
  invalidateIntelligenceCache: vi.fn(),
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/intelligence-freshness.js', () => ({
  invalidateContentPipelineIntelligence: vi.fn(),
}));

vi.mock('../../server/content-decay.js', () => ({
  loadDecayAnalysis: vi.fn(() => null),
}));

vi.mock('../../server/google-analytics.js', () => ({
  getGA4LandingPages: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../server/search-console.js', () => ({
  getQueryPageData: vi.fn().mockResolvedValue([]),
  getSearchOverview: vi.fn().mockResolvedValue({ topQueries: [] }),
}));

vi.mock('../../server/seo-data-provider.js', () => ({
  getConfiguredProvider: vi.fn(() => null),
  getProviderDisplayName: vi.fn(() => 'DataForSEO'),
}));

vi.mock('../../server/local-seo.js', () => ({
  resolveWorkspaceLocationCode: vi.fn(() => null),
}));

vi.mock('../../server/content-site-pages.js', () => ({
  getAllSitePages: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../server/content-brief-template-crossref.js', () => ({
  resolveBriefTemplateCrossref: vi.fn(() => null),
  toBriefPageType: vi.fn(() => undefined),
}));

// Scraper mock — hoisted so vi.mock factory can reference it
const { mockScrapeUrls, mockScrapeSerpData, mockBuildReferenceContext, mockBuildSerpContext, mockBuildStyleExampleContext } = vi.hoisted(() => ({
  mockScrapeUrls: vi.fn(),
  mockScrapeSerpData: vi.fn(),
  mockBuildReferenceContext: vi.fn(() => ''),
  mockBuildSerpContext: vi.fn(() => ''),
  mockBuildStyleExampleContext: vi.fn(() => ''),
}));

vi.mock('../../server/web-scraper.js', () => ({
  scrapeUrls: mockScrapeUrls,
  scrapeSerpData: mockScrapeSerpData,
  buildReferenceContext: mockBuildReferenceContext,
  buildSerpContext: mockBuildSerpContext,
  buildStyleExampleContext: mockBuildStyleExampleContext,
}));

// outcome-tracking mock — hoisted
const { mockRecordAction } = vi.hoisted(() => ({
  mockRecordAction: vi.fn(),
}));
vi.mock('../../server/outcome-tracking.js', () => ({
  recordAction: mockRecordAction,
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import db from '../../server/db/index.js';
import { createContentRequest } from '../../server/content-requests.js';
import {
  runContentBriefGenerationJob,
  type RequestContentBriefGenerationParams,
  type StandaloneContentBriefGenerationParams,
} from '../../server/content-brief-generation-job.js';
import { createJob } from '../../server/jobs.js';
import { buildContentGenerationContext } from '../../server/intelligence/generation-context-builders.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_WS_ID = `ws_c1_enrichment_${Date.now()}`;

const MOCK_SCRAPED_PAGE = {
  url: 'https://example.com/ref-page',
  title: 'Reference Page',
  metaDescription: 'A reference page for testing',
  headings: [{ level: 1, text: 'Main Heading' }],
  bodyText: 'Body text for testing enrichment.',
  wordCount: 100,
  fetchedAt: new Date().toISOString(),
};

const MOCK_SERP_DATA = {
  query: 'test keyword',
  peopleAlsoAsk: ['What is test keyword?', 'How to use test keyword?'],
  organicResults: [
    { position: 1, title: 'Top Result', url: 'https://top.example.com', snippet: 'Top result snippet' },
  ],
  fetchedAt: new Date().toISOString(),
};

function makeMockBriefResponse() {
  return {
    executiveSummary: 'Test summary',
    suggestedTitle: 'Test Brief Title',
    suggestedMetaDesc: 'Test meta description',
    secondaryKeywords: ['related keyword'],
    contentFormat: 'guide',
    toneAndStyle: 'professional',
    outline: [{ heading: 'Section 1', notes: 'First section notes', wordCount: 300 }],
    wordCountTarget: 1200,
    intent: 'informational',
    audience: 'Test audience',
    internalLinkSuggestions: [],
    ctaRecommendations: [],
    topicalEntities: [],
    schemaRecommendations: [],
    contentChecklist: [],
  };
}

// ── Setup / Teardown ────────────────────────────────────────────────────────

beforeAll(() => {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, tier, created_at)
     VALUES (?, ?, ?, 'growth', ?)`,
  ).run(TEST_WS_ID, 'C1 Enrichment Test WS', 'c1-enrichment-test', new Date().toISOString());
  process.env.OPENAI_API_KEY = 'test-key-c1-enrichment';
});

afterAll(() => {
  db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(TEST_WS_ID);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(TEST_WS_ID);
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(TEST_WS_ID);
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(TEST_WS_ID);
  delete process.env.OPENAI_API_KEY;
});

beforeEach(() => {
  resetOpenAIMocks();
  mockRecordAction.mockReset();
  mockScrapeUrls.mockReset();
  mockScrapeSerpData.mockReset();

  // Default: scraper returns fixture data
  mockScrapeUrls.mockResolvedValue([MOCK_SCRAPED_PAGE]);
  mockScrapeSerpData.mockResolvedValue(MOCK_SERP_DATA);

  // Default: recordAction returns a minimal TrackedAction
  mockRecordAction.mockReturnValue({ id: 'action-test', workspaceId: TEST_WS_ID });

  vi.mocked(buildContentGenerationContext).mockImplementation(async (_workspaceId, opts = {}) => ({
    intelligence: {
      version: 1,
      workspaceId: TEST_WS_ID,
      assembledAt: new Date().toISOString(),
      seoContext: {
        strategy: { siteKeywords: [], businessContext: 'Test business', pageMap: [] },
        brandVoice: '',
        effectiveBrandVoiceBlock: '',
        knowledgeBase: '',
        businessContext: '',
        personas: null,
        pageKeywords: null,
      },
      pageProfile: null,
    },
    slices: opts.slices ?? ['seoContext'],
    promptContext: '',
    pagePath: opts.pagePath,
    learningsDomain: opts.learningsDomain ?? 'content',
    learningsAvailability: 'not_requested',
  }));

  mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest() {
  return createContentRequest(TEST_WS_ID, {
    topic: 'Test Topic',
    targetKeyword: 'test keyword for c1',
    intent: 'informational',
    priority: 'medium',
    rationale: 'C1 enrichment test',
    source: 'client',
    serviceType: 'brief_only',
    pageType: 'blog',
    // Note: ContentTopicRequest does not carry referenceUrls (no DB column).
    // The request path scrapes SERP + GA4 style-pages but not per-request ref URLs.
  });
}

async function runRequestJob(requestId: string) {
  const job = createJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION, {
    workspaceId: TEST_WS_ID,
    total: 1,
    message: 'Test job',
  });
  const params: RequestContentBriefGenerationParams = {
    source: 'request',
    workspaceId: TEST_WS_ID,
    requestId,
  };
  await runContentBriefGenerationJob(job.id, params);
  return job;
}

async function runStandaloneJob() {
  const job = createJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION, {
    workspaceId: TEST_WS_ID,
    total: 1,
    message: 'Test standalone job',
  });
  const params: StandaloneContentBriefGenerationParams = {
    source: 'standalone',
    workspaceId: TEST_WS_ID,
    targetKeyword: 'standalone test keyword',
    referenceUrls: ['https://example.com/ref-page'],
  };
  await runContentBriefGenerationJob(job.id, params);
  return job;
}

// ── Test Suites ──────────────────────────────────────────────────────────────

describe('C1: request-driven brief — scraping parity', () => {
  it('calls scrapeSerpData for the target keyword', async () => {
    // Note: the request path uses SERP scraping but not per-request reference URL scraping
    // (content_requests has no reference_urls column — that's a standalone-path feature).
    const request = makeRequest();
    await runRequestJob(request.id);

    expect(mockScrapeSerpData).toHaveBeenCalledWith('test keyword for c1');
  });

  it('brief result is stored with realPeopleAlsoAsk populated when scraper succeeds', async () => {
    const request = makeRequest();
    const job = await runRequestJob(request.id);

    // Job should be done
    const storedJob = db.prepare('SELECT result FROM jobs WHERE id = ?').get(job.id) as { result: string } | undefined;
    expect(storedJob).toBeDefined();
    const result = JSON.parse(storedJob!.result ?? '{}');
    const brief = result.brief;
    expect(brief).toBeDefined();

    // The brief should carry SERP data from scrapeSerpData — persisted as realPeopleAlsoAsk
    // MOCK_SERP_DATA has 2 PAA entries and 1 organic result
    expect(brief.realPeopleAlsoAsk).toBeDefined();
    expect(brief.realPeopleAlsoAsk.length).toBeGreaterThan(0);
    expect(brief.realTopResults).toBeDefined();
    expect(brief.realTopResults.length).toBeGreaterThan(0);
  });
});

describe('C1: request-driven brief — outcome recording', () => {
  it('records a brief_created action with sourceType content_request', async () => {
    const request = makeRequest();
    const job = await runRequestJob(request.id);

    // Job must complete
    const storedJob = db.prepare('SELECT result FROM jobs WHERE id = ?').get(job.id) as { result: string } | undefined;
    const result = JSON.parse(storedJob?.result ?? '{}');
    expect(result.brief).toBeDefined();

    // recordAction should have been called with the request sourceType
    expect(mockRecordAction).toHaveBeenCalled();
    const recordCalls: unknown[][] = mockRecordAction.mock.calls;
    const briefCreatedCall = recordCalls.find((args: unknown[]) => {
      const params = args[0] as Record<string, unknown>;
      return params.actionType === 'brief_created' && params.sourceType === 'content_request';
    });
    expect(briefCreatedCall).toBeDefined();

    const callParams = briefCreatedCall![0] as Record<string, unknown>;
    expect(callParams.workspaceId).toBe(TEST_WS_ID);
    expect(callParams.targetKeyword).toBe('test keyword for c1');
    expect(callParams.attribution).toBe('platform_executed');
    // sourceId should be the brief ID
    expect(typeof callParams.sourceId).toBe('string');
    expect((callParams.sourceId as string).startsWith('brief_')).toBe(true);
  });

  it('records action with brief ID as sourceId', async () => {
    const request = makeRequest();
    const job = await runRequestJob(request.id);

    const storedJob = db.prepare('SELECT result FROM jobs WHERE id = ?').get(job.id) as { result: string } | undefined;
    const result = JSON.parse(storedJob?.result ?? '{}');
    const briefId = result.brief?.id;
    expect(briefId).toBeDefined();

    const recordCalls: unknown[][] = mockRecordAction.mock.calls;
    const call = recordCalls.find((args: unknown[]) => {
      const p = args[0] as Record<string, unknown>;
      return p.sourceType === 'content_request' && p.sourceId === briefId;
    });
    expect(call).toBeDefined();
  });
});

describe('C1: FM-2 — scraper failure degrades gracefully', () => {
  it('brief still generates when scrapeUrls throws', async () => {
    mockScrapeUrls.mockRejectedValue(new Error('Scraper network error'));
    mockScrapeSerpData.mockRejectedValue(new Error('SERP scraper network error'));

    const request = makeRequest();
    const job = await runRequestJob(request.id);

    // Job should be DONE (not error)
    const storedJob = db.prepare('SELECT status, result FROM jobs WHERE id = ?').get(job.id) as { status: string; result: string } | undefined;
    expect(storedJob?.status).toBe('done');

    // Brief should be created
    const result = JSON.parse(storedJob?.result ?? '{}');
    expect(result.brief).toBeDefined();
    expect(result.brief.suggestedTitle).toBe('Test Brief Title');
  });

  it('scrapedReferences is empty/undefined when scraper throws (no fake success)', async () => {
    mockScrapeUrls.mockRejectedValue(new Error('Network error'));
    mockScrapeSerpData.mockRejectedValue(new Error('SERP error'));

    const request = makeRequest();
    const job = await runRequestJob(request.id);

    const storedJob = db.prepare('SELECT result FROM jobs WHERE id = ?').get(job.id) as { result: string } | undefined;
    const result = JSON.parse(storedJob?.result ?? '{}');
    const brief = result.brief;
    expect(brief).toBeDefined();

    // Fields should be absent or empty — not fake-populated
    const hasNoFakeData =
      !brief.scrapedReferences?.length &&
      !brief.serpData &&
      !brief.realPeopleAlsoAsk?.length;
    expect(hasNoFakeData).toBe(true);
  });

  it('scrapeSerpData returning null degrades gracefully (not a crash)', async () => {
    mockScrapeSerpData.mockResolvedValue(null);

    const request = makeRequest();
    const job = await runRequestJob(request.id);

    const storedJob = db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as { status: string } | undefined;
    expect(storedJob?.status).toBe('done');
  });
});

describe('C1: FM-2 — recordAction failure does not crash the job', () => {
  it('job completes when recordAction throws', async () => {
    mockRecordAction.mockImplementation(() => {
      throw new Error('DB write failed');
    });

    const request = makeRequest();
    const job = await runRequestJob(request.id);

    // Job must still complete with 'done'
    const storedJob = db.prepare('SELECT status, result FROM jobs WHERE id = ?').get(job.id) as { status: string; result: string } | undefined;
    expect(storedJob?.status).toBe('done');

    // Brief should still be in the result
    const result = JSON.parse(storedJob?.result ?? '{}');
    expect(result.brief).toBeDefined();
  });
});

describe('C1: parity check — standalone path behavior unchanged', () => {
  it('standalone path still calls scrapeUrls and scrapeSerpData', async () => {
    const job = await runStandaloneJob();

    const storedJob = db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as { status: string } | undefined;
    expect(storedJob?.status).toBe('done');

    expect(mockScrapeUrls).toHaveBeenCalled();
    expect(mockScrapeSerpData).toHaveBeenCalledWith('standalone test keyword');
  });

  it('standalone path records a brief_created action with sourceType brief', async () => {
    const job = await runStandaloneJob();

    const storedJob = db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as { status: string } | undefined;
    expect(storedJob?.status).toBe('done');

    const recordCalls: unknown[][] = mockRecordAction.mock.calls;
    const standaloneCall = recordCalls.find((args: unknown[]) => {
      const p = args[0] as Record<string, unknown>;
      return p.actionType === 'brief_created' && p.sourceType === 'brief';
    });
    expect(standaloneCall).toBeDefined();
  });

  it('FM-2: standalone job completes when reference-URL scraping throws (degrades, no longer fails the job)', async () => {
    // runStandaloneJob passes referenceUrls, so the scrapeUrls branch is
    // genuinely exercised — this rejection previously propagated through
    // Promise.all and failed the whole job; the shared helper degrades it.
    mockScrapeUrls.mockRejectedValue(new Error('Reference scrape network error'));

    const job = await runStandaloneJob();

    expect(mockScrapeUrls).toHaveBeenCalled();
    const storedJob = db.prepare('SELECT status, result FROM jobs WHERE id = ?').get(job.id) as { status: string; result: string } | undefined;
    expect(storedJob?.status).toBe('done');
    const result = JSON.parse(storedJob?.result ?? '{}');
    expect(result.brief).toBeDefined();
    expect(result.brief.scrapedReferences?.length ?? 0).toBe(0);
  });
});

describe('C1: deriveStylePageUrls — liveDomain protocol handling (review fix)', () => {
  const PAGES = [
    { landingPage: '/great-page', sessions: 100, avgEngagementTime: 60 },
    { landingPage: '/ok-page', sessions: 50, avgEngagementTime: 45 },
    { landingPage: '/thin-page', sessions: 5, avgEngagementTime: 10 },
  ];

  it('strips an existing protocol from liveDomain (no https://https:// double prefix)', async () => {
    const { deriveStylePageUrls } = await import('../../server/content-brief-scrape-enrichment.js');
    const urls = deriveStylePageUrls(PAGES, 'https://example.com');
    expect(urls).toEqual(['https://example.com/great-page', 'https://example.com/ok-page']);
  });

  it('handles a bare domain and trailing slashes', async () => {
    const { deriveStylePageUrls } = await import('../../server/content-brief-scrape-enrichment.js');
    expect(deriveStylePageUrls(PAGES, 'example.com/')).toEqual([
      'https://example.com/great-page',
      'https://example.com/ok-page',
    ]);
  });

  it('returns [] for missing liveDomain and filters thin pages', async () => {
    const { deriveStylePageUrls } = await import('../../server/content-brief-scrape-enrichment.js');
    expect(deriveStylePageUrls(PAGES, undefined)).toEqual([]);
    expect(deriveStylePageUrls(PAGES, 'example.com').some(u => u.includes('thin-page'))).toBe(false);
  });
});
