/**
 * Integration tests: Webflow SEO background job start routes.
 *
 * Covers the HTTP contract of webflow-seo-jobs.ts — workspace existence,
 * Zod validation, env-var guards, happy-path jobId responses, and the
 * 409 duplicate-job guard. Job runners are mocked so tests never call
 * OpenAI or the Webflow API.
 *
 * Routes under test:
 *   POST /api/seo/:workspaceId/bulk-analyze
 *   POST /api/seo/:workspaceId/bulk-rewrite
 *   POST /api/seo/:workspaceId/bulk-accept-fixes
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Hoist job-runner mocks so the server loads the mocked versions ────────────
// The actual runners call OpenAI/Webflow — we never want that in route tests.
vi.mock('../../server/webflow-seo-bulk-analyze-job.js', () => ({
  runSeoBulkAnalyzeJob: vi.fn(async () => { /* no-op */ }),
}));

vi.mock('../../server/webflow-seo-bulk-rewrite-job.js', () => ({
  runSeoBulkRewriteJob: vi.fn(async () => { /* no-op */ }),
}));

vi.mock('../../server/webflow-seo-bulk-accept-fixes-job.js', () => ({
  runSeoBulkAcceptFixesJob: vi.fn(async () => { /* no-op */ }),
}));

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { cancelJob, clearCompletedJobs, listJobs } from '../../server/jobs.js';
import db from '../../server/db/index.js';

// ── Saved env state ───────────────────────────────────────────────────────────
const savedOpenAIKey = process.env.OPENAI_API_KEY;
const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
const savedWebflowToken = process.env.WEBFLOW_API_TOKEN;

// ── In-process test server ────────────────────────────────────────────────────
// Using http.createServer(createApp()) instead of createTestContext so we can
// control process.env between tests (needed for OPENAI_API_KEY / Webflow token
// guard tests).

let server: http.Server | undefined;
let baseUrl = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  // OPENAI_API_KEY starts absent so guard tests can verify the 500 path.
  // Individual tests that need it set will set it themselves.
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.WEBFLOW_API_TOKEN;

  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Workspace fixtures ────────────────────────────────────────────────────────
let wsId = '';
let wsWithSiteId = '';
const KNOWN_SITE_ID = 'site_seo_jobs_routes_test_77';

function clearJobsForWorkspace(id: string): void {
  // Cancel any active (pending/running) jobs so clearCompletedJobs can remove them.
  // The mocked runners never finish, so active jobs linger in memory until cancelled.
  for (const job of listJobs(id)) {
    if (job.status === 'pending' || job.status === 'running') {
      cancelJob(job.id);
    }
  }
  clearCompletedJobs({ workspaceId: id });
  db.prepare('DELETE FROM jobs WHERE workspace_id = ?').run(id);
}

beforeAll(async () => {
  await startTestServer();

  const ws = createWorkspace('SEO Jobs Routes Test WS');
  wsId = ws.id;

  const wsWithSite = createWorkspace('SEO Jobs Routes Test WS With Site');
  wsWithSiteId = wsWithSite.id;
  updateWorkspace(wsWithSiteId, {
    webflowSiteId: KNOWN_SITE_ID,
    webflowToken: 'wf-test-token-seo-jobs-routes',
  });
}, 30_000);

afterEach(() => {
  // Reset env to the neutral "key absent" state after each test.
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.WEBFLOW_API_TOKEN;
  // Clear any jobs created by happy-path tests so duplicate-guard tests are isolated.
  clearJobsForWorkspace(wsId);
  clearJobsForWorkspace(wsWithSiteId);
});

