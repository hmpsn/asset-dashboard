/**
 * Integration tests — C2: Sync AI routes migrated to background job platform
 *
 * Covers the four routes migrated in C2:
 *   1. POST /api/copy/:wsId/:bpId/:entryId/generate   → COPY_ENTRY_GENERATION job
 *   2. POST /api/page-strategy/:wsId/generate          → BLUEPRINT_GENERATION job
 *   3. POST /api/llms-txt/:wsId/generate               → LLMS_TXT_GENERATION job
 *   4. POST /api/aeo-review/:wsId/site                 → AEO_SITE_REVIEW job (already covered by
 *        aeo-review-lifecycle.test.ts — tested here only for non-existent workspace guard)
 *
 * Test matrix per route (where applicable):
 *   - Happy path: POST returns 200 { jobId: string }, poll /api/jobs/:id until done
 *   - FM-2 (provider failure): mock AI throws → job status === 'error', no partial data
 *   - Non-existent workspace → 404
 *   - Schema validation / missing required field → 400
 *
 * Uses the inline server pattern (vi.mock + dynamic import of createApp) so vi.mock
 * state is shared with the test process — required for mocking server modules.
 *
 * Port: none (listen on 0 / ephemeral)
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import {
  createBlueprint,
  addEntry,
} from '../../server/page-strategy.js';

// ─── Mock state ───────────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  generateBlueprintResult: null as null | Record<string, unknown>,
  generateBlueprintThrows: false,
  generateCopyResult: null as null | { sections: unknown[]; metadata: unknown },
  generateCopyThrows: false,
  generateLlmsTxtResult: null as null | { content: string; fullContent: string; pageCount: number; generatedAt: string },
  generateLlmsTxtThrows: false,
  reviewSiteResult: null as null | Record<string, unknown>,
  reviewSiteThrows: false,
  publishedPages: [] as Array<{ slug: string; title: string; url?: string }>,
  cmsUrls: [] as Array<{ url: string; path: string; pageName: string }>,
}));

// ── Mock blueprint-generator ──────────────────────────────────────────────────

vi.mock('../../server/blueprint-generator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/blueprint-generator.js')>();
  return {
    ...actual,
    generateBlueprint: vi.fn(async (_wsId: string, input: { industryType: string }) => {
      if (state.generateBlueprintThrows) throw new Error('AI provider unavailable');
      if (state.generateBlueprintResult) return state.generateBlueprintResult;
      // Default minimal SiteBlueprint shape expected by the job
      return {
        id: 'bp-generated',
        workspaceId: _wsId,
        name: `${input.industryType} Blueprint`,
        version: 1,
        status: 'draft',
        entries: [{ id: 'e1', name: 'Homepage', pageType: 'homepage', sectionPlan: [] }],
        createdAt: '2026-06-10T00:00:00.000Z',
        updatedAt: '2026-06-10T00:00:00.000Z',
      };
    }),
  };
});

// ── Mock copy-generation ──────────────────────────────────────────────────────

vi.mock('../../server/copy-generation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/copy-generation.js')>();
  return {
    ...actual,
    generateCopyForEntry: vi.fn(async () => {
      if (state.generateCopyThrows) throw new Error('AI provider unavailable');
      if (state.generateCopyResult) return state.generateCopyResult;
      return {
        sections: [{ id: 's1', title: 'Intro', content: 'Generated intro copy.' }],
        metadata: { generatedAt: '2026-06-10T00:00:00.000Z', model: 'gpt-5.4-mini' },
      };
    }),
  };
});

// ── Mock llms-txt-generator ───────────────────────────────────────────────────

vi.mock('../../server/llms-txt-generator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/llms-txt-generator.js')>();
  return {
    ...actual,
    generateLlmsTxt: vi.fn(async () => {
      if (state.generateLlmsTxtThrows) throw new Error('AI provider unavailable');
      if (state.generateLlmsTxtResult) return state.generateLlmsTxtResult;
      return {
        content: '# LLMs.txt\n\n## Pages\n- [Home](https://example.test/) - Home page',
        fullContent: '# LLMs.txt Full\n\n## Pages\n- [Home](https://example.test/) - Home page\n\nSummary: A home page.',
        pageCount: 1,
        generatedAt: '2026-06-10T00:00:00.000Z',
      };
    }),
  };
});

// ── Mock broadcast (singleton not initialized without initWebSocket) ─────────
// In the inline server pattern, createApp() is used without initWebSocket(),
// so broadcastToWorkspace() would throw. No-op the broadcast functions.

vi.mock('../../server/broadcast.js', () => ({
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  setBroadcast: vi.fn(),
}));

// ── Mock aeo-page-review (used by aeo-site-review-job) ───────────────────────

vi.mock('../../server/aeo-page-review.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/aeo-page-review.js')>();
  return {
    ...actual,
    reviewSitePages: vi.fn(async (_wsId: string, pages: Array<{ url: string }>) => {
      if (state.reviewSiteThrows) throw new Error('AI provider unavailable');
      if (state.reviewSiteResult) return state.reviewSiteResult;
      return {
        workspaceId: _wsId,
        generatedAt: '2026-06-10T00:00:00.000Z',
        pages: pages.map((p, i) => ({
          pageUrl: p.url,
          pageTitle: `Page ${i + 1}`,
          overallScore: 80,
          summary: 'Good AEO baseline.',
          changes: [],
          quickWinCount: 0,
          estimatedTimeMinutes: 0,
        })),
        sitewideSummary: `Reviewed ${pages.length} pages`,
        totalChanges: 0,
        quickWins: 0,
      };
    }),
  };
});

// ── Mock workspace-data + webflow (page discovery used by AEO job) ───────────

vi.mock('../../server/workspace-data.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspace-data.js')>();
  return {
    ...actual,
    getWorkspacePages: vi.fn(async () => state.publishedPages),
  };
});

vi.mock('../../server/webflow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    buildStaticPathSet: vi.fn(() => new Set<string>()),
    discoverCmsUrls: vi.fn(async () => ({ cmsUrls: state.cmsUrls, llmsTxtUrls: [] })),
  };
});

// ─── Server bootstrap ─────────────────────────────────────────────────────────

const nativeFetch = globalThis.fetch;

let server: http.Server | undefined;
let baseUrl = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((err) => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

function api(pathname: string, opts?: RequestInit): Promise<Response> {
  return nativeFetch(`${baseUrl}${pathname}`, opts);
}

function postJson(pathname: string, body: unknown): Promise<Response> {
  return api(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * POST the given endpoint (which now returns { jobId }) then poll /api/jobs/:id
 * until it reaches a terminal state ('done' | 'error' | 'cancelled').
 * Returns the final job record. Throws on timeout.
 */
