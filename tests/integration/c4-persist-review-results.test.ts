/**
 * C4 — Persist AI review verdicts + scraped source text (audit #16)
 *
 * Covers:
 *  1. AI review run persists verdicts on the post — retrievable via a fresh
 *     admin GET (the "editor close" survival path), with provenance-sensitive
 *     keys stored pass=false + humanReviewRequired even when the model tried pass=true.
 *  2. FM-2: schema-invalid AI response → 500, nothing persisted.
 *  3. Brief generation job persists scraped source text (bodyText, SERP snippets,
 *     fetchedAt) on the brief row — both standalone and request paths.
 *  4. FM-2 (C1 degradation): scraper total failure → brief persists with no
 *     sourceEvidence, job still succeeds.
 *  5. Schema-vs-stored-shape: stored blobs with omitted optional fields parse
 *     to real data, not the fallback.
 *  6. Public boundary: client brief/post GETs omit sourceEvidence/aiReview.
 *
 * Architecture note: uses createApp() + http.Server in-process (not
 * createEphemeralTestContext, which spawns a child process) so that vi.mock can
 * intercept the AI dispatch and web-scraper — same documented pattern as
 * tests/integration/content-posts-ai-fix.test.ts (sibling route family) and
 * tests/integration/content-brief-request-enrichment.test.ts (C1's own test).
 *
 * Port: n/a — ephemeral in-process listener on port 0.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Module-level mocks (hoisted by Vitest) ────────────────────────────────────
import {
  setupOpenAIMocks,
  mockOpenAIJsonResponse,
  resetOpenAIMocks,
} from '../mocks/openai.js';

setupOpenAIMocks();

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/workspace-intelligence.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/workspace-intelligence.js')>();
  return {
    ...actual,
    buildIntelPrompt: vi.fn(async () => ''),
  };
});

vi.mock('../../server/intelligence/generation-context-builders.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/intelligence/generation-context-builders.js')>();
  return {
    ...actual,
    buildContentGenerationContext: vi.fn(),
  };
});

vi.mock('../../server/seo-data-provider.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/seo-data-provider.js')>();
  return {
    ...actual,
    getConfiguredProvider: vi.fn(() => null),
  };
});

// Scraper mock — hoisted so the vi.mock factory can reference it
const { mockScrapeUrls, mockScrapeSerpData } = vi.hoisted(() => ({
  mockScrapeUrls: vi.fn(),
  mockScrapeSerpData: vi.fn(),
}));

vi.mock('../../server/web-scraper.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/web-scraper.js')>();
  return {
    ...actual,
    scrapeUrls: mockScrapeUrls,
    scrapeSerpData: mockScrapeSerpData,
  };
});

// ── Imports (after mock declarations) ─────────────────────────────────────────
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { getPost, savePost } from '../../server/content-posts-db.js';
import { getBrief } from '../../server/content-brief.js';
import { createContentRequest, updateContentRequest } from '../../server/content-requests.js';
import {
  runContentBriefGenerationJob,
  type StandaloneContentBriefGenerationParams,
  type RequestContentBriefGenerationParams,
} from '../../server/content-brief-generation-job.js';
import { createJob, getJob } from '../../server/jobs.js';
import { signAdminToken } from '../../server/middleware.js';
import { buildContentGenerationContext } from '../../server/intelligence/generation-context-builders.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import db from '../../server/db/index.js';
import type { GeneratedPost, ContentBrief } from '../../shared/types/content.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_SCRAPED_PAGE = {
  url: 'https://example.com/ref-page',
  title: 'Reference Page',
  metaDescription: 'A reference page for testing',
  headings: [{ level: 1, text: 'Main Heading' }],
  bodyText: 'Real scraped body text used for evidence grounding. Revenue grew 42% in 2026.',
  wordCount: 100,
  fetchedAt: '2026-06-11T00:00:00.000Z',
};

const MOCK_SERP_DATA = {
  query: 'c4 evidence keyword',
  peopleAlsoAsk: ['What is evidence grounding?'],
  organicResults: [
    { position: 1, title: 'Top Result', url: 'https://top.example.com', snippet: 'Real SERP snippet text.' },
  ],
  fetchedAt: '2026-06-11T00:05:00.000Z',
};

function makeMockBriefResponse() {
  return {
    executiveSummary: 'Test summary',
    suggestedTitle: 'C4 Test Brief Title',
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

function makeValidReviewResponse() {
  const item = (pass: boolean, reason: string) => ({ pass, reason });
  return {
    // Model misbehaves and returns pass=true for provenance keys — persistence
    // must store them pass=false + humanReviewRequired (content-quality-grounding).
    factual_accuracy: item(true, 'Looks fine to me'),
    brand_voice: item(true, 'Consistent professional tone'),
    internal_links: item(false, 'No internal links found'),
    no_hallucinations: item(true, 'Nothing suspicious'),
    meta_optimized: item(true, 'Title and description within limits'),
    word_count_target: item(false, 'Post is 20 words vs 500 target'),
  };
}

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl = '';
let stopServer: (() => void) | undefined;
let wsId = '';
let postId = '';
let briefId = '';
const originalAppPassword = process.env.APP_PASSWORD;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD; // bypass admin auth gate in-process
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  stopServer = () => server.close();
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getJson<T>(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, body: await res.json() as T };
}

function seedPost(): string {
  const id = `post_c4_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  savePost(wsId, {
    id,
    workspaceId: wsId,
    briefId,
    targetKeyword: 'c4 evidence keyword',
    title: 'C4 Test Post',
    metaDescription: 'A test post',
    seoTitle: 'C4 Test Post — SEO',
    seoMetaDescription: 'A test post description',
    introduction: '<p>This is the introduction. Revenue grew 42% in 2026.</p>',
    sections: [{
      index: 0,
      heading: 'Section One',
      content: '<p>Section one content here.</p>',
      wordCount: 5,
      targetWordCount: 100,
      keywords: [],
      status: 'done',
    }],
    conclusion: '<p>This is the conclusion.</p>',
    totalWordCount: 20,
    targetWordCount: 500,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function runBriefJob(params: StandaloneContentBriefGenerationParams | RequestContentBriefGenerationParams): Promise<string> {
  const job = createJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION, {
    workspaceId: wsId,
    total: 1,
    message: 'C4 test job',
  });
  await runContentBriefGenerationJob(job.id, params);
  return job.id;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-c4';

  const ws = createWorkspace('C4 Persist Review Test Workspace');
  wsId = ws.id;

  briefId = `brief_c4_${Date.now()}`;
  db.prepare(
    `INSERT INTO content_briefs
       (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
        suggested_meta_desc, outline, word_count_target, intent, audience,
        competitor_insights, internal_link_suggestions, created_at, reference_urls,
        real_people_also_ask, real_top_results)
     VALUES
       (@id, @workspace_id, @target_keyword, @secondary_keywords, @suggested_title,
        @suggested_meta_desc, @outline, @word_count_target, @intent, @audience,
        @competitor_insights, @internal_link_suggestions, @created_at, @reference_urls,
        @real_people_also_ask, @real_top_results)`,
  ).run({
    id: briefId,
    workspace_id: wsId,
    target_keyword: 'c4 evidence keyword',
    secondary_keywords: JSON.stringify(['related keyword']),
    suggested_title: 'C4 Evidence Brief',
    suggested_meta_desc: 'Meta description',
    outline: JSON.stringify([{ heading: 'Section 1', notes: 'Notes', wordCount: 300, keywords: [] }]),
    word_count_target: 1500,
    intent: 'informational',
    audience: 'general',
    competitor_insights: '',
    internal_link_suggestions: JSON.stringify([]),
    created_at: new Date().toISOString(),
    reference_urls: JSON.stringify(['https://example.com/ref-page']),
    real_people_also_ask: JSON.stringify(['What is evidence grounding?']),
    real_top_results: JSON.stringify([{ position: 1, title: 'Top Result', url: 'https://top.example.com' }]),
  });

  postId = seedPost();
}, 30_000);

afterAll(() => {
  db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  stopServer?.();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

beforeEach(() => {
  resetOpenAIMocks();
  broadcastState.calls = [];
  mockScrapeUrls.mockReset();
  mockScrapeSerpData.mockReset();
  mockScrapeUrls.mockResolvedValue([MOCK_SCRAPED_PAGE]);
  mockScrapeSerpData.mockResolvedValue(MOCK_SERP_DATA);

  vi.mocked(buildContentGenerationContext).mockImplementation(async (_workspaceId, opts = {}) => ({
    intelligence: {
      version: 1,
      workspaceId: wsId,
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
  } as Awaited<ReturnType<typeof buildContentGenerationContext>>));

  mockOpenAIJsonResponse('content-brief', makeMockBriefResponse());
  mockOpenAIJsonResponse('content-review', makeValidReviewResponse());
});

// ── 1. AI review persistence ─────────────────────────────────────────────────

describe('POST /api/content-posts/:wsId/:postId/ai-review — verdict persistence', () => {
  it('persists verdicts retrievable via a fresh GET after "editor close"', async () => {
    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-review`, {});
    expect(res.status).toBe(200);
    const live = await res.json() as { review: Record<string, { pass: boolean }> };
    expect(live.review.brand_voice.pass).toBe(true);

    // Simulate editor close → fresh read through the actual HTTP read path
    const { status, body } = await getJson<GeneratedPost>(`/api/content-posts/${wsId}/${postId}`);
    expect(status).toBe(200);
    expect(body.aiReview).toBeDefined();
    expect(typeof body.aiReview!.reviewedAt).toBe('string');
    expect(body.aiReview!.review.brand_voice).toMatchObject({ pass: true });
    expect(body.aiReview!.review.word_count_target.pass).toBe(false);

    // And via a direct store read (DB row, not in-memory state)
    const stored = getPost(wsId, postId);
    expect(stored?.aiReview?.review.internal_links.reason).toBe('No internal links found');
  });

  it('never persists raw AI passes for provenance-sensitive keys', async () => {
    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-review`, {});
    expect(res.status).toBe(200);

    const stored = getPost(wsId, postId);
    for (const key of ['factual_accuracy', 'no_hallucinations'] as const) {
      expect(stored?.aiReview?.review[key].pass).toBe(false);
      expect(stored?.aiReview?.review[key].humanReviewRequired).toBe(true);
    }
  });

  it('persists the evidence snapshot from the brief alongside the verdicts', async () => {
    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-review`, {});
    expect(res.status).toBe(200);

    const stored = getPost(wsId, postId);
    expect(stored?.aiReview?.evidence?.peopleAlsoAsk).toContain('What is evidence grounding?');
    expect(stored?.aiReview?.evidence?.topResults?.[0]?.url).toBe('https://top.example.com');
  });

  it('broadcasts CONTENT_UPDATED and writes an activity row for the persisted review', async () => {
    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-review`, {});
    expect(res.status).toBe(200);

    const contentUpdated = broadcastState.calls.filter(c =>
      c.workspaceId === wsId && c.event === WS_EVENTS.CONTENT_UPDATED && c.payload.action === 'ai_review_completed');
    expect(contentUpdated.length).toBe(1);

    const activity = db.prepare(
      `SELECT COUNT(*) as cnt FROM activity_log WHERE workspace_id = ? AND type = 'post_ai_review'`,
    ).get(wsId) as { cnt: number };
    expect(activity.cnt).toBeGreaterThan(0);
  });

  it('FM-2: schema-invalid AI response → 500 and nothing persisted', async () => {
    const freshPostId = seedPost();
    mockOpenAIJsonResponse('content-review', { totally: 'wrong shape' });

    const res = await postJson(`/api/content-posts/${wsId}/${freshPostId}/ai-review`, {});
    expect(res.status).toBe(500);

    const stored = getPost(wsId, freshPostId);
    expect(stored?.aiReview).toBeUndefined();
  });
});

// ── 2. Brief source-text persistence ─────────────────────────────────────────

describe('Brief generation job — scraped source text persistence', () => {
  it('standalone path: brief row carries scraped bodyText, SERP snippets, and fetch timestamps', async () => {
    const jobId = await runBriefJob({
      source: 'standalone',
      workspaceId: wsId,
      targetKeyword: 'c4 evidence keyword',
      referenceUrls: ['https://example.com/ref-page'],
    });

    const job = getJob(jobId);
    expect(job?.status).toBe('done');
    const generatedBriefId = (job?.result as { briefId: string }).briefId;

    // Fresh store read — the actual persisted row, not the in-memory job object
    const brief = getBrief(wsId, generatedBriefId);
    expect(brief?.sourceEvidence).toBeDefined();
    expect(brief?.sourceEvidence?.scrapedReferences?.[0]?.bodyText)
      .toContain('Real scraped body text used for evidence grounding');
    expect(brief?.sourceEvidence?.scrapedReferences?.[0]?.fetchedAt).toBe(MOCK_SCRAPED_PAGE.fetchedAt);
    expect(brief?.sourceEvidence?.serpResults?.[0]?.snippet).toBe('Real SERP snippet text.');
    expect(brief?.sourceEvidence?.serpFetchedAt).toBe(MOCK_SERP_DATA.fetchedAt);
    expect(typeof brief?.sourceEvidence?.capturedAt).toBe('string');
  });

  it('request path: brief row carries SERP source text', async () => {
    const request = createContentRequest(wsId, {
      topic: 'C4 Topic',
      targetKeyword: 'c4 evidence keyword',
      intent: 'informational',
      priority: 'medium',
      rationale: 'C4 test',
      source: 'client',
      serviceType: 'brief_only',
      pageType: 'blog',
      dedupe: false,
    });

    const jobId = await runBriefJob({ source: 'request', workspaceId: wsId, requestId: request.id });
    const job = getJob(jobId);
    expect(job?.status).toBe('done');
    const generatedBriefId = (job?.result as { briefId: string }).briefId;

    const brief = getBrief(wsId, generatedBriefId);
    expect(brief?.sourceEvidence?.serpResults?.[0]?.snippet).toBe('Real SERP snippet text.');
    // No admin reference URLs on the request path — field omitted, not empty array
    expect(brief?.sourceEvidence?.scrapedReferences).toBeUndefined();
  });

  it('FM-2 (C1 degradation): scraper total failure → no sourceEvidence, job still succeeds', async () => {
    mockScrapeUrls.mockResolvedValue([]);
    mockScrapeSerpData.mockResolvedValue(null);

    const jobId = await runBriefJob({
      source: 'standalone',
      workspaceId: wsId,
      targetKeyword: 'c4 evidence keyword',
      referenceUrls: ['https://example.com/ref-page'],
    });

    const job = getJob(jobId);
    expect(job?.status).toBe('done');
    const generatedBriefId = (job?.result as { briefId: string }).briefId;

    const brief = getBrief(wsId, generatedBriefId);
    expect(brief).toBeDefined();
    expect(brief?.sourceEvidence).toBeUndefined();
  });
});

// ── 3. Schema vs stored shape ────────────────────────────────────────────────

describe('Stored-shape Zod contracts (optional fields per schema-vs-stored-shape rule)', () => {
  it('source_evidence blob with omitted optional arrays parses to real data, not fallback', () => {
    const sparseBriefId = `brief_c4_sparse_${Date.now()}`;
    db.prepare(
      `INSERT INTO content_briefs
         (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
          suggested_meta_desc, outline, word_count_target, intent, audience,
          competitor_insights, internal_link_suggestions, created_at, source_evidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sparseBriefId, wsId, 'sparse kw', '[]', 'Sparse', 'Sparse meta', '[]', 1000,
      'informational', 'general', '', '[]', new Date().toISOString(),
      JSON.stringify({
        capturedAt: '2026-06-11T01:00:00.000Z',
        serpResults: [{ position: 1, title: 'T', url: 'https://u.example.com', snippet: 'S' }],
        // scrapedReferences / styleExamples / serpFetchedAt deliberately omitted
      }),
    );

    const brief = getBrief(wsId, sparseBriefId);
    expect(brief?.sourceEvidence?.capturedAt).toBe('2026-06-11T01:00:00.000Z');
    expect(brief?.sourceEvidence?.serpResults?.[0]?.snippet).toBe('S');
    expect(brief?.sourceEvidence?.scrapedReferences).toBeUndefined();
  });

  it('ai_review blob without optional evidence/model parses to real data', () => {
    const sparsePostId = seedPost();
    const review = Object.fromEntries(
      ['factual_accuracy', 'brand_voice', 'internal_links', 'no_hallucinations', 'meta_optimized', 'word_count_target']
        .map(k => [k, { pass: false, reason: 'r' }]),
    );
    db.prepare(`UPDATE content_posts SET ai_review = ? WHERE id = ? AND workspace_id = ?`)
      .run(JSON.stringify({ review, reviewedAt: '2026-06-11T02:00:00.000Z' }), sparsePostId, wsId);

    const post = getPost(wsId, sparsePostId);
    expect(post?.aiReview?.reviewedAt).toBe('2026-06-11T02:00:00.000Z');
    expect(post?.aiReview?.review.brand_voice.reason).toBe('r');
    expect(post?.aiReview?.evidence).toBeUndefined();
  });
});

// ── 4. Public boundary ───────────────────────────────────────────────────────

describe('Public boundary — admin-internal fields stripped from client responses', () => {
  it('client brief GET omits sourceEvidence but keeps saved SERP summary fields', async () => {
    // Give the seeded brief a source_evidence blob
    db.prepare(`UPDATE content_briefs SET source_evidence = ? WHERE id = ? AND workspace_id = ?`)
      .run(JSON.stringify({
        capturedAt: new Date().toISOString(),
        scrapedReferences: [MOCK_SCRAPED_PAGE],
      }), briefId, wsId);

    const { status, body } = await getJson<ContentBrief>(
      `/api/public/content-brief/${wsId}/${briefId}`,
      { 'x-auth-token': signAdminToken() },
    );
    expect(status).toBe(200);
    expect(body.realPeopleAlsoAsk).toContain('What is evidence grounding?');
    expect((body as Record<string, unknown>).sourceEvidence).toBeUndefined();
  });

  it('client post GET omits aiReview', async () => {
    // Persist a review on the post first
    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-review`, {});
    expect(res.status).toBe(200);
    expect(getPost(wsId, postId)?.aiReview).toBeDefined();

    // Associate a post_review request so the public route serves the post
    const request = createContentRequest(wsId, {
      topic: 'C4 Public Topic',
      targetKeyword: 'c4 public keyword',
      intent: 'informational',
      priority: 'medium',
      rationale: 'C4 public boundary test',
      serviceType: 'full_post',
      dedupe: false,
    });
    updateContentRequest(wsId, request.id, { status: 'in_progress', postId });
    updateContentRequest(wsId, request.id, { status: 'post_review' });

    const { status, body } = await getJson<GeneratedPost>(
      `/api/public/content-posts/${wsId}/${postId}`,
      { 'x-auth-token': signAdminToken() },
    );
    expect(status).toBe(200);
    expect(body.title).toBe('C4 Test Post');
    expect((body as Record<string, unknown>).aiReview).toBeUndefined();

    // The client-edit PATCH response is the third strip site — pin it too
    // (same post_review setup; review M2: a mutation removing this strip
    // previously passed all tests).
    const editRes = await fetch(`${baseUrl}/api/public/content-posts/${wsId}/${postId}/client-edit`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': signAdminToken() },
      body: JSON.stringify({ title: 'C4 Client Edited Title' }),
    });
    expect(editRes.status).toBe(200);
    const edited = await editRes.json() as Record<string, unknown>;
    expect(edited.title).toBe('C4 Client Edited Title');
    expect(edited.aiReview).toBeUndefined();
    // The strip is response-only: the stored row keeps the review.
    expect(getPost(wsId, postId)?.aiReview).toBeDefined();
  });
});