afterAll(async () => {
  deleteWorkspace(wsId);
  deleteWorkspace(wsWithSiteId);
  await stopTestServer();

  // Restore env
  if (savedOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedOpenAIKey;
  if (savedAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
  if (savedWebflowToken === undefined) delete process.env.WEBFLOW_API_TOKEN;
  else process.env.WEBFLOW_API_TOKEN = savedWebflowToken;
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/seo/:workspaceId/bulk-analyze
// ─────────────────────────────────────────────────────────────────────────────

const VALID_PAGE = { pageId: 'page-seo-1', title: 'Home Page' };

describe('POST /api/seo/:workspaceId/bulk-analyze', () => {
  it('returns 404 for an unknown workspaceId', async () => {
    const res = await postJson('/api/seo/ws_does_not_exist_seo_99/bulk-analyze', {
      pages: [VALID_PAGE],
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('returns 400 when pages array is missing', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-analyze`, {});
    expect(res.status).toBe(400);
  });

  it('returns 400 when pages array is empty', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-analyze`, { pages: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a page item is missing required pageId', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-analyze`, {
      pages: [{ title: 'Missing ID' }],
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 when OPENAI_API_KEY is not set', async () => {
    // OPENAI_API_KEY is deleted in startTestServer and afterEach — should be absent here.
    const res = await postJson(`/api/seo/${wsId}/bulk-analyze`, {
      pages: [VALID_PAGE],
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/OPENAI_API_KEY not configured/i);
  });

  it('returns 200 with { jobId } when workspace exists and OPENAI_API_KEY is set', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key-analyze';
    const res = await postJson(`/api/seo/${wsId}/bulk-analyze`, {
      pages: [VALID_PAGE],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { jobId: string };
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);
  });

  it('returns 409 when a bulk-analyze job is already active for the workspace', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key-analyze-dup';

    // First call — starts the job (runner is a no-op mock so it never finishes).
    const first = await postJson(`/api/seo/${wsId}/bulk-analyze`, {
      pages: [VALID_PAGE],
    });
    expect(first.status).toBe(200);
    const { jobId: firstJobId } = await first.json() as { jobId: string };

    // Second call — job is still pending/running → 409.
    const second = await postJson(`/api/seo/${wsId}/bulk-analyze`, {
      pages: [VALID_PAGE],
    });
    expect(second.status).toBe(409);
    const body = await second.json() as { error: string; jobId: string };
    expect(body.error).toMatch(/already running/i);
    expect(body.jobId).toBe(firstJobId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/seo/:workspaceId/bulk-rewrite
// ─────────────────────────────────────────────────────────────────────────────

const VALID_REWRITE_PAGE = { pageId: 'page-rewrite-1', title: 'Services' };

describe('POST /api/seo/:workspaceId/bulk-rewrite', () => {
  it('returns 404 for an unknown workspaceId', async () => {
    const res = await postJson('/api/seo/ws_does_not_exist_seo_99/bulk-rewrite', {
      siteId: KNOWN_SITE_ID,
      pages: [VALID_REWRITE_PAGE],
      field: 'title',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('returns 400 when siteId is missing', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      pages: [VALID_REWRITE_PAGE],
      field: 'title',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when pages array is missing', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      siteId: KNOWN_SITE_ID,
      field: 'title',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when pages array is empty', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      siteId: KNOWN_SITE_ID,
      pages: [],
      field: 'title',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when field is not in allowed enum', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      siteId: KNOWN_SITE_ID,
      pages: [VALID_REWRITE_PAGE],
      field: 'invalid_field',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when field is missing', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      siteId: KNOWN_SITE_ID,
      pages: [VALID_REWRITE_PAGE],
    });
    expect(res.status).toBe(400);
  });

  it('starts with Anthropic only because the canonical creative operation selects its provider', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    const res = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      siteId: KNOWN_SITE_ID,
      pages: [VALID_REWRITE_PAGE],
      field: 'title',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { jobId: string };
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);
  });

  it('preserves immediate failure when no creative provider is configured', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      siteId: KNOWN_SITE_ID,
      pages: [VALID_REWRITE_PAGE],
      field: 'title',
    });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'OPENAI_API_KEY not configured' });
    expect(listJobs(wsId)).toHaveLength(0);
  });

  it('returns 200 with { jobId } when workspace exists', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    // wsId has no webflowSiteId set, so the siteId mismatch guard is skipped.
    const res = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      siteId: KNOWN_SITE_ID,
      pages: [VALID_REWRITE_PAGE],
      field: 'description',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { jobId: string };
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);
  });

  it('returns 409 when a bulk-rewrite job is already active for the workspace', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const first = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      siteId: KNOWN_SITE_ID,
      pages: [VALID_REWRITE_PAGE],
      field: 'both',
    });
    expect(first.status).toBe(200);
    const { jobId: firstJobId } = await first.json() as { jobId: string };

    const second = await postJson(`/api/seo/${wsId}/bulk-rewrite`, {
      siteId: KNOWN_SITE_ID,
      pages: [VALID_REWRITE_PAGE],
      field: 'both',
    });
    expect(second.status).toBe(409);
    const body = await second.json() as { error: string; jobId: string };
    expect(body.error).toMatch(/already running/i);
    expect(body.jobId).toBe(firstJobId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/seo/:workspaceId/bulk-accept-fixes
// ─────────────────────────────────────────────────────────────────────────────

const VALID_FIX = {
  pageId: 'page-fix-1',
  check: 'meta-description',
  suggestedFix: 'A better meta description',
};

describe('POST /api/seo/:workspaceId/bulk-accept-fixes', () => {
  it('returns 404 for an unknown workspaceId', async () => {
    const res = await postJson('/api/seo/ws_does_not_exist_seo_99/bulk-accept-fixes', {
      siteId: KNOWN_SITE_ID,
      fixes: [VALID_FIX],
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/workspace not found/i);
  });

  it('returns 400 when siteId is missing', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-accept-fixes`, {
      fixes: [VALID_FIX],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when fixes array is missing', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-accept-fixes`, {
      siteId: KNOWN_SITE_ID,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when fixes array is empty', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-accept-fixes`, {
      siteId: KNOWN_SITE_ID,
      fixes: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a fix item is missing required check field', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-accept-fixes`, {
      siteId: KNOWN_SITE_ID,
      fixes: [{ pageId: 'page-fix-1', suggestedFix: 'desc' }],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a fix item is missing required suggestedFix field', async () => {
    const res = await postJson(`/api/seo/${wsId}/bulk-accept-fixes`, {
      siteId: KNOWN_SITE_ID,
      fixes: [{ pageId: 'page-fix-1', check: 'meta-description' }],
    });
    expect(res.status).toBe(400);
  });

  it('returns 500 when no Webflow API token is configured for the siteId', async () => {
    // wsId has no webflowSiteId/webflowToken set, and WEBFLOW_API_TOKEN env is absent.
    // getTokenForSite(siteId) returns null → 500.
    const res = await postJson(`/api/seo/${wsId}/bulk-accept-fixes`, {
      siteId: 'site_with_no_token_configured',
      fixes: [VALID_FIX],
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/no webflow api token/i);
  });

  it('returns 200 with { jobId } when workspace and token are configured', async () => {
    // wsWithSiteId has webflowToken set — getTokenForSite(KNOWN_SITE_ID) returns it.
    const res = await postJson(`/api/seo/${wsWithSiteId}/bulk-accept-fixes`, {
      siteId: KNOWN_SITE_ID,
      fixes: [VALID_FIX],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { jobId: string };
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);
  });

  it('returns 409 when a bulk-accept-fixes job is already active for the workspace', async () => {
    const first = await postJson(`/api/seo/${wsWithSiteId}/bulk-accept-fixes`, {
      siteId: KNOWN_SITE_ID,
      fixes: [VALID_FIX],
    });
    expect(first.status).toBe(200);
    const { jobId: firstJobId } = await first.json() as { jobId: string };

    const second = await postJson(`/api/seo/${wsWithSiteId}/bulk-accept-fixes`, {
      siteId: KNOWN_SITE_ID,
      fixes: [VALID_FIX],
    });
    expect(second.status).toBe(409);
    const body = await second.json() as { error: string; jobId: string };
    expect(body.error).toMatch(/already running/i);
    expect(body.jobId).toBe(firstJobId);
  });
});