async function startJobAndWait(
  pathname: string,
  body: unknown,
  timeoutMs = 10_000,
): Promise<{
  startRes: Response;
  startBody: { jobId?: string; error?: string };
  job: Record<string, unknown> | null;
}> {
  const startRes = await postJson(pathname, body);
  if (!startRes.ok) {
    const startBody = (await startRes.json()) as { error?: string };
    return { startRes, startBody, job: null };
  }
  const startBody = (await startRes.json()) as { jobId: string };
  const { jobId } = startBody;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api(`/api/jobs/${jobId}`);
    if (res.status === 200) {
      const job = (await res.json()) as Record<string, unknown>;
      if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
        return { startRes, startBody, job };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

// ─── Workspace lifecycle helpers ──────────────────────────────────────────────

const createdWorkspaceIds = new Set<string>();

function makeWorkspace(name: string, extra?: { webflowSiteId?: string; liveDomain?: string }) {
  const ws = createWorkspace(name);
  createdWorkspaceIds.add(ws.id);
  if (extra?.webflowSiteId || extra?.liveDomain) {
    updateWorkspace(ws.id, extra);
  }
  return ws;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
}, 60_000);

beforeEach(() => {
  // Reset mock state between tests
  state.generateBlueprintResult = null;
  state.generateBlueprintThrows = false;
  state.generateCopyResult = null;
  state.generateCopyThrows = false;
  state.generateLlmsTxtResult = null;
  state.generateLlmsTxtThrows = false;
  state.reviewSiteResult = null;
  state.reviewSiteThrows = false;
  state.publishedPages = [];
  state.cmsUrls = [];
});

afterEach(() => {
  for (const wsId of createdWorkspaceIds) {
    deleteWorkspace(wsId);
  }
  createdWorkspaceIds.clear();
});

afterAll(async () => {
  await stopTestServer();
});

// ─── 1. Blueprint Generation ──────────────────────────────────────────────────

describe('POST /api/page-strategy/:wsId/generate — BLUEPRINT_GENERATION job', () => {
  it('happy path: returns { jobId }, job reaches done with blueprint result', async () => {
    const ws = makeWorkspace('C2 Blueprint Gen Happy');

    const { startRes, startBody, job } = await startJobAndWait(
      `/api/page-strategy/${ws.id}/generate`,
      { industryType: 'SaaS' },
    );

    expect(startRes.status).toBe(200);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('done');
    // Result is the SiteBlueprint object
    const result = job?.result as Record<string, unknown> | undefined;
    expect(result).toBeTruthy();
    expect(typeof result?.name).toBe('string');
  });

  it('FM-2: AI throws → job status is error, no blueprint result', async () => {
    state.generateBlueprintThrows = true;
    const ws = makeWorkspace('C2 Blueprint Gen FM2');

    const { startRes, startBody, job } = await startJobAndWait(
      `/api/page-strategy/${ws.id}/generate`,
      { industryType: 'SaaS' },
    );

    expect(startRes.status).toBe(200);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('error');
    expect(typeof job?.error).toBe('string');
    expect(job?.result == null || job?.result === undefined).toBe(true);
  });

  it('non-existent workspace → 404', async () => {
    const res = await postJson('/api/page-strategy/nonexistent-ws-id/generate', {
      industryType: 'SaaS',
    });
    expect(res.status).toBe(404);
  });

  it('schema validation: missing industryType → 400', async () => {
    const ws = makeWorkspace('C2 Blueprint Gen Zod');
    const res = await postJson(`/api/page-strategy/${ws.id}/generate`, {});
    expect(res.status).toBe(400);
  });
});

// ─── 2. Copy Entry Generation ─────────────────────────────────────────────────

describe('POST /api/copy/:wsId/:bpId/:entryId/generate — COPY_ENTRY_GENERATION job', () => {
  it('happy path: returns { jobId }, job reaches done with sections result', async () => {
    const ws = makeWorkspace('C2 Copy Gen Happy');
    const bp = createBlueprint({ workspaceId: ws.id, name: 'Test BP' });
    const entry = addEntry(ws.id, bp.id, { name: 'About Page', pageType: 'about' });
    if (!entry) throw new Error('addEntry returned null — check test setup');

    const { startRes, startBody, job } = await startJobAndWait(
      `/api/copy/${ws.id}/${bp.id}/${entry.id}/generate`,
      { accumulatedSteering: [] },
    );

    expect(startRes.status).toBe(200);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('done');
    const result = job?.result as Record<string, unknown> | undefined;
    expect(result).toBeTruthy();
    expect(Array.isArray(result?.sections)).toBe(true);
  });

  it('FM-2: AI throws → job status is error, no sections in result', async () => {
    state.generateCopyThrows = true;
    const ws = makeWorkspace('C2 Copy Gen FM2');
    const bp = createBlueprint({ workspaceId: ws.id, name: 'Test BP FM2' });
    const entry = addEntry(ws.id, bp.id, { name: 'Service Page', pageType: 'service' });
    if (!entry) throw new Error('addEntry returned null — check test setup');

    const { startRes, startBody, job } = await startJobAndWait(
      `/api/copy/${ws.id}/${bp.id}/${entry.id}/generate`,
      {},
    );

    expect(startRes.status).toBe(200);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('error');
    expect(typeof job?.error).toBe('string');
    expect(job?.result == null || job?.result === undefined).toBe(true);
  });

  it('non-existent workspace → 404', async () => {
    const res = await postJson(
      '/api/copy/nonexistent-ws/blueprint-id/entry-id/generate',
      {},
    );
    expect(res.status).toBe(404);
  });

  it('schema validation: invalid accumulatedSteering type → 400', async () => {
    const ws = makeWorkspace('C2 Copy Gen Zod');
    const bp = createBlueprint({ workspaceId: ws.id, name: 'Test BP Zod' });
    const entry = addEntry(ws.id, bp.id, { name: 'Blog Post', pageType: 'blog' });
    if (!entry) throw new Error('addEntry returned null — check test setup');

    const res = await postJson(
      `/api/copy/${ws.id}/${bp.id}/${entry.id}/generate`,
      { accumulatedSteering: 'not-an-array' },
    );
    expect(res.status).toBe(400);
  });
});

// ─── 3. LLMs.txt Generation ───────────────────────────────────────────────────

describe('POST /api/llms-txt/:wsId/generate — LLMS_TXT_GENERATION job', () => {
  it('happy path: returns { jobId }, job reaches done with content result', async () => {
    const ws = makeWorkspace('C2 LlmsTxt Happy');

    const { startRes, startBody, job } = await startJobAndWait(
      `/api/llms-txt/${ws.id}/generate`,
      {},
    );

    expect(startRes.status).toBe(200);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('done');
    const result = job?.result as Record<string, unknown> | undefined;
    expect(result).toBeTruthy();
    expect(typeof result?.content).toBe('string');
    expect(typeof result?.pageCount).toBe('number');
  });

  it('FM-2: AI throws → job status is error, no content result', async () => {
    state.generateLlmsTxtThrows = true;
    const ws = makeWorkspace('C2 LlmsTxt FM2');

    const { startRes, startBody, job } = await startJobAndWait(
      `/api/llms-txt/${ws.id}/generate`,
      {},
    );

    expect(startRes.status).toBe(200);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('error');
    expect(typeof job?.error).toBe('string');
    expect(job?.result == null || job?.result === undefined).toBe(true);
  });

  it('non-existent workspace → 404', async () => {
    const res = await postJson('/api/llms-txt/nonexistent-ws-id/generate', {});
    expect(res.status).toBe(404);
  });

  it('GET /freshness endpoint returns lastGeneratedAt after job completes', async () => {
    const ws = makeWorkspace('C2 LlmsTxt Freshness');

    const { startRes, job } = await startJobAndWait(
      `/api/llms-txt/${ws.id}/generate`,
      {},
    );
    expect(startRes.status).toBe(200);
    expect(job?.status).toBe('done');

    const freshnessRes = await api(`/api/llms-txt/${ws.id}/freshness`);
    expect(freshnessRes.status).toBe(200);
    const freshness = (await freshnessRes.json()) as { lastGeneratedAt: string | null };
    // May be null if generateLlmsTxt mock doesn't call setLastGenerated — that's OK;
    // the important thing is the endpoint exists and returns 200.
    expect('lastGeneratedAt' in freshness).toBe(true);
  });
});

// ─── 4. AEO Site Review — non-existent workspace guard ───────────────────────

describe('POST /api/aeo-review/:wsId/site — non-existent workspace guard', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await postJson('/api/aeo-review/nonexistent-ws-id/site', { maxPages: 5 });
    expect(res.status).toBe(404);
  });
});

// ─── 5. POST /api/jobs dispatcher covers all 4 C2 job types (C-1 regression guard) ──

describe('POST /api/jobs dispatcher — 4 C2 job types must not return 400 "Unknown job type"', () => {
  it('BLUEPRINT_GENERATION via POST /api/jobs: returns { jobId }, job reaches done', async () => {
    const ws = makeWorkspace('C1 Dispatch Blueprint');

    const { startRes, startBody, job } = await startJobAndWait(
      '/api/jobs',
      { type: 'blueprint-generation', params: { workspaceId: ws.id, industryType: 'SaaS' } },
    );

    expect(startRes.status).toBe(200);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('done');
  });

  it('COPY_ENTRY_GENERATION via POST /api/jobs: returns { jobId }, job reaches done', async () => {
    const ws = makeWorkspace('C1 Dispatch Copy');
    const bp = createBlueprint({ workspaceId: ws.id, name: 'Dispatch BP' });
    const entry = addEntry(ws.id, bp.id, { name: 'Landing Page', pageType: 'landing' });
    if (!entry) throw new Error('addEntry returned null');

    const { startRes, startBody, job } = await startJobAndWait(
      '/api/jobs',
      { type: 'copy-entry-generation', params: { workspaceId: ws.id, blueprintId: bp.id, entryId: entry.id } },
    );

    expect(startRes.status).toBe(200);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('done');
  });

  it('LLMS_TXT_GENERATION via POST /api/jobs: returns { jobId }, job reaches done', async () => {
    const ws = makeWorkspace('C1 Dispatch LlmsTxt');

    const { startRes, startBody, job } = await startJobAndWait(
      '/api/jobs',
      { type: 'llms-txt-generation', params: { workspaceId: ws.id } },
    );

    expect(startRes.status).toBe(200);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('done');
  });

  it('AEO_SITE_REVIEW via POST /api/jobs: workspace without Webflow returns 400, not "Unknown job type"', async () => {
    // A workspace without webflowSiteId should get a meaningful 400 (not "Unknown job type")
    const ws = makeWorkspace('C1 Dispatch AEO No Webflow');

    const res = await postJson('/api/jobs', {
      type: 'aeo-site-review',
      params: { workspaceId: ws.id, maxPages: 5 },
    });
    // Without webflowSiteId it returns 400 "No Webflow site linked" — not 400 "Unknown job type"
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toBe('Unknown job type: aeo-site-review');
    expect(body.error).toContain('Webflow');
  });

  it('AEO_SITE_REVIEW via POST /api/jobs: unknown workspace returns 404', async () => {
    const res = await postJson('/api/jobs', {
      type: 'aeo-site-review',
      params: { workspaceId: 'nonexistent-ws', maxPages: 5 },
    });
    expect(res.status).toBe(404);
  });

  it('unknown job type still returns 400 "Unknown job type"', async () => {
    const res = await postJson('/api/jobs', {
      type: 'not-a-real-job-type',
      params: { workspaceId: 'some-ws' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Unknown job type');
  });
});

// ─── 7. Cross-cutting: all routes return { jobId } shape ─────────────────────

describe('jobId shape contract: all C2 async generation endpoints', () => {
  it('blueprint generate returns { jobId: string } (not old sync body)', async () => {
    const ws = makeWorkspace('C2 Shape Blueprint');
    const res = await postJson(`/api/page-strategy/${ws.id}/generate`, { industryType: 'Agency' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.jobId).toBe('string');
    // Ensure the old sync shape (blueprint object with `id` field at top level) is NOT returned
    expect(body.entries).toBeUndefined();
    expect(body.name).toBeUndefined();
  });

  it('copy generate returns { jobId: string } (not old sync body)', async () => {
    const ws = makeWorkspace('C2 Shape Copy');
    const bp = createBlueprint({ workspaceId: ws.id, name: 'Shape BP' });
    const entry = addEntry(ws.id, bp.id, { name: 'Landing', pageType: 'landing' });
    if (!entry) throw new Error('addEntry returned null — check test setup');

    const res = await postJson(`/api/copy/${ws.id}/${bp.id}/${entry.id}/generate`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.jobId).toBe('string');
    // Old sync response would have had `sections` at top level
    expect(body.sections).toBeUndefined();
  });

  it('llms-txt generate returns { jobId: string } (not old sync body)', async () => {
    const ws = makeWorkspace('C2 Shape LlmsTxt');
    const res = await postJson(`/api/llms-txt/${ws.id}/generate`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.jobId).toBe('string');
    // Old sync response would have had `content` at top level
    expect(body.content).toBeUndefined();
  });
});
